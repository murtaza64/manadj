"""Native grid Analysis (ADR 0024, native-analysis-accuracy 07).

Behavior at the analysis seam with a stubbed candidate: a successful fit
writes an `analyzed` Beatgrid whose projection becomes the Track's BPM;
a bail writes nothing but diagnostics and puts the Track on the
needs-attention worklist. No real audio analysis — the candidate is the
pre-agreed fake seam.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import grid_analysis
from backend.database import get_db
from backend.grid_analysis import analyze_track_grid, get_grid_analysis
from backend.models import Beatgrid, Track
from backend.routers import analyze
from harness.analyzer import GridAnalyzer
from harness.fit import FitParams


class StubCandidate:
    """A beat tracker fake: canned ticks, no audio."""

    name = "stub"
    fit_params = FitParams()

    def __init__(self, ticks: list[float]):
        self._ticks = ticks

    def ticks(self, audio_path: str) -> list[float]:
        return self._ticks


def ticks_at(bpm: float, phase: float = 0.25, n: int = 200) -> list[float]:
    """Perfectly quantized ticks — a Quantized track's evidence."""
    period = 60.0 / bpm
    return [phase + i * period for i in range(n)]


def analyzer_for(ticks: list[float]) -> GridAnalyzer:
    return GridAnalyzer(StubCandidate(ticks))


def stored_grid(db: Session, track_id: int) -> Beatgrid | None:
    return db.query(Beatgrid).filter(Beatgrid.track_id == track_id).first()


class TestAnalyzeTrackGrid:
    def test_success_writes_analyzed_grid_and_bpm_projection(self, db, make_track):
        track = make_track()
        analyze_track_grid(db, track, analyzer_for(ticks_at(128.0, phase=0.25)))

        grid = stored_grid(db, track.id)
        assert grid is not None
        assert grid.origin == "analyzed"
        tempo_changes = json.loads(grid.tempo_changes_json)
        assert len(tempo_changes) == 1
        assert tempo_changes[0]["bpm"] == pytest.approx(128.0)
        assert tempo_changes[0]["start_time"] == pytest.approx(0.25, abs=1e-6)
        assert grid.anchor_time is None
        # BPM is the grid's projection, written through to the cache
        assert track.bpm == 12800

    def test_fractional_bpm_preserved(self, db, make_track):
        track = make_track()
        analyze_track_grid(db, track, analyzer_for(ticks_at(174.62)))

        tempo_changes = json.loads(stored_grid(db, track.id).tempo_changes_json)
        assert tempo_changes[0]["bpm"] == pytest.approx(174.62, abs=0.01)
        assert track.bpm == 17462  # centiBPM keeps the fraction

    def test_near_integer_bpm_snaps(self, db, make_track):
        track = make_track()
        analyze_track_grid(db, track, analyzer_for(ticks_at(128.02)))

        tempo_changes = json.loads(stored_grid(db, track.id).tempo_changes_json)
        assert tempo_changes[0]["bpm"] == 128.0
        assert track.bpm == 12800

    def test_success_stores_diagnostics(self, db, make_track):
        track = make_track()
        analyze_track_grid(db, track, analyzer_for(ticks_at(128.0)))

        diag = get_grid_analysis(db, track.id)
        assert diag is not None
        assert diag.candidate == "stub"
        assert diag.bailed is False
        assert diag.bpm == pytest.approx(128.0)
        assert diag.residual_ms is not None
        assert json.loads(diag.evidence_json)["n_ticks"] == 200

    def test_bail_writes_no_grid_no_bpm(self, db, make_track):
        track = make_track(bpm=None)
        analyze_track_grid(db, track, analyzer_for([1.0, 2.0, 3.0]))  # too few

        assert stored_grid(db, track.id) is None
        assert track.bpm is None
        diag = get_grid_analysis(db, track.id)
        assert diag.bailed is True
        assert diag.bpm is None
        assert json.loads(diag.evidence_json)["reason"] == "too few ticks"

    def test_bail_flags_needs_attention(self, db, make_track):
        track = make_track()
        analyze_track_grid(db, track, analyzer_for([1.0, 2.0, 3.0]))

        assert track.needs_attention is True
        flagged = db.query(Track).filter(Track.needs_attention).all()
        assert [t.id for t in flagged] == [track.id]

    def test_success_clears_needs_attention(self, db, make_track):
        track = make_track()
        analyze_track_grid(db, track, analyzer_for([1.0, 2.0, 3.0]))
        analyze_track_grid(db, track, analyzer_for(ticks_at(140.0)))

        assert track.needs_attention is False
        assert db.query(Track).filter(Track.needs_attention).count() == 0
        # Diagnostics are overwritten, never versioned: one row per track
        diag = get_grid_analysis(db, track.id)
        assert diag.bailed is False
        assert diag.bpm == pytest.approx(140.0)

    def test_bail_on_track_with_saved_grid_is_not_flagged(self, db, make_track):
        """A track whose grid is already saved info (edited/imported) isn't
        a worklist item — the bail only recorded that re-analysis failed."""
        track = make_track(bpm=12800)
        db.add(
            Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.0, "bpm": 128.0,
                      "time_signature_num": 4, "time_signature_den": 4,
                      "bar_position": 1}]
                ),
                origin="edited",
            )
        )
        db.commit()

        analyze_track_grid(db, track, analyzer_for([1.0, 2.0, 3.0]))

        grid = stored_grid(db, track.id)
        assert grid.origin == "edited"  # untouched
        assert track.bpm == 12800  # untouched
        assert track.needs_attention is False
        assert get_grid_analysis(db, track.id).bailed is True

    def test_bail_with_generated_placeholder_is_flagged(self, db, make_track):
        """A generated placeholder is not saved info (CONTEXT.md): it does
        not clear the worklist flag."""
        track = make_track(bpm=12800)
        db.add(
            Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.0, "bpm": 128.0,
                      "time_signature_num": 4, "time_signature_den": 4,
                      "bar_position": 1}]
                ),
                origin="generated",
            )
        )
        db.commit()

        analyze_track_grid(db, track, analyzer_for([1.0, 2.0, 3.0]))

        assert track.needs_attention is True

    def test_manual_analyze_overwrites_edited_grid(self, db, make_track):
        """The seam itself overwrites freely — precedence protection is the
        bulk runner's job (issue 09), not the analyzer's."""
        track = make_track(bpm=12800)
        db.add(
            Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.5, "bpm": 128.0,
                      "time_signature_num": 4, "time_signature_den": 4,
                      "bar_position": 1}]
                ),
                origin="edited",
                anchor_time=0.5,
            )
        )
        db.commit()

        analyze_track_grid(db, track, analyzer_for(ticks_at(174.0)))

        grid = stored_grid(db, track.id)
        assert grid.origin == "analyzed"
        assert json.loads(grid.tempo_changes_json)[0]["bpm"] == pytest.approx(174.0)
        # The old mark refers to a grid that no longer exists
        assert grid.anchor_time is None
        assert track.bpm == 17400


