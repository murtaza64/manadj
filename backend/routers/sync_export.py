"""Performance-data export endpoints: Library → Rekordbox.

Foundation slice (rekordbox-perf-export/01): the key verb plus the
injectable exporter dependency later slices (cues, grid) reuse. Mirrors
the Engine import router's dependency posture so tests fake the exporter
seam (ADR 0002/0004)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend import crud, models
from backend.database import get_db

router = APIRouter(prefix="/sync/export", tags=["sync"])


def get_rekordbox_perf_exporter():
    """Dependency: a write session against the Rekordbox DB. 503 when
    Rekordbox is not configured, 409 while it is running. Overridden
    with a fake in tests."""
    from pathlib import Path

    from backend.config import get_config
    from rekordbox.perf_export import (
        RekordboxPerfExporter,
        RekordboxRunningError,
        ensure_rekordbox_closed,
    )

    path = get_config().database.rekordbox_path
    if not path or not Path(path).exists():
        raise HTTPException(status_code=503, detail="Rekordbox library not available")
    try:
        ensure_rekordbox_closed()
    except RekordboxRunningError as e:
        raise HTTPException(status_code=409, detail=str(e))
    from rekordbox.connection import get_rekordbox_db

    return RekordboxPerfExporter(get_rekordbox_db(), Path(path))


def _track_or_404(db: Session, track_id: int) -> models.Track:
    track = crud.get_track(db, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


class KeyExportRequest(BaseModel):
    track_id: int


@router.post("/key/rekordbox")
def export_key_endpoint(
    request: KeyExportRequest,
    db: Session = Depends(get_db),
    exporter=Depends(get_rekordbox_perf_exporter),
):
    """Write the Library's key onto the matching Rekordbox track.
    Overwrites Rekordbox's saved key — the frontend confirms first."""
    from rekordbox.perf_export import RekordboxRunningError, TrackNotInRekordboxError

    track = _track_or_404(db, request.track_id)
    if track.key is None:
        raise HTTPException(
            status_code=409, detail="Library has no key for this track"
        )
    try:
        scale = exporter.export_key(track.filename, track.key)
    except TrackNotInRekordboxError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RekordboxRunningError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"exported": True, "key": scale}
