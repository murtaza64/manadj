"""Grid+key analysis on the task system (ADR 0003; native-analysis-accuracy 10,
task-system 01).

Track creation sites enqueue an `analysis` task (like waveform generation);
a startup sweep enqueues tracks still missing analysis. The handler runs the
ladder-respecting bulk path (issue 09) — new tracks have no saved info so
the ladder is a no-op for them, and a swept track with protected values is
skipped without touching audio.

The Analyze button enqueues the same task type with `manual: true` in its
payload (task-system 01): the handler then runs the overwrite-free path
(analyze_track_grid + analyze_track_key directly) so explicit intent
overwrites regardless of provenance, exactly as the old synchronous
/api/analyze endpoints did — but now with observable state, errors, retry,
and history like every other task.

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
from .grid_analysis import analyze_track_grid, default_grid_analyzer
from .key_analysis import analyze_track_key, default_key_candidate
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
        if payload.get("manual"):
            # Explicit intent (the Analyze button): overwrite freely, bypass
            # the ladder — the old synchronous /api/analyze behavior.
            diagnostics = analyze_track_grid(db, track, analyzer)
            detected, _confidence = analyze_track_key(db, track, key_candidate)
            logger.info(
                "manual analysis task for track %d: grid %s, key %s",
                track_id,
                "bailed" if diagnostics.bailed else "written",
                "written" if detected is not None else "undetected",
            )
        else:
            outcome = bulk_analyze_track(db, track, analyzer, key_candidate)
            logger.info(
                "analysis task for track %d: grid %s, key %s",
                track_id,
                outcome.grid,
                outcome.key,
            )

    return handle


def enqueue_analysis_task(
    db: Session, track_id: int, manual: bool = False
) -> Task | None:
    """Enqueue analysis for one Track; no-op if one is already queued/running.

    `manual=True` marks the task as an explicit Analyze-button run: the handler
    overwrites freely instead of respecting the ladder. A manual request will
    still dedup against an in-flight task of either kind (one analysis at a
    time per track) — the pending/running task already does the work.
    """
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
    payload: dict[str, Any] = {"track_id": track_id}
    if manual:
        payload["manual"] = True
    return create_task(db, ANALYSIS_TASK_TYPE, payload, ref=_ref(track_id))


def list_inflight_analysis_tasks(db: Session) -> list[Task]:
    """Every pending/running analysis task — the bulk view the frontend
    polls (analysis-curation 03): one request tells it every Track being
    analyzed, whoever enqueued it (import, sweep, or the Analyze button)."""
    return (
        db.query(Task)
        .filter(
            Task.type == ANALYSIS_TASK_TYPE,
            Task.state.in_(("pending", "running")),
        )
        .order_by(Task.id)
        .all()
    )


def latest_analysis_task(db: Session, track_id: int) -> Task | None:
    """The most recent analysis task for a Track, if any — the observable
    state the Analyze button polls (like the download-task status map)."""
    return (
        db.query(Task)
        .filter(Task.type == ANALYSIS_TASK_TYPE, Task.ref == _ref(track_id))
        .order_by(Task.id.desc())
        .first()
    )


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
