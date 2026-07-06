"""BPM⇄Beatgrid anchor model at the router seam (ADR 0016).

Real in-memory SQLite via the migration path (conftest). Minimal app with
just the beatgrids + tracks routers (importing backend.main would pull the
analysis stack). Covers: the anchor surviving re-tempo exactly, placeholder
regeneration, edited re-tempo with first-downbeat fallback, the variable-grid
409, variable set-downbeat preserving tempo changes, and nudge moving the
anchor with the grid.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import crud
from backend.database import get_db
from backend.models import Beatgrid, Waveform
from backend.routers import beatgrids, tracks


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(tracks.router, prefix="/api/tracks")
    app.include_router(beatgrids.router, prefix="/api/beatgrids")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


@pytest.fixture
def make_waveform(db_session: Session):
    def _make(track_id: int, duration: float = 120.0) -> Waveform:
        wf = Waveform(
            track_id=track_id, sample_rate=44100, duration=duration, samples_per_peak=512
        )
        db_session.add(wf)
        db_session.commit()
        return wf

    return _make


def tc(start_time: float, bpm: float, bar_position: int = 1) -> dict:
    return {
        "start_time": start_time,
        "bpm": bpm,
        "time_signature_num": 4,
        "time_signature_den": 4,
        "bar_position": bar_position,
    }


def set_downbeat(client: TestClient, track_id: int, t: float) -> dict:
    resp = client.post(f"/api/beatgrids/{track_id}/set-downbeat", json={"downbeat_time": t})
    assert resp.status_code == 200, resp.text
    return resp.json()


def patch_bpm(client: TestClient, track_id: int, bpm: float):
    return client.patch(f"/api/tracks/{track_id}", json={"bpm": bpm})


def get_grid(client: TestClient, track_id: int) -> dict:
    resp = client.get(f"/api/beatgrids/{track_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_marked_downbeat_survives_retempo_exactly(client, make_track, make_waveform):
    """Mark at t=46.7, re-tempo 174→175: the downbeat is still at 46.7."""
    track = make_track(bpm=17400)  # centiBPM
    make_waveform(track.id)

    grid = set_downbeat(client, track.id, 46.7)
    assert grid["anchor_time"] == 46.7
    assert any(abs(t - 46.7) < 1e-6 for t in grid["data"]["downbeat_times"])

    resp = patch_bpm(client, track.id, 175.0)
    assert resp.status_code == 200, resp.text
    assert resp.json()["bpm"] == 175.0  # write-through cache

    grid = get_grid(client, track.id)
    assert grid["origin"] == "edited"
    assert grid["anchor_time"] == 46.7
    assert grid["data"]["tempo_changes"][0]["bpm"] == 175.0
    assert any(abs(t - 46.7) < 1e-6 for t in grid["data"]["downbeat_times"])


def test_repeated_retempo_keeps_the_same_anchor(client, make_track, make_waveform):
    track = make_track(bpm=17400)
    make_waveform(track.id)
    set_downbeat(client, track.id, 46.7)

    for bpm in (175.0, 173.5, 176.0):
        assert patch_bpm(client, track.id, bpm).status_code == 200
        grid = get_grid(client, track.id)
        assert grid["anchor_time"] == 46.7
        assert any(abs(t - 46.7) < 1e-6 for t in grid["data"]["downbeat_times"])


def test_last_mark_wins(client, make_track, make_waveform):
    track = make_track(bpm=12800)
    make_waveform(track.id)
    set_downbeat(client, track.id, 10.0)
    grid = set_downbeat(client, track.id, 12.4)
    assert grid["anchor_time"] == 12.4


def test_placeholder_grid_regenerates_on_bpm_edit(client, make_track, make_waveform):
    track = make_track(bpm=12800)
    make_waveform(track.id)

    grid = get_grid(client, track.id)  # auto-generates a placeholder
    assert grid["origin"] == "generated"

    resp = patch_bpm(client, track.id, 140.0)
    assert resp.status_code == 200, resp.text

    grid = get_grid(client, track.id)
    assert grid["origin"] == "generated"  # still a placeholder, not saved info
    assert grid["anchor_time"] is None
    assert grid["data"]["tempo_changes"] == [tc(0.0, 140.0)]


def test_edited_grid_retempos_around_first_downbeat_fallback(
    client, make_track, make_waveform, db_session
):
    track = make_track(bpm=17400)
    make_waveform(track.id)
    # Saved (edited) grid, downbeat on its first beat at 0.3, no mark
    crud.update_beatgrid_tempo_changes(db_session, track.id, [tc(0.3, 174.0)])

    resp = patch_bpm(client, track.id, 175.0)
    assert resp.status_code == 200, resp.text

    grid = get_grid(client, track.id)
    assert grid["origin"] == "edited"
    assert grid["data"]["tempo_changes"][0]["bpm"] == 175.0
    # Fallback anchor (the first downbeat, 0.3) is preserved and persisted
    assert grid["anchor_time"] == pytest.approx(0.3)
    assert any(abs(t - 0.3) < 1e-6 for t in grid["data"]["downbeat_times"])


def test_variable_grid_refuses_bpm_edit_with_409(client, make_track, make_waveform, db_session):
    track = make_track(bpm=12000)
    make_waveform(track.id)
    crud.update_beatgrid_tempo_changes(
        db_session, track.id, [tc(0.5, 120.0), tc(60.5, 150.0)]
    )

    resp = patch_bpm(client, track.id, 128.0)
    assert resp.status_code == 409
    assert "variable" in resp.json()["detail"].lower()

    # Grid untouched
    grid = get_grid(client, track.id)
    assert [t["bpm"] for t in grid["data"]["tempo_changes"]] == [120.0, 150.0]


def test_set_downbeat_on_variable_grid_preserves_tempo_changes(
    client, make_track, make_waveform, db_session
):
    track = make_track(bpm=12000)
    make_waveform(track.id)
    # Downbeats of the first segment: 0.5, 2.5, ..., 10.5 (bars of 2s at 120)
    crud.update_beatgrid_tempo_changes(
        db_session, track.id, [tc(0.5, 120.0), tc(60.5, 150.0)]
    )

    grid = set_downbeat(client, track.id, 10.0)

    # Never flattened: both tempo changes survive, rigidly shifted by -0.5
    # (nearest downbeat 10.5 lands on the 10.0 mark)
    changes = grid["data"]["tempo_changes"]
    assert [c["bpm"] for c in changes] == [120.0, 150.0]
    assert changes[0]["start_time"] == pytest.approx(0.0)
    assert changes[1]["start_time"] == pytest.approx(60.0)
    assert grid["anchor_time"] == 10.0


def nudge(client: TestClient, track_id: int, offset_ms: float) -> dict:
    resp = client.post(f"/api/beatgrids/{track_id}/nudge", json={"offset_ms": offset_ms})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_nudge_moves_anchor_with_the_grid(client, make_track, make_waveform):
    track = make_track(bpm=12800)
    make_waveform(track.id)
    set_downbeat(client, track.id, 10.0)

    resp = client.post(f"/api/beatgrids/{track.id}/nudge", json={"offset_ms": 50.0})
    assert resp.status_code == 200, resp.text
    grid = resp.json()
    assert grid["anchor_time"] == pytest.approx(10.05)


def test_nudge_shifts_every_tempo_change_of_a_variable_grid(
    client, make_track, make_waveform, db_session
):
    track = make_track(bpm=12000)
    make_waveform(track.id)
    crud.update_beatgrid_tempo_changes(
        db_session, track.id, [tc(0.5, 120.0), tc(60.5, 150.0)]
    )

    resp = client.post(f"/api/beatgrids/{track.id}/nudge", json={"offset_ms": -100.0})
    assert resp.status_code == 200, resp.text
    changes = resp.json()["data"]["tempo_changes"]
    assert changes[0]["start_time"] == pytest.approx(0.4)
    assert changes[1]["start_time"] == pytest.approx(60.4)


def test_nudge_translates_by_an_arbitrary_signed_offset(
    client, make_track, make_waveform, db_session
):
    """The endpoint is offset-parameterized: any signed ms amount, applied exactly
    (midi-performance-ops 04 — one API for the ±10ms tap and spin-to-nudge commits)."""
    track = make_track(bpm=12800)
    make_waveform(track.id)
    crud.update_beatgrid_tempo_changes(db_session, track.id, [tc(1.0, 128.0)])

    grid = nudge(client, track.id, 37.0)
    assert grid["data"]["tempo_changes"][0]["start_time"] == pytest.approx(1.037)

    grid = nudge(client, track.id, -3.0)
    assert grid["data"]["tempo_changes"][0]["start_time"] == pytest.approx(1.034)


def test_nudges_accumulate_across_calls(client, make_track, make_waveform, db_session):
    """Repeated offsets sum: the persisted grid carries the net translation."""
    track = make_track(bpm=12800)
    make_waveform(track.id)
    crud.update_beatgrid_tempo_changes(db_session, track.id, [tc(1.0, 128.0)])
    set_downbeat(client, track.id, 1.0)

    # set-downbeat rebuilt the constant grid backward: first beat at 0.0625
    assert get_grid(client, track.id)["data"]["tempo_changes"][0]["start_time"] == pytest.approx(
        0.0625
    )

    for offset_ms in (10.0, 10.0, -25.0, 1.5):
        grid = nudge(client, track.id, offset_ms)

    # net offset = (10 + 10 - 25 + 1.5)ms = -3.5ms
    assert grid["data"]["tempo_changes"][0]["start_time"] == pytest.approx(0.059)
    assert grid["anchor_time"] == pytest.approx(0.9965)


def test_nudge_clamps_at_track_start_and_moves_anchor_by_the_applied_offset(
    client, make_track, make_waveform, db_session
):
    """A large negative offset clamps (first tempo change floors at -0.1s); the
    anchor shifts by the applied — not requested — amount."""
    track = make_track(bpm=12800)
    make_waveform(track.id)
    crud.update_beatgrid_tempo_changes(db_session, track.id, [tc(0.05, 128.0)])
    set_downbeat(client, track.id, 0.05)

    grid = nudge(client, track.id, -500.0)  # requested -0.5s, only -0.15s legal
    assert grid["data"]["tempo_changes"][0]["start_time"] == pytest.approx(-0.1)
    assert grid["anchor_time"] == pytest.approx(-0.1)


class TestPlaceholderProjection:
    """Placeholders are computed projections, never persisted by reads
    (ADR 0027 §3)."""

    def test_get_on_gridless_track_persists_no_row(
        self, client, make_track, make_waveform, db_session
    ):
        track = make_track(bpm=12800)
        make_waveform(track.id)

        grid = get_grid(client, track.id)
        assert grid["origin"] == "generated"
        assert grid["id"] is None  # not a row — a view of the column
        assert grid["anchor_time"] is None
        assert grid["data"]["tempo_changes"] == [tc(0.0, 128.0)]
        assert grid["data"]["beat_times"]  # expanded against the waveform
        assert db_session.query(Beatgrid).count() == 0

    def test_placeholder_tracks_the_column_with_no_row_to_freeze(
        self, client, make_track, make_waveform, db_session
    ):
        """The stale-frozen-placeholder failure mode is unrepresentable:
        a BPM edit moves the column, and the next GET projects the new
        value — there is no second copy."""
        track = make_track(bpm=12800)
        make_waveform(track.id)
        assert get_grid(client, track.id)["data"]["tempo_changes"] == [tc(0.0, 128.0)]

        assert patch_bpm(client, track.id, 140.0).status_code == 200
        assert get_grid(client, track.id)["data"]["tempo_changes"] == [tc(0.0, 140.0)]
        assert db_session.query(Beatgrid).count() == 0

    def test_nudge_on_gridless_creates_and_promotes_exactly_one_row(
        self, client, make_track, make_waveform, db_session
    ):
        track = make_track(bpm=12800)
        make_waveform(track.id)

        grid = nudge(client, track.id, 50.0)
        rows = db_session.query(Beatgrid).filter_by(track_id=track.id).all()
        assert len(rows) == 1
        assert rows[0].origin == "edited"  # deliberate gesture promotes
        assert grid["id"] == rows[0].id
        assert grid["data"]["tempo_changes"][0]["start_time"] == pytest.approx(0.05)


def test_bpm_edit_without_grid_is_a_plain_metadata_write(client, make_track, db_session):
    track = make_track(bpm=12800)  # no waveform, no grid

    resp = patch_bpm(client, track.id, 150.0)
    assert resp.status_code == 200, resp.text
    assert resp.json()["bpm"] == 150.0
    assert db_session.query(Beatgrid).filter_by(track_id=track.id).first() is None
