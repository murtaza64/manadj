"""Grid+key analysis on the task system (ADR 0003; native-analysis-accuracy 10).

Track creation sites enqueue an `analysis` task (like waveform generation);
a startup sweep enqueues tracks still missing analysis. The handler runs the
ladder-respecting bulk path (issue 09) — new tracks have no saved info so
the ladder is a no-op for them, and a swept track with protected values is
skipped without touching audio.

No retry storms on repeated bail: a bail writes its GridAnalysis diagnostics
row, which marks the grid side done for the sweep — manual re-analysis is
the retry path. Task failures (missing track, decode errors) surface as
failed tasks like every other task type.

Heavy deps stay inside candidate method bodies (import-hygiene guard).
"""

import logging
from typing import Any

from sqlalchemy import and_, exists, or_
from sqlalchemy.orm import Session

from harness.analyzer import GridAnalyzer
from harness.key_candidates import KeyCandidate

from . import crud, models
from .bulk_analysis import GRID_PROTECTED_ORIGINS, bulk_analyze_track
from .grid_analysis import default_grid_analyzer
from .key_analysis import default_key_candidate
from .tasks.manager import create_task
from .tasks.models import Task

logger = logging.getLogger(__name__)

ANALYSIS_TASK_TYPE = "analysis"


def _ref(track_id: int) -> str:
    return f"track:{track_id}"


def make_analysis_handler(
    analyzer: GridAnalyzer | None = None,
    key_candidate: KeyCandidate | None = None,
):
    """Build the task handler for `analysis` tasks. The candidates are an
    injectable seam (ADR-0002); defaults are the shootout winners."""
    if analyzer is None:
        analyzer = default_grid_analyzer()
    if key_candidate is None:
        key_candidate = default_key_candidate()

    def handle(db: Session, payload: dict[str, Any]) -> None:
        track_id = int(payload["track_id"])
        track = crud.get_track(db, track_id)
        if track is None:
            raise LookupError(f"track {track_id} not found")
        outcome = bulk_analyze_track(db, track, analyzer, key_candidate)
        logger.info(
            "analysis task for track %d: grid %s, key %s",
            track_id,
            outcome.grid,
            outcome.key,
        )

    return handle


def enqueue_analysis_task(db: Session, track_id: int) -> Task | None:
    """Enqueue analysis for one Track; no-op if one is already queued/running."""
    existing = (
        db.query(Task)
        .filter(
            Task.type == ANALYSIS_TASK_TYPE,
            Task.ref == _ref(track_id),
            Task.state.in_(("pending", "running")),
        )
        .first()
    )
    if existing is not None:
        return None
    return create_task(db, ANALYSIS_TASK_TYPE, {"track_id": track_id}, ref=_ref(track_id))


def enqueue_missing_analysis(db: Session) -> int:
    """Startup sweep: enqueue every Track still missing analysis.

    Missing = the grid side was never analyzed (no diagnostics row) and
    isn't protected by the ladder, or the Track has no key at all. Bailed
    tracks have diagnostics — they are done, not missing (no retry storms).
    """
    has_diagnostics = exists().where(
        models.GridAnalysis.track_id == models.Track.id
    )
    grid_protected = exists().where(
        and_(
            models.Beatgrid.track_id == models.Track.id,
            models.Beatgrid.origin.in_(GRID_PROTECTED_ORIGINS),
        )
    )
    rows = (
        db.query(models.Track.id)
        .filter(
            or_(
                and_(~has_diagnostics, ~grid_protected),
                models.Track.key.is_(None),
            )
        )
        .all()
    )
    enqueued = 0
    for (track_id,) in rows:
        if enqueue_analysis_task(db, track_id) is not None:
            enqueued += 1
    if enqueued:
        logger.info("enqueued %d analysis tasks", enqueued)
    return enqueued
