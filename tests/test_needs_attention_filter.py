"""Needs-attention worklist (ADR 0024, native-analysis-accuracy 12).

The flag (bailed analysis + no saved grid) is a library view filter and a
Track schema field, and it clears the moment the track gains a grid from
any saved origin — edited, imported, or a successful re-analysis.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import crud
from backend.database import get_db
from backend.grid_analysis import analyze_track_grid
from backend.models import Beatgrid, GridAnalysis
from backend.routers import tracks as tracks_router
from harness.analyzer import GridAnalyzer
from harness.fit import FitParams


class StubCandidate:
    name = "stub"
    fit_params = FitParams()

    def __init__(self, ticks: list[float]):
        self._ticks = ticks

    def ticks(self, audio_path: str) -> list[float]:
        return self._ticks


def good_ticks(bpm: float = 128.0) -> list[float]:
    period = 60.0 / bpm
    return [0.25 + i * period for i in range(200)]


@pytest.fixture
def client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(tracks_router.router, prefix="/api/tracks")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def flag_track(db, track) -> None:
    """Put a track on the worklist: a bailed analysis, no grid."""
    analyze_track_grid(db, track, GridAnalyzer(StubCandidate([1.0, 2.0])))


def listed_ids(client, **params) -> list[int]:
    resp = client.get("/api/tracks/", params=params)
    assert resp.status_code == 200
    return [t["id"] for t in resp.json()["items"]]


def test_filter_returns_only_flagged_tracks(client, db, make_track):
    flagged = make_track()
    unflagged = make_track()
    flag_track(db, flagged)

    assert listed_ids(client, needs_attention=True) == [flagged.id]
    # Default listing is unaffected
    assert set(listed_ids(client)) == {flagged.id, unflagged.id}


def test_flag_is_served_on_the_track(client, db, make_track):
    track = make_track()
    flag_track(db, track)

    resp = client.get(f"/api/tracks/{track.id}")
    assert resp.json()["needs_attention"] is True

    other = make_track()
    resp = client.get(f"/api/tracks/{other.id}")
    assert resp.json()["needs_attention"] is False


def test_flag_clears_on_edited_grid(client, db, make_track):
    """Manual gridding is the worklist's resolution path."""
    track = make_track()
    flag_track(db, track)
    assert listed_ids(client, needs_attention=True) == [track.id]

    crud.update_beatgrid_tempo_changes(
        db, track.id,
        [{"start_time": 0.3, "bpm": 172.0, "time_signature_num": 4,
          "time_signature_den": 4, "bar_position": 1}],
        origin="edited",
    )

    assert listed_ids(client, needs_attention=True) == []


def test_flag_clears_on_imported_grid(client, db, make_track):
    """External Import is the other resolution path."""
    track = make_track()
    flag_track(db, track)

    crud.update_beatgrid_tempo_changes(
        db, track.id,
        [{"start_time": 0.0, "bpm": 174.0, "time_signature_num": 4,
          "time_signature_den": 4, "bar_position": 1}],
        origin="imported",
    )

    assert listed_ids(client, needs_attention=True) == []


def test_flag_clears_on_successful_reanalysis(client, db, make_track):
    track = make_track()
    flag_track(db, track)

    analyze_track_grid(db, track, GridAnalyzer(StubCandidate(good_ticks())))

    assert listed_ids(client, needs_attention=True) == []


def test_generated_placeholder_does_not_clear(client, db, make_track):
    """A placeholder grid is not saved info (CONTEXT.md) — the track stays
    on the worklist."""
    track = make_track(bpm=12800)
    flag_track(db, track)
    db.add(
        Beatgrid(
            track_id=track.id,
            tempo_changes_json=json.dumps(
                [{"start_time": 0.0, "bpm": 128.0, "time_signature_num": 4,
                  "time_signature_den": 4, "bar_position": 1}]
            ),
            origin="generated",
        )
    )
    db.commit()

    assert listed_ids(client, needs_attention=True) == [track.id]


def test_bailed_row_alone_is_not_enough(client, db, make_track):
    """Diagnostics recording a bail on a track that HAS a saved grid is
    history, not a worklist item."""
    track = make_track()
    crud.update_beatgrid_tempo_changes(
        db, track.id,
        [{"start_time": 0.0, "bpm": 170.0, "time_signature_num": 4,
          "time_signature_den": 4, "bar_position": 1}],
        origin="edited",
    )
    db.add(GridAnalysis(
        track_id=track.id, candidate="stub", bailed=True, evidence_json="{}",
    ))
    db.commit()

    assert listed_ids(client, needs_attention=True) == []
