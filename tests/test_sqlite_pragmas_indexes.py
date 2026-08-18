"""Connect-time SQLite PRAGMAs + hot-path Track indexes (performance-hardening 03).

Two guarantees:
  1. Every SQLite connection gets WAL, synchronous=NORMAL, busy_timeout, and
     foreign_keys=ON — the concurrency posture the in-process TaskWorker thread
     needs against request-handler readers.
  2. The default library browse and the Follow-mode BPM-fold gate hit their
     indexes (EXPLAIN QUERY PLAN), not full scans.
"""

import threading
import time
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import apply_sqlite_pragmas

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"


def _file_engine(db_path: Path):
    """A file-backed engine with the app's PRAGMAs — WAL only applies to files
    (a :memory: DB silently stays journal_mode=memory)."""
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", apply_sqlite_pragmas)
    return engine


def _migrate(engine) -> None:
    with engine.begin() as connection:
        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.attributes["connection"] = connection
        cfg.attributes["configure_logger"] = False
        alembic_command.upgrade(cfg, "head")


def _seed_and_analyze(engine, n: int = 2000) -> None:
    """Populate tracks + ANALYZE so EXPLAIN QUERY PLAN reflects a real library.

    SQLite's planner picks indexes by row-count stats; on an empty table it
    happily prefers a different index than it would at library scale. ~10%
    archived mirrors production (most rows active)."""
    rows = [
        {
            "f": f"/t/{i}.mp3",
            "b": 6000 + (i % 14000),
            "c": f"2026-01-01 00:00:{i % 60:02d}",
            "a": "2026-01-02" if i % 10 == 0 else None,
        }
        for i in range(1, n + 1)
    ]
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tracks (filename, bpm, created_at, archived_at) "
                "VALUES (:f, :b, :c, :a)"
            ),
            rows,
        )
        conn.exec_driver_sql("ANALYZE")


# --- PRAGMAs ---------------------------------------------------------------


def test_pragmas_applied_on_every_connection(tmp_path):
    engine = _file_engine(tmp_path / "library.db")
    try:
        # Two separate connections: the pragmas must ride every connect, not
        # just the first (busy_timeout/foreign_keys are per-connection).
        for _ in range(2):
            with engine.connect() as conn:
                assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
                assert conn.exec_driver_sql("PRAGMA synchronous").scalar() == 1  # NORMAL
                assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
                assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
    finally:
        engine.dispose()


def test_memory_engine_still_applies_non_wal_pragmas():
    """The test fixtures run on :memory:, where WAL is meaningless but
    foreign_keys=ON must still take effect."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", apply_sqlite_pragmas)
    try:
        with engine.connect() as conn:
            assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
            assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
    finally:
        engine.dispose()


def test_concurrent_writer_and_reader_under_wal(tmp_path):
    """Smoke the TaskWorker-vs-request posture: a background writer thread
    commits rows in a loop while a reader thread scans — WAL + busy_timeout
    must let both proceed without SQLITE_BUSY."""
    engine = _file_engine(tmp_path / "library.db")
    _migrate(engine)
    Session = sessionmaker(bind=engine)

    errors: list[Exception] = []
    stop = threading.Event()

    def writer():
        try:
            s = Session()
            for i in range(200):
                s.execute(
                    text("INSERT INTO tracks (filename, bpm) VALUES (:f, :b)"),
                    {"f": f"/w/{i}.mp3", "b": 12000 + i},
                )
                s.commit()
            s.close()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            stop.set()

    def reader():
        try:
            s = Session()
            while not stop.is_set():
                s.execute(
                    text("SELECT COUNT(*) FROM tracks WHERE archived_at IS NULL")
                ).scalar()
                s.rollback()  # release the read txn so the writer's WAL checkpoints
                time.sleep(0.001)
            s.close()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    tw = threading.Thread(target=writer)
    tr = threading.Thread(target=reader)
    tr.start()
    tw.start()
    tw.join(timeout=30)
    tr.join(timeout=30)

    assert not errors, f"concurrent access raised: {errors}"
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT COUNT(*) FROM tracks").scalar() == 200
    engine.dispose()


# --- Index use (EXPLAIN QUERY PLAN) ----------------------------------------


def _plan(conn, sql: str) -> str:
    rows = conn.exec_driver_sql("EXPLAIN QUERY PLAN " + sql).fetchall()
    return " ".join(r[3] for r in rows)


def test_default_browse_uses_partial_created_at_index(tmp_path):
    engine = _file_engine(tmp_path / "library.db")
    _migrate(engine)
    _seed_and_analyze(engine)
    with engine.connect() as conn:
        plan = _plan(
            conn,
            "SELECT id FROM tracks WHERE archived_at IS NULL "
            "ORDER BY created_at DESC LIMIT 100",
        )
        assert "ix_tracks_active_created_at" in plan
        # Pre-sorted by the index — no filesort for the default browse.
        assert "TEMP B-TREE" not in plan
    engine.dispose()


def test_active_filter_uses_archived_at_index(tmp_path):
    engine = _file_engine(tmp_path / "library.db")
    _migrate(engine)
    _seed_and_analyze(engine)
    with engine.connect() as conn:
        plan = _plan(conn, "SELECT id FROM tracks WHERE archived_at IS NULL")
        assert "ix_tracks_archived_at" in plan or "ix_tracks_active_created_at" in plan
    engine.dispose()


def test_bpm_fold_gate_uses_bpm_index(tmp_path):
    engine = _file_engine(tmp_path / "library.db")
    _migrate(engine)
    _seed_and_analyze(engine)
    with engine.connect() as conn:
        plan = _plan(
            conn,
            "SELECT id FROM tracks WHERE bpm IS NOT NULL "
            "AND (bpm >= 12000 AND bpm <= 13000)",
        )
        assert "ix_tracks_bpm" in plan
    engine.dispose()
