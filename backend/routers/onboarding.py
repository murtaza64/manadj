"""Onboarding endpoints: Rekordbox library detection, import preview,
import run (as a task), and status for the wizard to poll (#274)."""

from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..onboarding import rekordbox_import as rb_import
from ..onboarding.tasks import (
    enqueue_onboarding_import,
    get_progress,
    latest_import_task,
)

router = APIRouter()


class DetectResponse(BaseModel):
    found: bool
    library_dir: str | None


class ImportRequest(BaseModel):
    include_genre: bool = True


@router.get("/rekordbox/detect", response_model=DetectResponse)
def detect_rekordbox():
    """Locate the Rekordbox library (config override, else pyrekordbox's
    own config discovery) — no snapshot taken."""
    found = rb_import.detect_rekordbox_library()
    return DetectResponse(found=found is not None, library_dir=str(found) if found else None)


@router.get("/rekordbox/preview")
def preview_rekordbox_import(db: Session = Depends(get_db)):
    """Snapshot the library and return import counts for the wizard."""
    library_dir = rb_import.detect_rekordbox_library()
    if library_dir is None:
        raise HTTPException(status_code=404, detail="No Rekordbox library found")
    rb_db = rb_import.open_snapshot_db(Path(library_dir))
    try:
        preview = asdict(rb_import.preview_import(db, rb_db))
        # Show the user's library, not the snapshot copy we actually read.
        preview["library_dir"] = str(library_dir)
        return preview
    finally:
        rb_db.close()


@router.post("/rekordbox/import")
def start_rekordbox_import(request: ImportRequest, db: Session = Depends(get_db)):
    """Queue the bulk import task. 409 when one is already in flight."""
    library_dir = rb_import.detect_rekordbox_library()
    if library_dir is None:
        raise HTTPException(status_code=404, detail="No Rekordbox library found")
    task = enqueue_onboarding_import(
        db, str(library_dir), include_genre=request.include_genre
    )
    if task is None:
        raise HTTPException(status_code=409, detail="An import is already in flight")
    return {"task_id": task.id}


@router.get("/rekordbox/status")
def rekordbox_import_status(db: Session = Depends(get_db)):
    """Latest import task state + live progress + final summary."""
    task = latest_import_task(db)
    if task is None:
        return {"state": "none", "progress": None, "summary": None, "error": None}
    return {
        "state": task.state,
        "progress": get_progress() if task.state == "running" else None,
        "summary": task.payload.get("summary"),
        "error": task.error,
    }
