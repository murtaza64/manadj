"""Parallel worker lanes (gh#224): downloads vs soulseek vs compute.

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
        "download": _noop,
        "soulseek-download": _noop,
        "soulseek-search": _noop,
        "waveform": _noop,
        "analysis": _noop,
        "stem-split": _noop,
        "routine-mine": _noop,
        "rekordbox-onboarding-import": _noop,
        "tracks-directory-import": _noop,
    }
    by_lane = split_handlers(handlers)
    assert set(by_lane) == {"soundcloud", "soulseek", "compute"}
    assert set(by_lane["soundcloud"]) == {"download"}
    assert set(by_lane["soulseek"]) == {"soulseek-download", "soulseek-search"}
    assert set(by_lane["compute"]) == {
        "waveform",
        "analysis",
        "stem-split",
        "routine-mine",
        "rekordbox-onboarding-import",
        "tracks-directory-import",
    }


def test_split_handlers_omits_empty_lanes() -> None:
    # No SoundCloud/soulseek configured: only the compute lane exists.
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
    theirs = create_task(db_session, "download", {})
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


def test_compute_task_completes_while_download_is_running(tmp_path: Path) -> None:
    """Two lane workers, real threads: a waveform task finishes while a slow
    download holds the soundcloud lane, and both lanes write the shared DB
    without `database is locked` failures (WAL + busy_timeout)."""
    engine = _make_file_engine(tmp_path)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    download_started = threading.Event()
    release_download = threading.Event()

    def slow_download(db: Session, payload: dict[str, Any]) -> None:
        download_started.set()
        assert release_download.wait(timeout=10), "test never released the download"

    def waveform(db: Session, payload: dict[str, Any]) -> None:
        pass

    db = factory()
    create_task(db, "download", {})
    create_task(db, "waveform", {})
    db.close()

    soundcloud = TaskWorker(
        factory, {"download": slow_download}, poll_interval=0.05, name="task-worker-soundcloud"
    )
    compute = TaskWorker(
        factory, {"waveform": waveform}, poll_interval=0.05, name="task-worker-compute"
    )
    soundcloud.start()
    try:
        assert download_started.wait(timeout=5), "download task never started"
        # Starting the compute lane while the download is mid-flight must not
        # re-queue it (recovery is scoped per lane).
        compute.start()

        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            db = factory()
            try:
                wf = db.query(Task).filter(Task.type == "waveform").one()
                dl = db.query(Task).filter(Task.type == "download").one()
                if wf.state == "done":
                    assert dl.state == "running", (
                        "waveform finished but download was not still running"
                    )
                    assert wf.error is None
                    break
                assert wf.state != "failed", f"waveform failed: {wf.error}"
            finally:
                db.close()
            time.sleep(0.02)
        else:
            raise AssertionError("waveform task did not complete while download ran")
    finally:
        release_download.set()
        soundcloud.stop()
        compute.stop()

    db = factory()
    try:
        dl = db.query(Task).filter(Task.type == "download").one()
        assert dl.state == "done", f"download ended {dl.state}: {dl.error}"
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


def test_pool_add_handlers_starts_new_lane_and_extends_running_one(tmp_path: Path) -> None:
    """A setup guide configuring soulseek mid-session (#290/#291) routes new
    handlers through the pool: a new lane's worker starts on the fly, and a
    handler for an already-running lane extends that worker."""
    engine = _make_file_engine(tmp_path)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = factory()
    create_task(db, "soulseek-search", {})
    create_task(db, "analysis", {})
    db.close()

    pool = TaskWorkerPool(factory, {"waveform": _noop}, poll_interval=0.05)
    pool.start()
    try:
        # New lane, brought up mid-session.
        pool.add_handlers({"soulseek-search": _noop})
        _wait_for_state(factory, "soulseek-search", "done")
        # Existing (running) lane, extended.
        pool.add_handlers({"analysis": _noop})
        _wait_for_state(factory, "analysis", "done")
    finally:
        pool.stop()
        engine.dispose()
