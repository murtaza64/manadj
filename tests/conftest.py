"""Shared fixtures: in-memory DB, entity factories, audio fixture files.

Per ADR-0002: tests exercise module interfaces with real internals — real
SQLite sessions, real temp audio files. No mocks.
"""

import shutil
from pathlib import Path
from typing import Callable

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.models import Base, Track

FIXTURES_DIR = Path(__file__).parent / "fixtures"

AUDIO_FORMATS = ["mp3", "m4a", "flac", "wav"]


@pytest.fixture()
def db() -> Session:
    """A Session against a fresh in-memory SQLite DB with the full schema."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
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


@pytest.fixture()
def audio_file(tmp_path: Path) -> Callable[..., Path]:
    """Copy a pristine silent fixture (mp3/m4a/flac/wav) into tmp_path."""

    def _copy(fmt: str = "mp3", name: str | None = None) -> Path:
        src = FIXTURES_DIR / f"silence.{fmt}"
        assert src.exists(), f"missing fixture for format: {fmt}"
        dest = tmp_path / (name or f"track.{fmt}")
        shutil.copy(src, dest)
        return dest

    return _copy
