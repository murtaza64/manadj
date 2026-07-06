"""Ladder-respecting library backfill (ADR 0024, native-analysis-accuracy 11).

One bulk run over the existing library: stale generated/analyzed grids and
analyzed keys get fresh analysis; Engine-imported and hand-edited data is
untouched. Idempotent — currency markers (GridAnalysis.candidate for grids,
Track.key_analysis_candidate for keys) make a re-run a no-op. Stubbed
candidates only; the real run is a real-DB operation post-landing.
"""

import json

import pytest

from backend.analysis_backfill import backfill_analysis
from backend.key import Key
from backend.models import Beatgrid, GridAnalysis, Track
from harness.analyzer import GridAnalyzer
from harness.fit import FitParams

AM = Key.from_musical("Am")
F_SHARP_M = Key.from_musical("F#m")


class CountingGridCandidate:
    name = "stub-grid"
    fit_params = FitParams()

    def __init__(self, bpm: float | None = 128.0, error: Exception | None = None):
        self.calls = 0
        self._bpm = bpm
        self._error = error

    def ticks(self, audio_path: str) -> list[float]:
        self.calls += 1
        if self._error is not None:
            raise self._error
        if self._bpm is None:
            return [1.0, 2.0, 3.0]
        period = 60.0 / self._bpm
        return [0.25 + i * period for i in range(200)]


class CountingKeyCandidate:
    name = "stub-key"

    def __init__(self, key: Key | None = F_SHARP_M):
        self.calls = 0
        self._key = key

    def key(self, audio_path: str) -> tuple[Key | None, float | None]:
        self.calls += 1
        return self._key, 0.9 if self._key else None


@pytest.fixture
def run(db):
    def _run(grid_bpm: float | None = 128.0, key: Key | None = F_SHARP_M,
             grid_error: Exception | None = None):
        grid_candidate = CountingGridCandidate(grid_bpm, grid_error)
        key_candidate = CountingKeyCandidate(key)
        summary = backfill_analysis(
            db,
            GridAnalyzer(grid_candidate),
            key_candidate,
            progress=lambda msg: None,
        )
        return summary, grid_candidate, key_candidate

    return _run


def add_grid(db, track_id: int, origin: str, bpm: float = 120.0) -> None:
    db.add(
        Beatgrid(
            track_id=track_id,
            tempo_changes_json=json.dumps(
                [{"start_time": 0.0, "bpm": bpm, "time_signature_num": 4,
                  "time_signature_den": 4, "bar_position": 1}]
            ),
            origin=origin,
        )
    )
    db.commit()


def set_key(db, track, provenance, candidate: str | None = None) -> None:
    track.key = AM.engine_id
    track.key_provenance = provenance
    track.key_analysis_candidate = candidate
    db.commit()


class TestLadder:
    def test_protected_data_is_untouched(self, db, make_track, run):
        """Engine-imported and hand-edited values survive the backfill."""
        imported = make_track(bpm=12000)
        add_grid(db, imported.id, "imported")
        set_key(db, imported, "imported")
        edited = make_track(bpm=12000)
        add_grid(db, edited.id, "edited")
        set_key(db, edited, "manual")

        summary, grid_candidate, key_candidate = run()

        assert summary.grid["skipped_ladder"] == 2
        assert summary.key["skipped_ladder"] == 2
        db.expire_all()
        assert {g.origin for g in db.query(Beatgrid).all()} == {"imported", "edited"}
        assert grid_candidate.calls == 0
        assert key_candidate.calls == 0

    def test_stale_analyzed_values_get_fresh_analysis(self, db, make_track, run):
        """The migration-backfilled provenance case: key marked `analyzed`
        with no currency marker = an old-backend value — re-analyzed."""
        track = make_track()
        add_grid(db, track.id, "generated")
        set_key(db, track, "analyzed", candidate=None)

        summary, _, _ = run(grid_bpm=174.0, key=F_SHARP_M)

        assert summary.grid["written"] == 1
        assert summary.key["written"] == 1
        db.expire_all()
        row = db.query(Track).filter_by(id=track.id).one()
        assert row.key == F_SHARP_M.engine_id
        assert row.key_analysis_candidate == "stub-key"
        assert db.query(Beatgrid).filter_by(track_id=track.id).one().origin == "analyzed"


class TestIdempotency:
    def test_second_run_is_a_no_op(self, db, make_track, run):
        make_track()  # bare track: grid + key both freshly analyzed

        first, _, _ = run()
        assert first.grid["written"] == 1
        assert first.key["written"] == 1

        second, grid_candidate, key_candidate = run()
        assert second.grid["skipped_current"] == 1
        assert second.key["skipped_current"] == 1
        assert grid_candidate.calls == 0
        assert key_candidate.calls == 0

    def test_bail_is_current_too(self, db, make_track, run):
        """A bail by the current analyzer is a verdict — re-running the
        backfill must not re-bail (manual re-analysis is the retry path)."""
        make_track()
        first, _, _ = run(grid_bpm=None)
        assert first.grid["bailed"] == 1

        second, grid_candidate, _ = run(grid_bpm=None)
        assert second.grid["skipped_current"] == 1
        assert grid_candidate.calls == 0

    def test_new_analyzer_invalidates_currency(self, db, make_track, run):
        """A different candidate name (a new shootout winner) re-analyzes."""
        track = make_track()
        db.add(GridAnalysis(
            track_id=track.id, candidate="old-winner", bailed=True,
            evidence_json="{}",
        ))
        set_key(db, track, "analyzed", candidate="old-key-winner")
        db.commit()

        summary, _, _ = run()
        assert summary.grid["written"] == 1
        assert summary.key["written"] == 1

    def test_deleted_grid_is_reanalyzed(self, db, make_track, run):
        """Currency requires the artifact: diagnostics without the grid
        (user deleted it) is not current."""
        track = make_track()
        first, _, _ = run()
        assert first.grid["written"] == 1
        db.query(Beatgrid).filter_by(track_id=track.id).delete()
        db.commit()

        second, _, _ = run()
        assert second.grid["written"] == 1


class TestSummary:
    def test_bailed_tracks_are_flagged_and_listed(self, db, make_track, run):
        track = make_track(title="Halftime Dubstep")

        summary, _, _ = run(grid_bpm=None)

        assert summary.grid["bailed"] == 1
        assert summary.bailed_tracks == [(track.id, "Halftime Dubstep")]
        db.expire_all()
        assert db.query(Track).filter_by(id=track.id).one().needs_attention is True

    def test_errors_are_counted_and_do_not_abort(self, db, make_track, run):
        make_track()
        make_track()

        summary, _, key_candidate = run(
            grid_error=FileNotFoundError("no such file")
        )

        assert summary.errors == 2
        # the run carried on; keys were still analyzed for both tracks
        assert summary.key["written"] == 2
        assert key_candidate.calls == 2

    def test_totals_add_up(self, db, make_track, run):
        make_track()  # fresh -> written/written
        protected = make_track()
        add_grid(db, protected.id, "edited")
        set_key(db, protected, "manual")

        summary, _, _ = run()

        assert summary.total == 2
        assert sum(summary.grid.values()) == 2
        assert sum(summary.key.values()) == 2
