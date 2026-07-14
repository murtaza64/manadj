"""Task observability API contract."""

from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import tasks
from backend.tasks.manager import create_task


def client_for(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(tasks.router, prefix="/api/tasks")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_summary_counts_states_and_undismissed_failures(db_session: Session) -> None:
    create_task(db_session, "waveform", {}, ref="track:1")
    running = create_task(db_session, "analysis", {}, ref="track:2")
    running.state = "running"
    failed = create_task(db_session, "download", {}, ref="source_item:3")
    failed.state = "failed"
    dismissed = create_task(db_session, "download", {})
    dismissed.state = "failed"
    dismissed.dismissed_at = datetime.now()
    db_session.commit()

    response = client_for(db_session).get("/api/tasks/summary")

    assert response.status_code == 200
    assert response.json() == {
        "counts": {"pending": 1, "running": 1, "done": 0, "failed": 2},
        "running_task": {"type": "analysis", "ref": "track:2"},
        "undismissed_failures": 1,
    }


def test_default_list_keeps_old_undismissed_failures_only(db_session: Session) -> None:
    old_done = create_task(db_session, "analysis", {})
    old_done.state = "done"
    old_done.created_at = datetime.now() - timedelta(days=8)
    old_failure = create_task(db_session, "analysis", {})
    old_failure.state = "failed"
    old_failure.created_at = datetime.now() - timedelta(days=8)
    db_session.commit()

    rows = client_for(db_session).get("/api/tasks").json()

    assert [row["id"] for row in rows] == [old_failure.id]
    history = client_for(db_session).get("/api/tasks?state=done").json()
    assert [row["id"] for row in history] == [old_done.id]


def test_retry_and_dismiss_lifecycle(db_session: Session) -> None:
    failed = create_task(db_session, "download", {})
    failed.state = "failed"
    failed.error = "boom"
    failed.attempts = 4
    failed.not_before = datetime.now()
    failed.dismissed_at = datetime.now()
    pending = create_task(db_session, "waveform", {})
    db_session.commit()
    client = client_for(db_session)

    conflict = client.post(f"/api/tasks/{pending.id}/retry")
    retried = client.post(f"/api/tasks/{failed.id}/retry")
    dismissed = client.post(f"/api/tasks/{pending.id}/dismiss")

    assert conflict.status_code == 409
    assert retried.status_code == 200
    assert retried.json()["state"] == "pending"
    assert retried.json()["error"] is None
    assert retried.json()["attempts"] == 0
    assert retried.json()["dismissed_at"] is None
    assert dismissed.json()["dismissed_at"] is not None


def test_bulk_retry_and_dismiss_use_filters(db_session: Session) -> None:
    for type_ in ("analysis", "analysis", "download"):
        task = create_task(db_session, type_, {})
        task.state = "failed"
    db_session.commit()
    client = client_for(db_session)

    retry = client.post(
        "/api/tasks/bulk/retry", json={"state": "failed", "type": "analysis"}
    )
    dismiss = client.post(
        "/api/tasks/bulk/dismiss", json={"state": "failed", "type": "download"}
    )

    assert retry.json() == {"updated": 2}
    assert dismiss.json() == {"updated": 1}