class TestAnalyzeEndpoint:
    """The manual Analyze endpoints now ride the task system (task-system 01):
    POST enqueues a `manual` analysis task and returns its state instead of
    running madmom in the request thread; the client polls GET .../status.
    The analysis itself is tested at the task-handler seam
    (test_analysis_tasks.py); these tests cover only the enqueue/observe API.
    The GET /grid diagnostics read is unchanged.
    """

    @pytest.fixture
    def app(self, db: Session) -> FastAPI:
        # Minimal app with just the analyze router — importing backend.main
        # would pull the heavy analysis stack.
        app = FastAPI()
        app.include_router(analyze.router, prefix="/api/analyze")
        app.dependency_overrides[get_db] = lambda: db
        return app

    @pytest.fixture
    def client(self, app: FastAPI) -> TestClient:
        return TestClient(app)

    def test_post_enqueues_a_manual_task_and_returns_state(self, client, db, make_track):
        from backend.analysis_tasks import ANALYSIS_TASK_TYPE
        from backend.tasks.models import Task

        track = make_track()
        response = client.post(f"/api/analyze/{track.id}")

        assert response.status_code == 202
        body = response.json()
        assert body["state"] == "pending"
        assert body["manual"] is True
        assert body["error"] is None
        task = db.query(Task).filter(Task.type == ANALYSIS_TASK_TYPE).one()
        assert task.ref == f"track:{track.id}"
        assert task.payload["manual"] is True

    def test_post_dedups_against_in_flight_task(self, client, db, make_track):
        from backend.tasks.models import Task

        track = make_track()
        first = client.post(f"/api/analyze/{track.id}").json()
        second = client.post(f"/api/analyze/{track.id}").json()

        # Same in-flight task returned both times — one analysis at a time.
        assert first["task_id"] == second["task_id"]
        assert db.query(Task).count() == 1

    def test_post_missing_track_404(self, client):
        assert client.post("/api/analyze/9999").status_code == 404

    def test_status_reports_latest_task_state(self, client, make_track):
        track = make_track()
        assert client.get(f"/api/analyze/{track.id}/status").json() is None

        client.post(f"/api/analyze/{track.id}")
        body = client.get(f"/api/analyze/{track.id}/status").json()
        assert body["state"] == "pending"
        assert body["manual"] is True

    def test_status_missing_track_404(self, client):
        assert client.get("/api/analyze/9999/status").status_code == 404

    def test_get_grid_returns_stored_diagnostics(self, client, db, make_track):
        track = make_track()
        assert client.get(f"/api/analyze/grid/{track.id}").status_code == 404

        # Diagnostics come from a real analysis run (the seam, not the endpoint).
        analyze_track_grid(db, track, analyzer_for(ticks_at(128.0)))

        response = client.get(f"/api/analyze/grid/{track.id}")
        assert response.status_code == 200
        body = response.json()
        assert body["bpm"] == pytest.approx(128.0)
        assert body["bailed"] is False
        assert body["analyzed_at"]


def test_default_analyzer_is_the_shootout_winner():
    """Issue 06 winners: madmom_dbn behind the GridAnalyzer seam, default
    FitParams. Constructing it must not import madmom (heavy deps live
    inside ticks() only — see test_import_hygiene)."""
    analyzer = grid_analysis.default_grid_analyzer()
    assert analyzer.name == "madmom_dbn"
    assert analyzer.params is None  # candidate's own (default) FitParams
    assert analyzer.candidate.fit_params == FitParams()
