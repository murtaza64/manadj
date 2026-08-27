"""Stem splitting on the task system (ADR 0003; stems map #118, build #195).

Mirrors the waveform/analysis pattern: creation sites and the startup sweep
enqueue `stem-split` tasks; the handler runs the subprocess pipeline
(backend/stems.py). One manadj-specific twist: the **backlog guard** — the
sweep refuses to enqueue a large backlog (a full-library split is ~4.5 h on
the serial FIFO worker and would starve waveform/analysis tasks). The
initial/full backfill is the bulk script's job (scripts/backfill_stems.py),
human-initiated.

A failing split raises normally → the task fails immediately (no retry storm;
manager retries only RateLimitedError automatically).
"""

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from . import crud
from .config import get_config
from .models import Track
from .stems import is_current, split_track
from .tasks.manager import create_task
from .tasks.models import Task

logger = logging.getLogger(__name__)

STEM_SPLIT_TASK_TYPE = "stem-split"

# Sweep backlog guard: above this many missing tracks, the sweep enqueues
# nothing and points at the backfill script instead.
BACKLOG_GUARD = 20

# The split callable is an injectable seam (ADR-0002: heavy audio work is
# fakeable — the real one shells out to demucs for ~15 s per track).
Split = Callable[[int, Path], Any]


def _ref(track_id: int) -> str:
    return f"track:{track_id}"


def make_stem_split_handler(split: Split | None = None):
    """Build the task handler for `stem-split` tasks."""

    def handle(db: Session, payload: dict[str, Any]) -> None:
        track_id = int(payload["track_id"])
        track = crud.get_track(db, track_id)
        if track is None:
            raise LookupError(f"track {track_id} not found")
        source = Path(track.filename)
        if is_current(track_id, source):
            return  # someone (the backfill script?) got here first
        if split is not None:
            split(track_id, source)
        else:
            split_track(track_id, source)

    return handle


def enqueue_stem_split(db: Session, track_id: int) -> Task | None:
    """Enqueue a split for one Track; no-op if one is already queued/running."""
    existing = (
        db.query(Task)
        .filter(
            Task.type == STEM_SPLIT_TASK_TYPE,
            Task.ref == _ref(track_id),
            Task.state.in_(("pending", "running")),
        )
        .first()
    )
    if existing is not None:
        return None
    return create_task(db, STEM_SPLIT_TASK_TYPE, {"track_id": track_id}, ref=_ref(track_id))


def missing_stem_tracks(db: Session) -> list[Track]:
    """Active Tracks whose stems are stale/absent (currency check per #149)."""
    config = get_config().stems
    tracks = db.query(Track).filter(Track.is_active).all()
    return [t for t in tracks if not is_current(t.id, Path(t.filename), config)]


def enqueue_missing_stems(db: Session, guard: int = BACKLOG_GUARD) -> int:
    """Startup sweep with the backlog guard. Returns tasks enqueued.

    Post-backfill this catches the trickle of new imports; pre-backfill (or
    after a model/STEMS_VERSION change) the backlog is the whole library, and
    splitting it belongs to the human-initiated bulk script, not the worker.
    """
    missing = missing_stem_tracks(db)
    if len(missing) > guard:
        logger.warning(
            "stems sweep: %d tracks lack current stems (> guard %d) — "
            "enqueuing nothing; run `uv run scripts/backfill_stems.py`",
            len(missing),
            guard,
        )
        return 0
    enqueued = 0
    for track in missing:
        if enqueue_stem_split(db, track.id) is not None:
            enqueued += 1
    if enqueued:
        logger.info("enqueued %d stem-split tasks", enqueued)
    return enqueued
