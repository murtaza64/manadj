"""Served BPM is the grid-first projection (ADR 0027 §2).

`schemas.Track.bpm` serves what `bpm_effective` used to compute: the
Beatgrid's dominant tempo when a real (non-generated) grid exists, else the
bpm column projected to float BPM. The separate `bpm_effective` field is
gone — consumers stop choosing.

Regression for the Kambi→Raskal incident (2026-07-05): a track whose bpm
column is stale half-time (8700 centiBPM) while its Beatgrid says 174 must
serve 174 as `bpm`.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Beatgrid, Waveform
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


def make_grid(
    db: Session, track_id: int, tempo_changes: list[dict], origin: str = "edited"
) -> Beatgrid:
    grid = Beatgrid(
        track_id=track_id,
        tempo_changes_json=json.dumps(tempo_changes),
        origin=origin,
    )
    db.add(grid)
    db.commit()
    return grid


def make_waveform(db: Session, track_id: int, duration: float) -> Waveform:
    wf = Waveform(
        track_id=track_id, sample_rate=44100, duration=duration, samples_per_peak=1024
    )
    db.add(wf)
    db.commit()
    return wf


def test_grid_overrides_stale_half_time_bpm_column(client, db_session, make_track):
    """The Raskal shape: bpm column 8700 centiBPM (87.0), grid 174.0."""
    track = make_track(bpm=8700, duration_secs=240.0)
    make_grid(db_session, track.id, [tc(0.0, 174.0)])

    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm"] == 174.0  # the grid wins; one served BPM
    assert "bpm_effective" not in body  # the second field is gone


def test_no_grid_falls_back_to_bpm_column(client, make_track):
    track = make_track(bpm=17200)
    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm"] == 172.0


def test_no_grid_no_bpm_is_null(client, make_track):
    track = make_track(bpm=None)
    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm"] is None


def test_generated_placeholder_grid_is_not_an_authority(client, db_session, make_track):
    """ADR 0027 §3: authority = grid with origin != "generated" only. A
    persisted placeholder that froze stale must NOT beat the column."""
    track = make_track(bpm=17400, duration_secs=240.0)
    make_grid(db_session, track.id, [tc(0.0, 87.0)], origin="generated")

    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm"] == 174.0  # the column, not the frozen placeholder


def test_variable_grid_uses_dominant_tempo(client, db_session, make_track):
    """Duration-weighted dominant: 174 occupies 200s of 240, 87 only 40s."""
    track = make_track(bpm=8700, duration_secs=240.0)
    make_grid(db_session, track.id, [tc(0.0, 174.0), tc(200.0, 87.0)])

    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm"] == 174.0


def test_variable_grid_null_duration_secs_uses_waveform_duration(
    client, db_session, make_track
):
    """Dominant-tempo duration = waveform duration, duration_secs fallback.
    With duration_secs NULL, the waveform's duration must still weight the
    segments — not silently yield the first segment's tempo."""
    track = make_track(bpm=8700, duration_secs=None)
    make_waveform(db_session, track.id, duration=240.0)
    # First segment is the short one: first-segment fallback would say 87.
    make_grid(db_session, track.id, [tc(0.0, 87.0), tc(40.0, 174.0)])

    body = client.get(f"/api/tracks/{track.id}").json()
    assert body["bpm"] == 174.0


class TestBackfill:
    """One-time reconcile: column := dominant tempo for real-gridded tracks."""

    def test_diverged_column_reconciles_to_grid(self, db_session, make_track):
        from backend.beatgrid_ops import backfill_bpm_from_grids

        track = make_track(bpm=8700, duration_secs=240.0)
        make_grid(db_session, track.id, [tc(0.0, 174.0)])

        changed = backfill_bpm_from_grids(db_session)
        db_session.commit()  # the script commits; the op itself doesn't
        db_session.refresh(track)
        assert changed == 1
        assert track.bpm == 17400

    def test_gridless_untouched(self, db_session, make_track):
        from backend.beatgrid_ops import backfill_bpm_from_grids

        track = make_track(bpm=12800)
        changed = backfill_bpm_from_grids(db_session)
        db_session.refresh(track)
        assert changed == 0
        assert track.bpm == 12800

    def test_generated_placeholder_untouched(self, db_session, make_track):
        from backend.beatgrid_ops import backfill_bpm_from_grids

        track = make_track(bpm=17400, duration_secs=240.0)
        make_grid(db_session, track.id, [tc(0.0, 87.0)], origin="generated")

        changed = backfill_bpm_from_grids(db_session)
        db_session.refresh(track)
        assert changed == 0
        assert track.bpm == 17400

    def test_already_in_sync_not_counted(self, db_session, make_track):
        from backend.beatgrid_ops import backfill_bpm_from_grids

        track = make_track(bpm=17400, duration_secs=240.0)
        make_grid(db_session, track.id, [tc(0.0, 174.0)])

        assert backfill_bpm_from_grids(db_session) == 0


class TestPlaceholderRowCleanup:
    """Data cleanup (ADR 0027 §3): persisted `generated` rows that are pure
    derivations of the column get deleted; diverged ones are kept for hand
    reconciliation."""

    def test_pure_derivation_row_deleted(self, db_session, make_track):
        from backend.beatgrid_ops import cleanup_placeholder_rows

        track = make_track(bpm=12800, duration_secs=240.0)
        make_grid(db_session, track.id, [tc(0.0, 128.0)], origin="generated")

        deleted, kept = cleanup_placeholder_rows(db_session)
        db_session.commit()
        assert deleted == 1
        assert kept == []
        assert db_session.query(Beatgrid).count() == 0

    def test_diverged_placeholder_kept_and_reported(self, db_session, make_track):
        from backend.beatgrid_ops import cleanup_placeholder_rows

        track = make_track(bpm=12800, duration_secs=240.0)
        make_grid(db_session, track.id, [tc(0.0, 174.0)], origin="generated")

        deleted, kept = cleanup_placeholder_rows(db_session)
        assert deleted == 0
        assert kept == [track.id]
        assert db_session.query(Beatgrid).count() == 1

    def test_real_grids_untouched(self, db_session, make_track):
        from backend.beatgrid_ops import cleanup_placeholder_rows

        track = make_track(bpm=8700, duration_secs=240.0)
        make_grid(db_session, track.id, [tc(0.0, 174.0)], origin="edited")

        deleted, kept = cleanup_placeholder_rows(db_session)
        assert (deleted, kept) == (0, [])
        assert db_session.query(Beatgrid).count() == 1


def test_list_endpoint_serves_grid_first_bpm(client, db_session, make_track):
    with_grid = make_track(bpm=8700, duration_secs=240.0)
    without = make_track(bpm=12800)
    make_grid(db_session, with_grid.id, [tc(0.0, 174.0)])

    items = client.get("/api/tracks/").json()["items"]
    by_id = {t["id"]: t for t in items}
    assert by_id[with_grid.id]["bpm"] == 174.0
    assert by_id[without.id]["bpm"] == 128.0
    assert "bpm_effective" not in by_id[with_grid.id]
