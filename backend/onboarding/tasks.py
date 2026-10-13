"""The Rekordbox onboarding import as a task (ADR 0003) with progress.

One import may be in flight at a time; the wizard polls
GET /api/onboarding/rekordbox/status, which combines the latest task row
with the in-memory progress below. The final ImportSummary is persisted
into the task's payload (key "summary") so it survives restarts.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from backend.tasks.manager import Handler, create_task
from backend.tasks.models import Task

from .rekordbox_import import detect_rekordbox_library, open_snapshot_db, run_import

logger = logging.getLogger(__name__)

ONBOARDING_IMPORT_TASK_TYPE = "rekordbox-onboarding-import"

_progress_lock = threading.Lock()
_progress: dict[str, Any] | None = None  # {"phase", "done", "total"}


def _set_progress(phase: str, done: int, total: int) -> None:
    global _progress
    with _progress_lock:
        _progress = {"phase": phase, "done": done, "total": total}


def get_progress() -> dict[str, Any] | None:
    with _progress_lock:
        return dict(_progress) if _progress is not None else None


def latest_import_task(db: Session) -> Task | None:
    return (
        db.query(Task)
        .filter(Task.type == ONBOARDING_IMPORT_TASK_TYPE)
        .order_by(Task.id.desc())
        .first()
    )


def import_in_flight(db: Session) -> bool:
    return (
        db.query(Task)
        .filter(
            Task.type == ONBOARDING_IMPORT_TASK_TYPE,
            Task.state.in_(["pending", "running"]),
        )
        .first()
        is not None
    )


def enqueue_onboarding_import(
    db: Session, library_dir: str, include_genre: bool = True
) -> Task | None:
    """Queue the import; None when one is already pending/running."""
    if import_in_flight(db):
        return None
    global _progress
    with _progress_lock:
        _progress = None
    return create_task(
        db,
        ONBOARDING_IMPORT_TASK_TYPE,
        {"library_dir": library_dir, "include_genre": include_genre},
    )


def make_onboarding_import_handler() -> Handler:
    def handler(db: Session, payload: dict[str, Any]) -> None:
        library_dir = payload.get("library_dir") or ""
        if not library_dir:
            detected = detect_rekordbox_library()
            if detected is None:
                raise ValueError("no Rekordbox library found")
            library_dir = str(detected)
        rb_db = open_snapshot_db(Path(library_dir))
        try:
            summary = run_import(
                db,
                rb_db,
                include_genre=bool(payload.get("include_genre", True)),
                progress=_set_progress,
            )
        finally:
            rb_db.close()
        # Persist the summary on our own task row (the worker marked it
        # running before calling us; its final commit carries this along).
        task = (
            db.query(Task)
            .filter(
                Task.type == ONBOARDING_IMPORT_TASK_TYPE, Task.state == "running"
            )
            .order_by(Task.id.desc())
            .first()
        )
        if task is not None:
            data = task.payload
            data["summary"] = summary.to_dict()
            task.payload_json = json.dumps(data)
        logger.info("onboarding import done: %s", summary.to_dict())

    return handler
