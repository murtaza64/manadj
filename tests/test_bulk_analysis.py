"""Overwrite ladder on bulk runs (ADR 0024, native-analysis-accuracy 09).

Grids: generated < analyzed < imported < edited. Keys: (unknown) <
analyzed < imported < manual. Bulk/automatic analysis never overwrites
anything that outranks `analyzed` — and never even runs the audio when
both values are protected. Manual single-track analysis (the /api/analyze
endpoints) bypasses this module entirely and overwrites freely.
"""

import json

import pytest

from backend.bulk_analysis import BulkOutcome, bulk_analyze_track
from backend.key import Key
from backend.models import Beatgrid
from harness.analyzer import GridAnalyzer
from harness.fit import FitParams

AM = Key.from_musical("Am")


class CountingGridCandidate:
    name = "stub-grid"
    fit_params = FitParams()

    def __init__(self, bpm: float | None = 128.0):
        self.calls = 0
        self._bpm = bpm

    def ticks(self, audio_path: str) -> list[float]:
        self.calls += 1
        if self._bpm is None:
            return [1.0, 2.0, 3.0]  # too few -> bail
        period = 60.0 / self._bpm
        return [0.25 + i * period for i in range(200)]


class CountingKeyCandidate:
    name = "stub-key"

    def __init__(self, key: Key | None = AM):
        self.calls = 0
        self._key = key

    def key(self, audio_path: str) -> tuple[Key | None, float | None]:
        self.calls += 1
        return self._key, 0.9 if self._key else None


@pytest.fixture
def run(db):
    """Run a bulk analysis over one track with counting stubs; returns
    (outcome, grid_candidate, key_candidate)."""

    def _run(track, grid_bpm: float | None = 128.0, key: Key | None = AM):
        grid_candidate = CountingGridCandidate(grid_bpm)
        key_candidate = CountingKeyCandidate(key)
        outcome = bulk_analyze_track(
            db, track, GridAnalyzer(grid_candidate), key_candidate
        )
        return outcome, grid_candidate, key_candidate

    return _run


def add_grid(db, track_id: int, origin: str) -> None:
    db.add(
        Beatgrid(
            track_id=track_id,
            tempo_changes_json=json.dumps(
                [{"start_time": 0.0, "bpm": 120.0, "time_signature_num": 4,
                  "time_signature_den": 4, "bar_position": 1}]
            ),
            origin=origin,
        )
    )
    db.commit()


def set_key(db, track, provenance: str | None) -> None:
    track.key = AM.engine_id
    track.key_provenance = provenance
    db.commit()


class TestGridLadder:
    def test_no_grid_is_written(self, db, make_track, run):
        track = make_track()
        outcome, _, _ = run(track)
        assert outcome.grid == "written"
        assert db.query(Beatgrid).filter_by(track_id=track.id).one().origin == "analyzed"

    @pytest.mark.parametrize("origin", ["generated", "analyzed"])
    def test_lower_rungs_are_overwritten(self, db, make_track, run, origin):
        track = make_track()
        add_grid(db, track.id, origin)
        outcome, _, _ = run(track, grid_bpm=140.0)

        assert outcome.grid == "written"
        grid = db.query(Beatgrid).filter_by(track_id=track.id).one()
        assert grid.origin == "analyzed"
        assert json.loads(grid.tempo_changes_json)[0]["bpm"] == pytest.approx(140.0)

    @pytest.mark.parametrize("origin", ["imported", "edited"])
    def test_higher_rungs_are_skipped(self, db, make_track, run, origin):
        track = make_track(bpm=12000)
        add_grid(db, track.id, origin)
        outcome, grid_candidate, _ = run(track, grid_bpm=140.0)

        assert outcome.grid == "skipped"
        grid = db.query(Beatgrid).filter_by(track_id=track.id).one()
        assert grid.origin == origin
        assert json.loads(grid.tempo_changes_json)[0]["bpm"] == pytest.approx(120.0)
        assert track.bpm == 12000
        assert grid_candidate.calls == 0  # protected: audio never analyzed

    def test_bail_is_reported(self, db, make_track, run):
        track = make_track()
        outcome, _, _ = run(track, grid_bpm=None)
        assert outcome.grid == "bailed"
        assert db.query(Beatgrid).filter_by(track_id=track.id).first() is None
        assert track.needs_attention is True


class TestKeyLadder:
    @pytest.mark.parametrize("provenance", [None, "analyzed"])
    def test_lower_rungs_are_overwritten(self, db, make_track, run, provenance):
        track = make_track()
        set_key(db, track, provenance)
        f_sharp_m = Key.from_musical("F#m")
        outcome, _, _ = run(track, key=f_sharp_m)

        assert outcome.key == "written"
        assert track.key == f_sharp_m.engine_id
        assert track.key_provenance == "analyzed"

    @pytest.mark.parametrize("provenance", ["imported", "manual"])
    def test_higher_rungs_are_skipped(self, db, make_track, run, provenance):
        track = make_track()
        set_key(db, track, provenance)
        outcome, _, key_candidate = run(track, key=Key.from_musical("F#m"))

        assert outcome.key == "skipped"
        assert track.key == AM.engine_id
        assert track.key_provenance == provenance
        assert key_candidate.calls == 0  # protected: audio never analyzed

    def test_undetected_is_reported(self, db, make_track, run):
        track = make_track()
        outcome, _, _ = run(track, key=None)
        assert outcome.key == "undetected"
        assert track.key is None


class TestFullyProtected:
    def test_both_protected_skips_audio_entirely(self, db, make_track, run):
        track = make_track()
        add_grid(db, track.id, "edited")
        set_key(db, track, "manual")

        outcome, grid_candidate, key_candidate = run(track)

        assert outcome == BulkOutcome(grid="skipped", key="skipped")
        assert grid_candidate.calls == 0
        assert key_candidate.calls == 0
