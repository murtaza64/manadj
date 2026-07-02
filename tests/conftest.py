"""Shared test fixtures.

Per ADR-0002: tests exercise module interfaces with real internals —
a real in-memory SQLite session, fakes only at true seams.
Schema is built through the migration path (ADR-0005), not create_all.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.acquisition.source import SourceItemData

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"


class FakeSource:
    """Fake at the Source seam: canned metadata, no network (ADR-0002)."""

    def __init__(self, items: list[SourceItemData]) -> None:
        self._items = items

    def list_items(self) -> list[SourceItemData]:
        return self._items


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A fresh in-memory SQLite database per test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.connect() as connection:
        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.attributes["connection"] = connection
        alembic_command.upgrade(cfg, "head")
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
