"""Performance-data export endpoints: Library → Rekordbox.

Foundation slice (rekordbox-perf-export/01): the key verb plus the
injectable exporter dependency later slices (cues, grid) reuse. Mirrors
the Engine import router's dependency posture so tests fake the exporter
seam (ADR 0002/0004)."""

from typing import Literal

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


class HotcueExportRequest(BaseModel):
    track_id: int
    # add-only: new slots only, never touches existing RB rows (the
    # unconfirmed tier); replace-all: full mirror reconcile (confirmed) —
    # moves update both mirror rows, RB-only cues are soft-deleted
    mode: Literal["add-only", "replace-all"]


@router.post("/hotcues/rekordbox")
def export_hotcues_endpoint(
    request: HotcueExportRequest,
    db: Session = Depends(get_db),
    exporter=Depends(get_rekordbox_perf_exporter),
):
    """Write the Library's hot cues onto the matching Rekordbox track,
    mirrored to hot + memory cues (issue 08 semantics)."""
    from rekordbox.perf_export import RekordboxRunningError, TrackNotInRekordboxError

    track = _track_or_404(db, request.track_id)
    cues = [(c.slot_number, c.time_seconds, c.label, c.color) for c in track.hotcues]
    if not cues:
        raise HTTPException(
            status_code=409, detail="Library has no hot cues for this track"
        )
    try:
        return exporter.export_hotcues(track.filename, cues, request.mode)
    except TrackNotInRekordboxError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RekordboxRunningError as e:
        raise HTTPException(status_code=409, detail=str(e))


class BeatgridExportRequest(BaseModel):
    track_id: int  # always the confirmed tier: grid export overwrites RB's


@router.post("/beatgrid/rekordbox")
def export_beatgrid_endpoint(
    request: BeatgridExportRequest,
    db: Session = Depends(get_db),
    exporter=Depends(get_rekordbox_perf_exporter),
):
    """Author the Rekordbox grid (ANLZ PQTZ + BPM scalar) from the
    Library's saved Beatgrid. Placeholder grids never export."""
    from backend.sync_status.compare import beatgrid_value_from_row

    from rekordbox.perf_export import RekordboxRunningError, TrackNotInRekordboxError

    track = _track_or_404(db, request.track_id)
    grid = beatgrid_value_from_row(track.beatgrid)
    if grid is None or not grid.tempo_changes:
        raise HTTPException(
            status_code=409,
            detail="Library has no saved grid for this track (placeholders don't export)",
        )
    waveform = getattr(track, "waveform", None)
    end_s = getattr(waveform, "duration", None)
    try:
        return exporter.export_beatgrid(track.filename, grid.tempo_changes, end_s)
    except TrackNotInRekordboxError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RekordboxRunningError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (LookupError, ValueError) as e:
        raise HTTPException(status_code=409, detail=str(e))


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


class AutoExportRequest(BaseModel):
    track_ids: list[int] | None = None  # None = whole Library


@router.post("/rekordbox/auto")
def auto_export_endpoint(
    request: AutoExportRequest,
    db: Session = Depends(get_db),
    exporter=Depends(get_rekordbox_perf_exporter),
):
    """The auto tier (issue 08 semantics): values NEW in the Library flow
    out to Rekordbox without confirmation — hot cues add-only (existing
    RB rows never touched), key only where Rekordbox has none. Grids are
    never auto-exported: an analyzed RB track always has one (authoring
    is the confirmed replace verb), an unanalyzed one can't be authored.
    """
    from rekordbox.perf_export import RekordboxRunningError, TrackNotInRekordboxError

    query = db.query(models.Track)
    if request.track_ids is not None:
        query = query.filter(models.Track.id.in_(request.track_ids))
    summary = {"scanned": 0, "matched": 0, "cues_added": 0, "keys_set": 0,
               "unmatched": 0}
    for track in query.all():
        cues = [(c.slot_number, c.time_seconds, c.label, c.color) for c in track.hotcues]
        if not cues and track.key is None:
            continue
        summary["scanned"] += 1
        try:
            if cues:
                result = exporter.export_hotcues(track.filename, cues, "add-only")
                summary["cues_added"] += result["added"]
            if track.key is not None:
                if exporter.export_key(track.filename, track.key, only_if_absent=True):
                    summary["keys_set"] += 1
            summary["matched"] += 1
        except TrackNotInRekordboxError:
            summary["unmatched"] += 1
        except RekordboxRunningError as e:
            raise HTTPException(status_code=409, detail=str(e))
    return summary


class PlaylistFullExportRequest(BaseModel):
    targets: list[Literal["rekordbox", "engine"]]


def get_playlist_full_export_service(db: Session = Depends(get_db)):
    from backend.playlist_full_export import build_playlist_full_export_service

    return build_playlist_full_export_service(db)


@router.post("/playlists/{playlist_name}/performance")
def export_playlist_performance_endpoint(
    playlist_name: str,
    request: PlaylistFullExportRequest,
    service=Depends(get_playlist_full_export_service),
):
    if not request.targets:
        raise HTTPException(status_code=422, detail="Select at least one destination")
    try:
        return service.export(playlist_name, request.targets)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


def get_playlist_full_export_previewer(db: Session = Depends(get_db)):
    from backend.playlist_full_export import preview_playlist_full_export

    def previewer(playlist_name: str, targets: list[str]) -> dict:
        return preview_playlist_full_export(db, playlist_name, targets)

    return previewer


@router.get("/playlists/{playlist_name}/performance/preview")
def preview_playlist_performance_endpoint(
    playlist_name: str,
    previewer=Depends(get_playlist_full_export_previewer),
):
    """Read-only plan of a full playlist export: create vs replace, add/remove/
    reorder counts, and unmatched tracks per destination. Writes nothing."""
    try:
        return previewer(playlist_name, ["rekordbox", "engine"])
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
