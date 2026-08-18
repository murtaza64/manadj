"""Drops router (structure-analysis 02) at its external seam.

Synthetic blob with a bass jump on a known downbeat -> a hypothesis lands
there; missing blob or grid -> empty drops (never an error); unknown track
-> 404. Detector *quality* is scored by the harness (structure-analysis 01),
not asserted here.
"""

import json

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid, Waveform
from backend.routers import drops
from backend.waveform_data import BAND_HOP, N_BANDS, SAMPLE_RATE, build_blob


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(drops.router, prefix="/api/drops")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


DURATION = 120.0
DROP_TIME = 60.0  # bass arrives here; 120 BPM -> bar = 2 s, downbeat at 60.0


def bass_jump_blob() -> bytes:
    """Quiet bass before DROP_TIME, loud after; mids constant throughout."""
    frames = int(DURATION * SAMPLE_RATE / BAND_HOP)
    bands = np.zeros((frames, N_BANDS), dtype=np.uint8)
    bands[:, 2:5] = 120  # steady mids so the track isn't silent
    drop_frame = int(DROP_TIME * SAMPLE_RATE / BAND_HOP)
    bands[:drop_frame, 0:2] = 15
    bands[drop_frame:, 0:2] = 220
    peaks = np.full(64, 128, dtype=np.uint8)
    return build_blob(peaks, bands, DURATION)


def make_grid(db: Session, track_id: int, bpm: float = 120.0) -> None:
    tc = {
        "start_time": 0.0,
        "bpm": bpm,
        "time_signature_num": 4,
        "time_signature_den": 4,
        "bar_position": 1,
    }
    db.add(Beatgrid(track_id=track_id, tempo_changes_json=json.dumps([tc]), origin="edited"))
    db.commit()


def make_waveform(db: Session, track_id: int, blob: bytes | None) -> None:
    db.add(
        Waveform(
            track_id=track_id,
            sample_rate=SAMPLE_RATE,
            duration=DURATION,
            samples_per_peak=512,
            data_blob=blob,
        )
    )
    db.commit()


def test_bass_jump_yields_hypothesis_on_the_drop_downbeat(client, db_session, make_track):
    track = make_track(bpm=12000)
    make_grid(db_session, track.id)
    make_waveform(db_session, track.id, bass_jump_blob())

    body = client.get(f"/api/drops/{track.id}").json()
    assert body["track_id"] == track.id
    assert body["drops"], "expected at least one hypothesis"
    top = body["drops"][0]
    assert abs(top["time"] - DROP_TIME) <= 2.0  # within one 120-BPM bar
    assert top["strength"] == 1.0  # the jump is the strongest boundary
    # Every hypothesis sits on the 2 s downbeat lattice.
    for h in body["drops"]:
        assert abs(h["time"] / 2.0 - round(h["time"] / 2.0)) < 1e-6


def test_missing_blob_and_missing_grid_yield_empty(client, db_session, make_track):
    no_blob = make_track(bpm=12000)
    make_grid(db_session, no_blob.id)
    make_waveform(db_session, no_blob.id, None)
    assert client.get(f"/api/drops/{no_blob.id}").json() == {
        "track_id": no_blob.id,
        "drops": [],
    }

    no_grid = make_track(bpm=12000)
    make_waveform(db_session, no_grid.id, bass_jump_blob())
    assert client.get(f"/api/drops/{no_grid.id}").json() == {
        "track_id": no_grid.id,
        "drops": [],
    }


def test_unknown_track_404s(client):
    assert client.get("/api/drops/99999").status_code == 404
