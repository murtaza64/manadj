"""Database connection and session management."""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from pathlib import Path

# Database location
DB_PATH = Path(__file__).parent.parent / "data" / "library.db"
DB_PATH.parent.mkdir(exist_ok=True)

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
