"""bpm_effective: the grid-first BPM projection on Track responses (ADR 0016).

Regression for the Kambi→Raskal incident (2026-07-05): a track whose bpm
column is stale half-time (8700 centiBPM) while its Beatgrid says 174 must
expose 174 as its effective tempo — the Set planner reads bpm_effective, so
tempo-match rates agree with the Transition editor's grid-first chain.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid
from backend.routers import tracks


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(tracks.router, prefix="/api/tracks")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def tc(start_time: float, bpm: float) -> dict:
    return {
        "start_time": start_time,
        "bpm": bpm,
        "time_signature_num": 4,
        "time_signature_den": 4,
        "bar_position": 1,
    }


def make_grid(db: Session, track_id: int, tempo_changes: list[dict]) -> Beatgrid:
    grid = Beatgrid(track_id=track_id, tempo_changes_json=json.dumps(tempo_changes))
    db.add(grid)
    db.commit()
    return grid


def test_grid_overrides_stale_half_time_bpm_column(client, db_session, make_track):
    """The Raskal shape: bpm column 8700 centiBPM (87.0), grid 174.0."""
    track = make_track(bpm=8700, duration_secs=240.0)
    make_grid(db_session, track.id, [tc(0.0, 174.0)])

    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm"] == 87.0  # the column, projected as before
    assert body["bpm_effective"] == 174.0  # the grid wins


def test_no_grid_falls_back_to_bpm_column(client, make_track):
    track = make_track(bpm=17200)
    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm_effective"] == 172.0


def test_no_grid_no_bpm_is_null(client, make_track):
    track = make_track(bpm=None)
    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm_effective"] is None


def test_variable_grid_uses_dominant_tempo(client, db_session, make_track):
    """Duration-weighted dominant: 174 occupies 200s of 240, 87 only 40s."""
    track = make_track(bpm=8700, duration_secs=240.0)
    make_grid(db_session, track.id, [tc(0.0, 174.0), tc(200.0, 87.0)])

    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm_effective"] == 174.0


def test_list_endpoint_carries_bpm_effective(client, db_session, make_track):
    with_grid = make_track(bpm=8700, duration_secs=240.0)
    without = make_track(bpm=12800)
    make_grid(db_session, with_grid.id, [tc(0.0, 174.0)])

    items = client.get("/api/tracks/").json()["items"]
    by_id = {t["id"]: t for t in items}
    assert by_id[with_grid.id]["bpm_effective"] == 174.0
    assert by_id[without.id]["bpm_effective"] == 128.0
