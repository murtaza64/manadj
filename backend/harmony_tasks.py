"""Harmony analysis on the task system (ADR 0003; chord-match #387).

Same pattern as waveform/analysis/stems: Track creation enqueues a `harmony`
task (after stem-split, so in the FIFO compute lane it runs on fresh stems
and the analyzed grid), a completed stem split re-enqueues it, and the
startup sweep catches anything missing, stale (HARMONY_VERSION bump), or
analyzed from the full mix whose stems have since become current. Bulk
backfill: scripts/backfill_harmony.py.

A Track without a Beatgrid is skipped (no row); it is picked up once the
grid exists.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy.orm import Session

from . import crud, models
from .harmony import HARMONY_VERSION, HarmonyResult, analyze_track_audio
from .stems import is_current, stems_dir
from .tasks.manager import create_task
from .tasks.models import Task

logger = logging.getLogger(__name__)

HARMONY_TASK_TYPE = "harmony"

# Sweep backlog guard: above this many tracks, enqueue nothing.
BACKLOG_GUARD = 50

# The analysis callable is an injectable seam (ADR-0002): (tempo_changes,
# mix path, current stems dir or None) -> HarmonyResult.
Analyze = Callable[[list[dict], str, Path | None], HarmonyResult]


def _ref(track_id: int) -> str:
    return f"track:{track_id}"


def current_stems_dir(track: models.Track) -> Path | None:
    """The Track's stem dir when its stems are current, else None (mix)."""
    try:
        if is_current(track.id, Path(track.filename)):
            return stems_dir(track.id)
    except OSError:
        pass
    return None


def store_result(db: Session, track_id: int, result: HarmonyResult) -> models.Harmony:
    row = db.query(models.Harmony).filter(models.Harmony.track_id == track_id).first()
    if row is None:
        row = models.Harmony(track_id=track_id)
        db.add(row)
    row.analyzer_version = HARMONY_VERSION
    row.source = result.source
    row.bar_count = len(result.bar_chroma)
    row.first_bar_s = float(result.bar_starts[0]) if len(result.bar_starts) else None
    row.bar_chroma_blob = result.bar_chroma.astype(np.float16).tobytes()
    if result.drop is not None:
        row.drop_start_bar, row.drop_end_bar = result.drop
        row.drop_start_s = float(result.bar_starts[result.drop[0]])
    else:
        row.drop_start_bar = row.drop_end_bar = row.drop_start_s = None
    loop = result.loop
    row.loop_blob = loop.loop.astype(np.float32).tobytes() if loop else None
    row.loop_reps = loop.reps if loop else None
    row.movement = loop.movement if loop else None
    row.consistency = loop.consistency if loop else None
    db.commit()
    return row


def analyze_and_store(
    db: Session, track: models.Track, analyze: Analyze | None = None
) -> models.Harmony | None:
    """Analyze one Track and persist; None (nothing written) without a grid."""
    grid = db.query(models.Beatgrid).filter(models.Beatgrid.track_id == track.id).first()
    if grid is None:
        return None
    tempo_changes = json.loads(grid.tempo_changes_json)
    result = (analyze or analyze_track_audio)(
        tempo_changes, track.filename, current_stems_dir(track)
    )
    return store_result(db, track.id, result)


def make_harmony_handler(analyze: Analyze | None = None):
    """Build the task handler for `harmony` tasks."""

    def handle(db: Session, payload: dict[str, Any]) -> None:
        track_id = int(payload["track_id"])
        track = crud.get_track(db, track_id)
        if track is None:
            raise LookupError(f"track {track_id} not found")
        row = analyze_and_store(db, track, analyze)
        if row is None:
            logger.info("harmony: track %d has no beatgrid; skipped", track_id)

    return handle


def enqueue_harmony_task(db: Session, track_id: int) -> Task | None:
    """Enqueue harmony analysis; no-op if one is already queued/running."""
    existing = (
        db.query(Task)
        .filter(
            Task.type == HARMONY_TASK_TYPE,
            Task.ref == _ref(track_id),
            Task.state.in_(("pending", "running")),
        )
        .first()
    )
    if existing is not None:
        return None
    return create_task(db, HARMONY_TASK_TYPE, {"track_id": track_id}, ref=_ref(track_id))


def tracks_needing_harmony(db: Session) -> list[models.Track]:
    """Active Tracks with a Beatgrid whose harmony row is missing, from an
    older analyzer, or from the mix while current stems now exist."""
    rows = (
        db.query(models.Track, models.Harmony.analyzer_version, models.Harmony.source)
        .join(models.Beatgrid, models.Beatgrid.track_id == models.Track.id)
        .outerjoin(models.Harmony, models.Harmony.track_id == models.Track.id)
        .filter(models.Track.is_active)
        .all()
    )
    out = []
    for track, version, source in rows:
        if version is None or version < HARMONY_VERSION:
            out.append(track)
        elif source == "mix" and current_stems_dir(track) is not None:
            out.append(track)
    return out


def enqueue_missing_harmony(db: Session, guard: int = BACKLOG_GUARD) -> int:
    """Startup sweep with a backlog guard (like stems): a whole-library
    backlog (first run, HARMONY_VERSION bump) is the backfill script's job,
    not the FIFO compute lane's. Returns tasks enqueued."""
    needing = tracks_needing_harmony(db)
    if len(needing) > guard:
        logger.warning(
            "harmony sweep: %d tracks need analysis (> guard %d) — enqueuing "
            "nothing; run `uv run scripts/backfill_harmony.py`",
            len(needing),
            guard,
        )
        return 0
    enqueued = 0
    for track in needing:
        if enqueue_harmony_task(db, track.id) is not None:
            enqueued += 1
    if enqueued:
        logger.info("enqueued %d harmony tasks", enqueued)
    return enqueued
