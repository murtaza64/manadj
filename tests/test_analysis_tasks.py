"""Auto-analyze on acquisition (ADR 0024, native-analysis-accuracy 10).

Grid+key analysis rides the task system (ADR 0003) like waveform
generation: creation sites enqueue, a startup sweep catches tracks missing
analysis, failures surface as failed tasks. Behavior tests at the task
seam with stubbed candidates — no real audio analysis.
"""

import json


from backend import crud, schemas
from backend.analysis_tasks import (
    ANALYSIS_TASK_TYPE,
    enqueue_analysis_task,
    enqueue_missing_analysis,
    make_analysis_handler,
)
from backend.key import Key
from backend.models import Beatgrid, GridAnalysis, Track
from backend.tasks.manager import run_pending
from backend.tasks.models import Task
from harness.analyzer import GridAnalyzer
from harness.fit import FitParams

AM = Key.from_musical("Am")


class StubGridCandidate:
    name = "stub-grid"
    fit_params = FitParams()

    def __init__(self, bpm: float | None = 128.0):
        self._bpm = bpm

    def ticks(self, audio_path: str) -> list[float]:
        if self._bpm is None:
            return [1.0, 2.0, 3.0]  # too few -> bail
        period = 60.0 / self._bpm
        return [0.25 + i * period for i in range(200)]


class StubKeyCandidate:
    name = "stub-key"

    def key(self, audio_path: str) -> tuple[Key | None, float | None]:
        return AM, 0.9


def handler(grid_bpm: float | None = 128.0):
    return make_analysis_handler(
        analyzer=GridAnalyzer(StubGridCandidate(grid_bpm)),
        key_candidate=StubKeyCandidate(),
    )


def pending_analysis_refs(db) -> list[str]:
    return [
        t.ref
        for t in db.query(Task)
        .filter(Task.type == ANALYSIS_TASK_TYPE, Task.state == "pending")
        .all()
    ]


class TestHandler:
    def test_analyzes_grid_and_key(self, db, make_track):
        track = make_track(key=None)
        enqueue_analysis_task(db, track.id)

        ran = run_pending(db, {ANALYSIS_TASK_TYPE: handler()})

        assert ran == 1
        db.expire_all()
        row = db.query(Track).filter_by(id=track.id).one()
        assert row.key == AM.engine_id
        assert row.key_provenance == "analyzed"
        grid = db.query(Beatgrid).filter_by(track_id=track.id).one()
        assert grid.origin == "analyzed"
        assert db.query(Task).filter_by(state="done").count() == 1

    def test_respects_the_ladder(self, db, make_track):
        track = make_track(bpm=12000, key=AM.engine_id)
        track.key_provenance = "manual"
        db.add(
            Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.0, "bpm": 120.0, "time_signature_num": 4,
                      "time_signature_den": 4, "bar_position": 1}]
                ),
                origin="edited",
            )
        )
        db.commit()
        enqueue_analysis_task(db, track.id)

        run_pending(db, {ANALYSIS_TASK_TYPE: handler(grid_bpm=140.0)})

        db.expire_all()
        grid = db.query(Beatgrid).filter_by(track_id=track.id).one()
        assert grid.origin == "edited"  # protected, untouched
        assert db.query(Track).filter_by(id=track.id).one().key_provenance == "manual"
        assert db.query(Task).filter_by(state="done").count() == 1

    def test_missing_track_fails_the_task(self, db):
        enqueue_analysis_task(db, 9999)

        run_pending(db, {ANALYSIS_TASK_TYPE: handler()})

        task = db.query(Task).one()
        assert task.state == "failed"
        assert "9999" in task.error


class TestEnqueue:
    def test_create_track_enqueues_analysis(self, db, audio_file):
        track = crud.create_track(
            db, schemas.TrackCreate(filename=str(audio_file()))
        )
        assert f"track:{track.id}" in pending_analysis_refs(db)

    def test_enqueue_dedups_pending(self, db, make_track):
        track = make_track()
        assert enqueue_analysis_task(db, track.id) is not None
        assert enqueue_analysis_task(db, track.id) is None
        assert len(pending_analysis_refs(db)) == 1


class TestSweep:
    def test_unanalyzed_track_is_enqueued(self, db, make_track):
        track = make_track(key=None)
        assert enqueue_missing_analysis(db) == 1
        assert pending_analysis_refs(db) == [f"track:{track.id}"]

    def test_bailed_track_is_not_reenqueued(self, db, make_track):
        """A bail is a verdict, not a transient failure: the diagnostics row
        marks the grid side done (manual re-analysis is the retry path) —
        no retry storms."""
        track = make_track(key=AM.engine_id)
        db.add(GridAnalysis(
            track_id=track.id, candidate="stub-grid", bailed=True,
            evidence_json="{}",
        ))
        db.commit()

        assert enqueue_missing_analysis(db) == 0

    def test_fully_protected_track_is_not_enqueued(self, db, make_track):
        track = make_track(key=AM.engine_id)
        track.key_provenance = "imported"
        db.add(
            Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.0, "bpm": 120.0, "time_signature_num": 4,
                      "time_signature_den": 4, "bar_position": 1}]
                ),
                origin="imported",
            )
        )
        db.commit()

        assert enqueue_missing_analysis(db) == 0

    def test_protected_grid_but_missing_key_is_enqueued(self, db, make_track):
        track = make_track(key=None)
        db.add(
            Beatgrid(
                track_id=track.id,
                tempo_changes_json=json.dumps(
                    [{"start_time": 0.0, "bpm": 120.0, "time_signature_num": 4,
                      "time_signature_den": 4, "bar_position": 1}]
                ),
                origin="edited",
            )
        )
        db.commit()

        assert enqueue_missing_analysis(db) == 1

    def test_sweep_skips_already_queued(self, db, make_track):
        track = make_track(key=None)
        enqueue_analysis_task(db, track.id)
        assert enqueue_missing_analysis(db) == 0
        assert len(pending_analysis_refs(db)) == 1
