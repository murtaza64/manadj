"""Main-cue persistence: the cue-point PATCH must accept the JSON body the
deck engine's persist path sends (regression: a bare scalar param made
FastAPI demand a query param, so every in-app cue set 422'd silently and
Main cues only ever arrived via Sync).

Minimal-app router pattern, as in the takes/transitions router tests.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import waveforms


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(waveforms.router, prefix="/api/waveforms")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def test_cue_point_patch_accepts_json_body(client, make_track):
    track = make_track()
    resp = client.patch(
        f"/api/waveforms/{track.id}/cue-point",
        json={"cue_point_time": 42.5},
    )
    assert resp.status_code == 200
    assert resp.json() == {"track_id": track.id, "cue_point_time": 42.5}


def test_cue_point_patch_clears_with_null(client, make_track):
    track = make_track(cue_point_time=10.0)
    resp = client.patch(
        f"/api/waveforms/{track.id}/cue-point",
        json={"cue_point_time": None},
    )
    assert resp.status_code == 200
    assert resp.json()["cue_point_time"] is None


def test_cue_point_patch_404_for_missing_track(client):
    resp = client.patch(
        "/api/waveforms/999999/cue-point",
        json={"cue_point_time": 1.0},
    )
    assert resp.status_code == 404
