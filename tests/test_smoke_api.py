"""Smoke tests for the tracks router (ADR-0002: status + shape only).

Builds a minimal app with just the tracks router — importing backend.main
would pull the analysis stack (essentia) and the waveform worker.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.routers import tracks


@pytest.fixture()
def client(db):
    app = FastAPI()
    app.include_router(tracks.router, prefix="/api/tracks")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_list_tracks(client, make_track):
    make_track()
    resp = client.get("/api/tracks/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["title"]


def test_patch_track_bpm_round_trip(client, db, make_track):
    track = make_track()
    resp = client.patch(f"/api/tracks/{track.id}", json={"bpm": 128.5})
    assert resp.status_code == 200
    assert resp.json()["bpm"] == 128.5  # float BPM on the wire
    db.refresh(track)
    assert track.bpm == 12850  # centiBPM in the column


def test_patch_invalid_energy_rejected(client, make_track):
    track = make_track()
    resp = client.patch(f"/api/tracks/{track.id}", json={"energy": 6})
    assert resp.status_code == 422


def test_patch_unknown_track_404(client):
    assert client.patch("/api/tracks/999", json={"title": "x"}).status_code == 404


def test_metadata_compare_shape(client, make_track):
    make_track(filename="/nonexistent/c.mp3")
    resp = client.get("/api/tracks/metadata/compare")
    assert resp.status_code == 200
    body = resp.json()
    assert body["stats"]["missing_files"] == 1
    assert body["comparisons"] == []


def test_metadata_sync_dry_run(client, make_track):
    track = make_track()
    resp = client.post(
        "/api/tracks/metadata/sync",
        json={
            "updates": [{"track_id": track.id, "fields": {"key": "Am"}}],
            "dry_run": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["dry_run"] is True
    assert body["stats"]["updated"] == 1
