"""Database connection and session management."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from pathlib import Path

# Database location
DB_PATH = Path(__file__).parent.parent / "data" / "library.db"
DB_PATH.parent.mkdir(exist_ok=True)

SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
