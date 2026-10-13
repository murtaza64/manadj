"""Database connection and session management.

URL resolution (packaged-app PRD): MANADJ_DB_URL wins outright (the same env
var alembic/env.py consults, so app and migrations always agree); otherwise
the SQLite file lives in the data root (backend.data_root — repo in dev,
~/Library/Application Support/manaDJ packaged).
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.data_root import db_path

_db_url_env = os.environ.get("MANADJ_DB_URL")
if _db_url_env:
    SQLALCHEMY_DATABASE_URL = _db_url_env
    # Best-effort file path for backup tooling; None for non-file URLs.
    _prefix = "sqlite:///"
    DB_PATH: Path | None = (
        Path(_db_url_env.removeprefix(_prefix)) if _db_url_env.startswith(_prefix) else None
    )
else:
    DB_PATH = db_path()
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"


def apply_sqlite_pragmas(dbapi_connection, connection_record) -> None:
    """Connect-time PRAGMAs for every SQLite connection (performance-hardening 03).

    The in-process TaskWorker thread writes waveform/analysis rows while
    request handlers read. WAL lets readers and one writer proceed
    concurrently (default rollback-journal serializes them); busy_timeout
    replaces instant SQLITE_BUSY with a bounded wait. synchronous=NORMAL is
    the safe pairing with WAL (durable across app crashes, only a power-loss
    window). foreign_keys=ON enforces the FK constraints the schema declares
    (SQLite defaults it OFF per-connection).

    WAL is a persistent, file-level mode (survives once set); the rest are
    per-connection and must be re-applied on every connect — hence the
    listener. On :memory: databases (tests) journal_mode=WAL is silently
    ignored by SQLite and stays "memory"; the other pragmas still apply.
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)
event.listen(engine, "connect", apply_sqlite_pragmas)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
