"""Shared test fixtures.

Per ADR-0002: tests exercise module interfaces with real internals — a real
in-memory SQLite session, real temp audio files, fakes only at true seams.
Schema is built through the migration path (ADR-0005), not create_all.
"""

import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Callable

import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.acquisition.source import SourceItemData
from backend.models import Track

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"
FIXTURES_DIR = Path(__file__).parent / "fixtures"

AUDIO_FORMATS = ["mp3", "m4a", "flac", "wav"]


def _make_engine() -> Engine:
    """In-memory SQLite with the full schema, built via alembic upgrade head."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.connect() as connection:
        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.attributes["connection"] = connection
        alembic_command.upgrade(cfg, "head")
    return engine


@pytest.fixture
def db() -> Iterator[Session]:
    """A Session against a fresh in-memory SQLite database per test."""
    engine = _make_engine()
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def db_session(db: Session) -> Session:
    """Alias of `db` (name used by the acquisition tests)."""
    return db


@pytest.fixture
def make_track(db: Session) -> Callable[..., Track]:
    """Factory for Track rows. BPM is passed in centiBPM (the column's unit)."""
    counter = 0

    def _make(**kwargs) -> Track:
        nonlocal counter
        counter += 1
        defaults = {
            "filename": f"/tracks/test_{counter}.mp3",
            "title": f"Test Track {counter}",
            "artist": "Test Artist",
        }
        defaults.update(kwargs)
        track = Track(**defaults)
        db.add(track)
        db.commit()
        db.refresh(track)
        return track

    return _make


@pytest.fixture
def audio_file(tmp_path: Path) -> Callable[..., Path]:
    """Copy a pristine silent fixture (mp3/m4a/flac/wav) into tmp_path."""

    def _copy(fmt: str = "mp3", name: str | None = None) -> Path:
        src = FIXTURES_DIR / f"silence.{fmt}"
        assert src.exists(), f"missing fixture for format: {fmt}"
        dest = tmp_path / (name or f"track.{fmt}")
        shutil.copy(src, dest)
        return dest

    return _copy


class FakeSource:
    """Fake at the Source seam: canned metadata, no network (ADR-0002).

    "Downloads" by copying a committed audio fixture into the target dir;
    configure with download_file, or download_error to simulate failures.
    """

    def __init__(
        self,
        items: list[SourceItemData],
        download_file: Path | None = None,
        download_error: Exception | None = None,
    ) -> None:
        self._items = items
        self._download_file = download_file
        self._download_error = download_error

    def list_items(self) -> list[SourceItemData]:
        return self._items

    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path:
        if self._download_error is not None:
            raise self._download_error
        assert self._download_file is not None, "FakeSource not configured for downloads"
        dest = dest_dir / f"{basename}{self._download_file.suffix}"
        shutil.copy(self._download_file, dest)
        return dest
