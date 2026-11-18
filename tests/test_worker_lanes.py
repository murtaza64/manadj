"""Parallel worker lanes (gh#224): the lane split and cross-lane concurrency.

The lane split itself is pure-function tested; the cross-lane concurrency
test runs two real TaskWorker threads against a file-backed SQLite DB (WAL +
busy_timeout, same pragmas as production) — a deliberate exception to the
no-live-threads norm (ADR-0002), since thread-level parallelism IS the
behavior under test.
"""

import threading
import time
from pathlib import Path
from typing import Any

from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from alembic import command as alembic_command
from backend.database import apply_sqlite_pragmas
from backend.tasks.lanes import LANES, split_handlers
from backend.tasks.manager import create_task, recover_interrupted
from backend.tasks.models import Task
from backend.tasks.worker import TaskWorker, TaskWorkerPool

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"


def _noop(db: Session, payload: dict[str, Any]) -> None:
    pass


def test_every_lane_type_is_unique() -> None:
    all_types = [t for types in LANES.values() for t in types]
    assert len(all_types) == len(set(all_types))


def test_split_handlers_groups_by_lane() -> None:
    handlers = {
        "waveform": _noop,
        "analysis": _noop,
        "stem-split": _noop,
        "routine-mine": _noop,
        "rekordbox-onboarding-import": _noop,
        "tracks-directory-import": _noop,
    }
    by_lane = split_handlers(handlers)
    assert set(by_lane) == {"compute"}
    assert set(by_lane["compute"]) == set(handlers)


def test_split_handlers_omits_empty_lanes() -> None:
    by_lane = split_handlers({"waveform": _noop})
    assert set(by_lane) == {"compute"}


def test_split_handlers_rejects_unassigned_type() -> None:
    # A new task type must be assigned a lane, loudly, at startup.
    try:
        split_handlers({"brand-new-type": _noop})
    except KeyError as e:
        assert "brand-new-type" in str(e)
    else:
        raise AssertionError("expected KeyError for unassigned task type")


def test_recover_interrupted_scoped_to_types(db_session: Session) -> None:
    """A lane recovers only its own types — not tasks another lane is running."""
    mine = create_task(db_session, "waveform", {})
    theirs = create_task(db_session, "analysis", {})
    mine.state = "running"
    theirs.state = "running"
    db_session.commit()

    recovered = recover_interrupted(db_session, types=["waveform"])

    assert recovered == 1
    db_session.refresh(mine)
    db_session.refresh(theirs)
    assert mine.state == "pending"
    assert theirs.state == "running"  # the other lane's in-flight task is untouched


def _make_file_engine(tmp_path: Path):
    """File-backed SQLite with production pragmas (real WAL, unlike :memory:)."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'library.db'}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", apply_sqlite_pragmas)
    with engine.connect() as connection:
        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.attributes["connection"] = connection
        cfg.attributes["configure_logger"] = False
        alembic_command.upgrade(cfg, "head")
    return engine


def test_compute_task_completes_while_slow_lane_task_is_running(tmp_path: Path) -> None:
    """Two lane workers, real threads: a waveform task finishes while a slow
    task holds its own lane, and both lanes write the shared DB without
    `database is locked` failures (WAL + busy_timeout)."""
    engine = _make_file_engine(tmp_path)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    slow_started = threading.Event()
    release_slow = threading.Event()

    def slow_task(db: Session, payload: dict[str, Any]) -> None:
        slow_started.set()
        assert release_slow.wait(timeout=10), "test never released the slow task"

    def waveform(db: Session, payload: dict[str, Any]) -> None:
        pass

    db = factory()
    create_task(db, "analysis", {})
    create_task(db, "waveform", {})
    db.close()

    lane_a = TaskWorker(
        factory, {"analysis": slow_task}, poll_interval=0.05, name="task-worker-a"
    )
    lane_b = TaskWorker(
        factory, {"waveform": waveform}, poll_interval=0.05, name="task-worker-b"
    )
    lane_a.start()
    try:
        assert slow_started.wait(timeout=5), "slow task never started"
        # Starting the other lane while the slow task is mid-flight must not
        # re-queue it (recovery is scoped per lane).
        lane_b.start()

        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            db = factory()
            try:
                wf = db.query(Task).filter(Task.type == "waveform").one()
                slow = db.query(Task).filter(Task.type == "analysis").one()
                if wf.state == "done":
                    assert slow.state == "running", (
                        "waveform finished but the slow task was not still running"
                    )
                    assert wf.error is None
                    break
                assert wf.state != "failed", f"waveform failed: {wf.error}"
            finally:
                db.close()
            time.sleep(0.02)
        else:
            raise AssertionError("waveform task did not complete while the slow task ran")
    finally:
        release_slow.set()
        lane_a.stop()
        lane_b.stop()

    db = factory()
    try:
        slow = db.query(Task).filter(Task.type == "analysis").one()
        assert slow.state == "done", f"slow task ended {slow.state}: {slow.error}"
    finally:
        db.close()
        engine.dispose()


def _wait_for_state(factory, type_: str, state: str, timeout: float = 5.0) -> Task:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        db = factory()
        try:
            task = db.query(Task).filter(Task.type == type_).one()
            if task.state == state:
                return task
            assert task.state != "failed", f"{type_} failed: {task.error}"
        finally:
            db.close()
        time.sleep(0.02)
    raise AssertionError(f"{type_} never reached {state}")


def test_pool_add_handlers_extends_a_running_lane(tmp_path: Path) -> None:
    """A mid-session handler registration routes through the pool: a handler
    added for an already-running lane extends that worker without a
    restart."""
    engine = _make_file_engine(tmp_path)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = factory()
    create_task(db, "stem-split", {})
    create_task(db, "analysis", {})
    db.close()

    pool = TaskWorkerPool(factory, {"waveform": _noop}, poll_interval=0.05)
    pool.start()
    try:
        pool.add_handlers({"stem-split": _noop})
        _wait_for_state(factory, "stem-split", "done")
        pool.add_handlers({"analysis": _noop})
        _wait_for_state(factory, "analysis", "done")
    finally:
        pool.stop()
        engine.dispose()