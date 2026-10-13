"""Onboarding: "Add a tracks directory" (#276) — Scan the configured
tracks directory recursively and Disk Import every new audio file in
place, as a task (ADR 0003) with progress the guide polls.

Never enqueues stems (onboarding posture, like the Rekordbox import);
waveforms + missing analysis come from LibraryImportManager.import_tracks.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

from sqlalchemy.orm import Session

from backend.config import get_config
from backend.library.import_manager import LibraryImportManager
from backend.tasks.manager import Handler, create_task
from backend.tasks.models import Task

logger = logging.getLogger(__name__)

TRACKS_DIRECTORY_IMPORT_TASK_TYPE = "tracks-directory-import"

_lock = threading.Lock()
_progress: dict[str, Any] | None = None  # {"phase", "done", "total"}


def _set_progress(phase: str, done: int, total: int) -> None:
    global _progress
    with _lock:
        _progress = {"phase": phase, "done": done, "total": total}


def get_progress() -> dict[str, Any] | None:
    with _lock:
        return dict(_progress) if _progress is not None else None


def scan_and_import(db: Session, directory: str, progress=_set_progress) -> dict[str, Any]:
    """Recursive Scan + in-place Disk Import of new files. Idempotent:
    files already in the Library (archived included) are counted, not
    re-imported."""
    manager = LibraryImportManager(db, directory)
    progress("scanning", 0, 0)
    scan = manager.get_import_candidates(
        recursive=True, progress=lambda done, total: progress("scanning", done, total)
    )
    candidates = scan.candidates
    progress("importing", 0, len(candidates))
    executed = manager.import_tracks(candidates, stem_guard=0) if candidates else None
    progress("importing", len(candidates), len(candidates))
    return {
        "directory": directory,
        "files_scanned": scan.stats.files_scanned,
        "already_in_library": scan.stats.already_in_db,
        "imported": executed.imported if executed else 0,
        "errors": executed.errors if executed else 0,
        "error_messages": (executed.error_messages if executed else [])[:20],
    }


def latest_task(db: Session) -> Task | None:
    return (
        db.query(Task)
        .filter(Task.type == TRACKS_DIRECTORY_IMPORT_TASK_TYPE)
        .order_by(Task.id.desc())
        .first()
    )


def enqueue_tracks_directory_import(db: Session) -> Task | None:
    """Queue a Scan of the configured tracks directory; None when one is
    already pending/running."""
    in_flight = (
        db.query(Task)
        .filter(
            Task.type == TRACKS_DIRECTORY_IMPORT_TASK_TYPE,
            Task.state.in_(["pending", "running"]),
        )
        .first()
    )
    if in_flight is not None:
        return None
    global _progress
    with _lock:
        _progress = None
    return create_task(db, TRACKS_DIRECTORY_IMPORT_TASK_TYPE, {})


def make_tracks_directory_import_handler() -> Handler:
    def handler(db: Session, payload: dict[str, Any]) -> None:
        directory = get_config().library.tracks_directory
        if not directory:
            raise ValueError("Tracks directory is not set")
        summary = scan_and_import(db, directory)
        task = (
            db.query(Task)
            .filter(
                Task.type == TRACKS_DIRECTORY_IMPORT_TASK_TYPE, Task.state == "running"
            )
            .order_by(Task.id.desc())
            .first()
        )
        if task is not None:
            data = task.payload
            data["summary"] = summary
            task.payload_json = json.dumps(data)
        logger.info("tracks directory import done: %s", summary)

    return handler
