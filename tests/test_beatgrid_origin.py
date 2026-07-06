"""Beatgrid origin: generated placeholders vs edited/imported saved grids.

A `generated` grid is a placeholder derived from track BPM (glossary:
"placeholder grid") — not saved info. Edits flip it to `edited`. The
migration backfills existing rows via the old structural heuristic.
"""

import json

import pytest
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.database import get_db
from backend.models import Beatgrid, Waveform
from backend.routers import beatgrids

from .conftest import ALEMBIC_INI


@pytest.fixture
def client(db: Session) -> TestClient:
    # Minimal app with just the beatgrids router — importing backend.main
    # would pull the analysis stack (see test_smoke_api.py).
    app = FastAPI()
    app.include_router(beatgrids.router, prefix="/api/beatgrids")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def make_waveform(db: Session):
    def _make(track_id: int, duration: float = 180.0) -> Waveform:
        waveform = Waveform(
            track_id=track_id,
            sample_rate=44100,
            duration=duration,
            samples_per_peak=1024,
        )
        db.add(waveform)
        db.commit()
        return waveform

    return _make


def get_origin(db: Session, track_id: int) -> str:
    return db.query(Beatgrid).filter(Beatgrid.track_id == track_id).one().origin


def row_count(db: Session, track_id: int) -> int:
    return db.query(Beatgrid).filter(Beatgrid.track_id == track_id).count()


def test_get_serves_generated_placeholder_without_a_row(
    client, db, make_track, make_waveform
):
    """ADR 0027 §3: reads never persist placeholders — the payload is a
    computed projection of the bpm column."""
    track = make_track(bpm=12800)
    make_waveform(track.id)

    response = client.get(f"/api/beatgrids/{track.id}")
    assert response.status_code == 200
    assert response.json()["origin"] == "generated"
    assert row_count(db, track.id) == 0


def test_set_downbeat_flips_to_edited(client, db, make_track, make_waveform):
    track = make_track(bpm=12800)
    make_waveform(track.id)
    response = client.post(f"/api/beatgrids/{track.id}/set-downbeat", json={"downbeat_time": 0.5})
    assert response.status_code == 200
    assert response.json()["origin"] == "edited"
    assert get_origin(db, track.id) == "edited"


def test_nudge_flips_to_edited(client, db, make_track, make_waveform):
    track = make_track(bpm=12800)
    make_waveform(track.id)

    response = client.post(f"/api/beatgrids/{track.id}/nudge", json={"offset_ms": 10.0})
    assert response.status_code == 200
    assert response.json()["origin"] == "edited"


def test_delete_falls_back_to_computed_placeholder(client, db, make_track, make_waveform):
    track = make_track(bpm=12800)
    make_waveform(track.id)
    client.post(f"/api/beatgrids/{track.id}/set-downbeat", json={"downbeat_time": 0.5})
    assert get_origin(db, track.id) == "edited"

    client.delete(f"/api/beatgrids/{track.id}")
    response = client.get(f"/api/beatgrids/{track.id}")
    assert response.json()["origin"] == "generated"
    assert row_count(db, track.id) == 0  # projection, not a regenerated row


def test_migration_backfills_origin_via_heuristic():
    """Rows existing before the origin column get the structural heuristic:
    a single change at t=0 with the track's own BPM -> generated, else edited."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    auto_shape = [
        {
            "start_time": 0.0,
            "bpm": 128.0,
            "time_signature_num": 4,
            "time_signature_den": 4,
            "bar_position": 1,
        }
    ]
    curated_shape = [dict(auto_shape[0], start_time=0.35)]

    with engine.connect() as connection:
        cfg = AlembicConfig(str(ALEMBIC_INI))
        cfg.attributes["connection"] = connection
        cfg.attributes["configure_logger"] = False
        alembic_command.upgrade(cfg, "0007_luvzkmyz")

        connection.execute(
            text("INSERT INTO tracks (id, filename, bpm) VALUES (1, '/t/a.mp3', 12800)")
        )
        connection.execute(
            text("INSERT INTO tracks (id, filename, bpm) VALUES (2, '/t/b.mp3', 12800)")
        )
        for track_id, shape in ((1, auto_shape), (2, curated_shape)):
            connection.execute(
                text(
                    "INSERT INTO beatgrids (track_id, tempo_changes_json)"
                    " VALUES (:tid, :tcj)"
                ),
                {"tid": track_id, "tcj": json.dumps(shape)},
            )
        connection.commit()

        alembic_command.upgrade(cfg, "head")

        origins = dict(
            connection.execute(text("SELECT track_id, origin FROM beatgrids")).fetchall()
        )
    assert origins == {1: "generated", 2: "edited"}
