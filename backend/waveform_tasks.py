"""Waveform generation on the task system (ADR-0003; waveform-overhaul issue 02).

Replaces the ad-hoc polling daemon (`waveform_worker.py`): Track creation sites
enqueue a `waveform` task, and a startup sweep enqueues tasks for any Track
still missing Waveform data (including pre-v2 rows whose blob column is NULL).

Missing full data is generated from audio together with its bounded preview.
Preview-only backfill reads stored full data, never the audio file.
"""

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from . import crud, models
from .tasks.manager import create_task
from .tasks.models import Task
from .waveform_data import build_preview_blob, generate_blob

logger = logging.getLogger(__name__)

WAVEFORM_TASK_TYPE = "waveform"

# The full-generation callable is an injectable audio analysis seam (ADR-0002).
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
            has_blob, has_preview = (
                db.query(
                    models.Waveform.data_blob.is_not(None),
                    models.Waveform.preview_blob.is_not(None),
                )
                .filter(models.Waveform.track_id == track_id)
                .one()
            )
            if has_blob and has_preview:
                return
            if not has_blob:
                blob = generate_blob(track.filename)
            else:
                blob = waveform.data_blob
            values = {"preview_blob": build_preview_blob(blob)}
            if not has_blob:
                values["data_blob"] = blob
            db.query(models.Waveform).filter(
                models.Waveform.track_id == track_id
            ).update(values)
            db.commit()

    return handle


def enqueue_waveform_task(db: Session, track_id: int) -> Task | None:
    """Enqueue missing artifacts; no-op when complete or already queued/running.

    Boolean projections keep this safe for request-time use, including archived
    tracks displayed outside the active Library.
    """
    artifacts = (
        db.query(
            models.Waveform.data_blob.is_not(None),
            models.Waveform.preview_blob.is_not(None),
        )
        .filter(models.Waveform.track_id == track_id)
        .first()
    )
    if artifacts is not None and all(artifacts):
        return None
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
    """Startup sweep: enqueue every active Track lacking Waveform data.

    Archived tracks are out of the active Library, so the sweep skips them
    (like the analysis sweep); unarchiving puts a waveform-less track back
    in reach of the next sweep. Returns count.
    """
    rows = (
        db.query(models.Track.id)
        .outerjoin(models.Waveform, models.Waveform.track_id == models.Track.id)
        .filter(
            models.Track.is_active,
            or_(
                models.Waveform.id.is_(None),
                models.Waveform.data_blob.is_(None),
                models.Waveform.preview_blob.is_(None),
            ),
        )
        .all()
    )
    enqueued = 0
    for (track_id,) in rows:
        if enqueue_waveform_task(db, track_id) is not None:
            enqueued += 1
    if enqueued:
        logger.info("enqueued %d waveform generation tasks", enqueued)
    return enqueued
