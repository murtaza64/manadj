"""Waveform generation on the task system (ADR-0003; waveform-overhaul issue 02).

Replaces the ad-hoc polling daemon (`waveform_worker.py`): Track creation sites
enqueue a `waveform` task, and a startup sweep enqueues tasks for any Track
still missing Waveform data (including pre-v2 rows whose blob column is NULL).

Two generation paths, until the legacy renderer dies (issues 04/06):
- no waveform row at all → full generation (legacy JSON/PNG + v2 blob)
- row exists, `data_blob` NULL → v2 blob backfill only (fast path, no librosa)
"""

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from . import crud, models
from .tasks.manager import create_task
from .tasks.models import Task
from .waveform_data import generate_blob

logger = logging.getLogger(__name__)

WAVEFORM_TASK_TYPE = "waveform"

# The full-generation callable is an injectable seam (ADR-0002: audio analysis
# is a fakeable seam — the legacy path drags librosa).
FullGenerate = Callable[[Session, int, str], Any]


def _ref(track_id: int) -> str:
    return f"track:{track_id}"


def make_waveform_handler(full_generate: FullGenerate | None = None):
    """Build the task handler for `waveform` tasks."""

    def handle(db: Session, payload: dict[str, Any]) -> None:
        track_id = int(payload["track_id"])
        track = crud.get_track(db, track_id)
        if track is None:
            raise LookupError(f"track {track_id} not found")
        waveform = crud.get_waveform(db, track_id)
        if waveform is None:
            full = full_generate if full_generate is not None else crud.create_waveform
            full(db, track_id, track.filename)
        else:
            has_blob = (
                db.query(models.Waveform.data_blob)
                .filter(models.Waveform.track_id == track_id)
                .scalar()
                is not None
            )
            if not has_blob:
                blob = generate_blob(track.filename)
                db.query(models.Waveform).filter(
                    models.Waveform.track_id == track_id
                ).update({"data_blob": blob})
                db.commit()

    return handle


def enqueue_waveform_task(db: Session, track_id: int) -> Task | None:
    """Enqueue generation for one Track; no-op if one is already queued/running."""
    existing = (
        db.query(Task)
        .filter(
            Task.type == WAVEFORM_TASK_TYPE,
            Task.ref == _ref(track_id),
            Task.state.in_(("pending", "running")),
        )
        .first()
    )
    if existing is not None:
        return None
    return create_task(db, WAVEFORM_TASK_TYPE, {"track_id": track_id}, ref=_ref(track_id))


def enqueue_missing_waveforms(db: Session) -> int:
    """Startup sweep: enqueue every Track lacking Waveform data. Returns count."""
    rows = (
        db.query(models.Track.id)
        .outerjoin(models.Waveform, models.Waveform.track_id == models.Track.id)
        .filter(or_(models.Waveform.id.is_(None), models.Waveform.data_blob.is_(None)))
        .all()
    )
    enqueued = 0
    for (track_id,) in rows:
        if enqueue_waveform_task(db, track_id) is not None:
            enqueued += 1
    if enqueued:
        logger.info("enqueued %d waveform generation tasks", enqueued)
    return enqueued
