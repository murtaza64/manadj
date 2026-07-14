"""Hot-cue write path (looping 01): positions are stored verbatim.

Quantize snapping moved client-side (gesture time); the API stores what
it's told — even when a Beatgrid exists that the old server-side snap
would have used. Router seam with real in-memory SQLite (conftest),
minimal-app pattern (prior art: test_takes_router.py).
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.hotcue_palette import HOT_CUE_SLOT_COLORS
from backend.models import Beatgrid, HotCue, Waveform
from backend.routers import hotcues


@pytest.fixture
def client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(hotcues.router, prefix="/api/hotcues")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def add_grid(db: Session, track_id: int, bpm: float = 120.0, duration: float = 180.0) -> None:
    """A constant grid the old server-side snap would have snapped onto."""
    db.add(Beatgrid(
        track_id=track_id,
        tempo_changes_json=json.dumps([{
            "start_time": 0.0,
            "bpm": bpm,
            "time_signature_num": 4,
            "time_signature_den": 4,
            "bar_position": 0,
        }]),
        origin="edited",
    ))
    db.add(Waveform(track_id=track_id, sample_rate=44100, duration=duration, samples_per_peak=512))
    db.commit()


def stored_time(db: Session, track_id: int, slot: int) -> float:
    row = db.query(HotCue).filter_by(track_id=track_id, slot_number=slot).one()
    return row.time_seconds


def test_create_stores_offbeat_position_verbatim(client, db, make_track):
    t = make_track()
    add_grid(db, t.id)  # beats at 0.0, 0.5, 1.0, ... — 30.1234567 is off-grid
    resp = client.put(f"/api/hotcues/{t.id}/1", json={"time_seconds": 30.1234567})
    assert resp.status_code == 200, resp.text
    assert resp.json()["time_seconds"] == 30.1234567
    assert stored_time(db, t.id, 1) == 30.1234567


def test_update_stores_offbeat_position_verbatim(client, db, make_track):
    t = make_track()
    add_grid(db, t.id)
    client.put(f"/api/hotcues/{t.id}/2", json={"time_seconds": 10.0})
    resp = client.put(f"/api/hotcues/{t.id}/2", json={"time_seconds": 42.7301})
    assert resp.status_code == 200, resp.text
    assert stored_time(db, t.id, 2) == 42.7301


def test_gridless_track_stores_verbatim(client, db, make_track):
    t = make_track()
    resp = client.put(f"/api/hotcues/{t.id}/3", json={"time_seconds": 12.345})
    assert resp.status_code == 200, resp.text
    assert stored_time(db, t.id, 3) == 12.345


@pytest.mark.parametrize("slot,color", HOT_CUE_SLOT_COLORS.items())
def test_new_cue_gets_its_slot_default_color(client, db, make_track, slot, color):
    t = make_track()

    resp = client.put(f"/api/hotcues/{t.id}/{slot}", json={"time_seconds": slot * 10.0})

    assert resp.status_code == 200, resp.text
    assert resp.json()["color"] == color
    row = db.query(HotCue).filter_by(track_id=t.id, slot_number=slot).one()
    assert row.color == color


def test_label_and_color_persist_and_can_be_cleared(client, db, make_track):
    t = make_track()
    decorated = client.put(
        f"/api/hotcues/{t.id}/4",
        json={"time_seconds": 40.0, "label": "DROP", "color": "#abcdef"},
    )
    assert decorated.status_code == 200, decorated.text
    assert decorated.json()["label"] == "DROP"
    assert decorated.json()["color"] == "#abcdef"

    cleared = client.put(
        f"/api/hotcues/{t.id}/4",
        json={"time_seconds": 40.0, "label": None, "color": "#ff4455"},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["label"] is None
    assert cleared.json()["color"] == "#ff4455"


def test_position_only_update_preserves_decoration(client, db, make_track):
    t = make_track()
    client.put(
        f"/api/hotcues/{t.id}/2",
        json={"time_seconds": 20.0, "label": "BUILD", "color": "#123456"},
    )

    resp = client.put(f"/api/hotcues/{t.id}/2", json={"time_seconds": 21.5})

    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == "BUILD"
    assert resp.json()["color"] == "#123456"
