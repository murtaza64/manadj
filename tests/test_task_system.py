"""The task system (ADR-0003): DB-backed tasks, in-process worker.

Module-interface tests with a synchronous run-pending entry point — no live
threads (ADR-0002).
"""

from typing import Any

from sqlalchemy.orm import Session

from backend.tasks.manager import (
    create_task,
    list_tasks,
    run_pending,
    recover_interrupted,
)


def test_create_and_run_a_task(db_session: Session) -> None:
    seen: list[dict[str, Any]] = []

    def handler(db: Session, payload: dict[str, Any]) -> None:
        seen.append(payload)

    task = create_task(db_session, "greet", {"name": "murtaza"}, ref="test:1")
    assert task.state == "pending"

    processed = run_pending(db_session, {"greet": handler})

    assert processed == 1
    assert seen == [{"name": "murtaza"}]
    db_session.refresh(task)
    assert task.state == "done"
    assert task.error is None
    assert task.started_at is not None and task.finished_at is not None


def test_failing_handler_marks_task_failed_with_error(db_session: Session) -> None:
    def handler(db: Session, payload: dict[str, Any]) -> None:
        raise RuntimeError("HTTP 403: geo-blocked")

    task = create_task(db_session, "download", {}, ref="source_item:1")
    run_pending(db_session, {"download": handler})

    db_session.refresh(task)
    assert task.state == "failed"
    assert task.error is not None and "geo-blocked" in task.error


def test_one_failure_does_not_stop_the_queue(db_session: Session) -> None:
    calls: list[str] = []

    def bad(db: Session, payload: dict[str, Any]) -> None:
        raise RuntimeError("boom")

    def good(db: Session, payload: dict[str, Any]) -> None:
        calls.append("ok")

    create_task(db_session, "bad", {})
    create_task(db_session, "good", {})

    processed = run_pending(db_session, {"bad": bad, "good": good})

    assert processed == 2
    assert calls == ["ok"]


def test_unhandled_task_type_is_left_pending(db_session: Session) -> None:
    # A worker without a handler must not claim the task: a stale in-memory
    # backend once drained ~1000 waveform tasks it couldn't run (failed all).
    task = create_task(db_session, "mystery", {})
    ran = run_pending(db_session, {"other": lambda db, payload: None})
    db_session.refresh(task)
    assert ran == 0
    assert task.state == "pending"

    # A capable worker arriving later picks it up.
    ran = run_pending(db_session, {"mystery": lambda db, payload: None})
    db_session.refresh(task)
    assert ran == 1
    assert task.state == "done"


def test_tasks_run_oldest_first(db_session: Session) -> None:
    order: list[str] = []

    def handler(db: Session, payload: dict[str, Any]) -> None:
        order.append(payload["n"])

    create_task(db_session, "t", {"n": "first"})
    create_task(db_session, "t", {"n": "second"})
    run_pending(db_session, {"t": handler})
    assert order == ["first", "second"]


def test_recover_interrupted_requeues_running_tasks(db_session: Session) -> None:
    """A task caught mid-flight by a crash/restart goes back to pending."""
    task = create_task(db_session, "t", {})
    task.state = "running"
    db_session.commit()

    recovered = recover_interrupted(db_session)

    assert recovered == 1
    db_session.refresh(task)
    assert task.state == "pending"


def test_list_tasks_by_ref(db_session: Session) -> None:
    create_task(db_session, "download", {}, ref="source_item:7")
    create_task(db_session, "download", {}, ref="source_item:8")

    tasks = list_tasks(db_session, ref="source_item:7")

    assert len(tasks) == 1
    assert tasks[0].ref == "source_item:7"


def test_done_tasks_are_not_rerun(db_session: Session) -> None:
    count = 0

    def handler(db: Session, payload: dict[str, Any]) -> None:
        nonlocal count
        count += 1

    create_task(db_session, "t", {})
    run_pending(db_session, {"t": handler})
    run_pending(db_session, {"t": handler})
    assert count == 1
