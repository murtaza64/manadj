"""Sessions router seam (Sessions PRD, ADR 0033): status + shape.

Real in-memory SQLite via the migration path (conftest) — same
minimal-app pattern as the takes router tests. A Session is a header + an
append-only chunk log; the list carries a derived Take count; delete
cascades chunks but never a Take.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import sessions, takes


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sessions.router, prefix="/api/sessions")
    app.include_router(takes.router, prefix="/api/takes")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def take_payload(uuid: str, a_id: int, b_id: int, **over):
    payload = {
        "uuid": uuid,
        "a_track_id": a_id,
        "b_track_id": b_id,
        "window_start_s": 10.0,
        "window_end_s": 22.5,
        "confidence": 0.9,
        "detector_version": 1,
        "params": {"audibleGain": 0.05},
        "events": [{"t": 10.0, "kind": "tick", "playheads": {}}],
    }
    payload.update(over)
    return payload


def test_create_then_list(client):
    resp = client.post("/api/sessions", json={"uuid": "s1"})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["uuid"] == "s1"
    assert row["ended_at"] is None
    assert row["take_count"] == 0
    assert row["started_at"] is not None

    rows = client.get("/api/sessions").json()
    assert [r["uuid"] for r in rows] == ["s1"]


def test_list_is_newest_first(client):
    client.post("/api/sessions", json={"uuid": "s1", "started_at": "2026-07-14T20:00:00"})
    client.post("/api/sessions", json={"uuid": "s2", "started_at": "2026-07-15T20:00:00"})
    rows = client.get("/api/sessions").json()
    assert [r["uuid"] for r in rows] == ["s2", "s1"]


def test_duplicate_session_uuid_400(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    assert client.post("/api/sessions", json={"uuid": "s1"}).status_code == 400


def test_recover_closes_orphaned_open_sessions_without_creating_one(client):
    client.post("/api/sessions", json={"uuid": "empty"})
    client.post("/api/sessions", json={"uuid": "with-events"})
    client.post(
        "/api/sessions/with-events/chunks",
        json={"seq": 0, "events": [{"t": 1.0, "kind": "tick", "playheads": {}}]},
    )

    resp = client.post("/api/sessions/recover")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"closed": 2}
    rows = client.get("/api/sessions").json()
    assert len(rows) == 2
    assert all(row["ended_at"] is not None for row in rows)


def test_append_chunks_accumulate(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    r0 = client.post(
        "/api/sessions/s1/chunks",
        json={"seq": 0, "events": [{"t": 1.0, "kind": "tick", "playheads": {}}]},
    )
    assert r0.status_code == 200, r0.text
    r1 = client.post(
        "/api/sessions/s1/chunks",
        json={"seq": 1, "events": [{"t": 6.0, "kind": "tick", "playheads": {}}]},
    )
    assert r1.status_code == 200, r1.text


def test_append_unknown_session_404(client):
    assert client.post("/api/sessions/nope/chunks", json={"seq": 0, "events": []}).status_code == 404


def test_duplicate_chunk_seq_400(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/sessions/s1/chunks", json={"seq": 0, "events": []})
    assert client.post("/api/sessions/s1/chunks", json={"seq": 0, "events": []}).status_code == 400


def test_end_session(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    resp = client.patch("/api/sessions/s1/end", json={"ended_at": "2026-07-15T21:30:00"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ended_at"] is not None
    assert client.get("/api/sessions").json()[0]["ended_at"] is not None


def test_end_unknown_session_404(client):
    assert client.patch("/api/sessions/nope/end", json={}).status_code == 404


def test_take_count_reflects_stamped_takes(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/takes", json=take_payload("t1", a.id, b.id, session_uuid="s1"))
    client.post("/api/takes", json=take_payload("t2", a.id, b.id, session_uuid="s1"))
    # A sessionless Take does not count toward any Session.
    client.post("/api/takes", json=take_payload("t3", a.id, b.id))
    row = next(r for r in client.get("/api/sessions").json() if r["uuid"] == "s1")
    assert row["take_count"] == 2


def test_take_carries_session_and_origin(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/takes", json=take_payload("t1", a.id, b.id, session_uuid="s1"))
    take = client.get("/api/takes").json()[0]
    assert take["session_uuid"] == "s1"
    assert take["origin"] == "detected"


def test_delete_session_cascades_chunks_but_spares_takes(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/sessions/s1/chunks", json={"seq": 0, "events": []})
    client.post("/api/takes", json=take_payload("t1", a.id, b.id, session_uuid="s1"))

    assert client.delete("/api/sessions/s1").status_code == 200
    assert client.get("/api/sessions").json() == []
    # The Take survives with its own event slice — deleting a Session never
    # destroys kept evidence (ADR 0033).
    takes_rows = client.get("/api/takes").json()
    assert [t["uuid"] for t in takes_rows] == ["t1"]
    detail = client.get("/api/takes/t1").json()
    assert detail["session_uuid"] == "s1"  # provenance survives the Session
    assert len(detail["events"]) == 1


def test_delete_unknown_session_404(client):
    assert client.delete("/api/sessions/nope").status_code == 404
