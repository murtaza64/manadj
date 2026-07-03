"""API routes for tracks."""

import logging
import mimetypes
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import crud, schemas, track_metadata
from ..database import get_db
from ..track_metadata import MetadataComparisonResult, MetadataSyncRequest, MetadataSyncResult, TrackChanges

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=schemas.PaginatedTracks)
def list_tracks(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=10000),
    tag_ids: List[int] | None = Query(None),
    search: str | None = Query(None),
    energy_min: int | None = Query(None, ge=1, le=5),
    energy_max: int | None = Query(None, ge=1, le=5),
    tag_match_mode: str = Query("ANY", pattern="^(ANY|ALL)$"),
    bpm_center: int | None = Query(None, ge=1, le=300),
    bpm_threshold_percent: int | None = Query(None, ge=0, le=100),
    key_camelot_ids: List[str] | None = Query(None),
    unprocessed: bool | None = Query(None),
    sort_column: str | None = Query(
        None,
        pattern="^(key|bpm|energy|title|artist|created_at|bitrate_kbps|filesize_bytes|provenance)$",
    ),
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db)
):
    # Validate energy range
    if energy_min is not None and energy_max is not None and energy_min > energy_max:
        raise HTTPException(status_code=400, detail="energy_min must be <= energy_max")

    # Validate BPM parameters (both or neither required)
    if (bpm_center is None) != (bpm_threshold_percent is None):
        raise HTTPException(
            status_code=400,
            detail="Both bpm_center and bpm_threshold_percent must be provided together"
        )

    skip = (page - 1) * per_page
    items, total, library_total = crud.get_tracks(
        db,
        skip=skip,
        limit=per_page,
        tag_ids=tag_ids,
        search=search,
        energy_min=energy_min,
        energy_max=energy_max,
        tag_match_mode=tag_match_mode,
        bpm_center=bpm_center,
        bpm_threshold_percent=bpm_threshold_percent,
        key_camelot_ids=key_camelot_ids,
        unprocessed=unprocessed,
        sort_column=sort_column,
        sort_direction=sort_direction
    )

    # attach Audio Provenance (schemas.Track.provenance)
    provenance_map = crud.get_provenance_map(db, [t.id for t in items])
    for item in items:
        item.provenance = provenance_map.get(item.id)

    return {
        "items": items,
        "total": total,
        "library_total": library_total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page
    }


@router.get("/{track_id}", response_model=schemas.Track)
def get_track(track_id: int, db: Session = Depends(get_db)):
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


@router.post("/", response_model=schemas.Track, status_code=201)
def create_track(track: schemas.TrackCreate, db: Session = Depends(get_db)):
    return crud.create_track(db, track)


@router.patch("/{track_id}", response_model=schemas.Track)
def update_track(
    track_id: int,
    changes: TrackChanges,
    db: Session = Depends(get_db)
):
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    track_metadata.apply_update(db, track, changes)

    # Reload to get tags with categories
    return crud.get_track(db, track_id)


@router.post("/refresh-metadata")
def refresh_metadata(
    track_id: int | None = Query(None),
    db: Session = Depends(get_db)
):
    """Refresh DB metadata from file tags (file wins) — one track or all."""
    try:
        count = track_metadata.refresh_from_files(db, track_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Track not found")

    if track_id is not None:
        return {
            "message": f"Refreshed metadata for track {track_id}",
            "track": crud.get_track(db, track_id),
        }
    return {"message": f"Refreshed metadata for {count} tracks", "count": count}


@router.get("/{track_id}/audio")
def get_track_audio(track_id: int, db: Session = Depends(get_db)):
    """Serve a track's audio file (with HTTP Range support)."""
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    file_path = Path(track.filename)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    mime_type, _ = mimetypes.guess_type(str(file_path))
    if mime_type is None:
        mime_type = "audio/mpeg"

    # FileResponse does efficient chunked sends and real 206 Range responses.
    # (Its predecessor here iterated the file *by line*, which shredded audio
    # into a huge number of tiny chunks and made fetches extremely slow.)
    return FileResponse(
        file_path,
        media_type=mime_type,
        filename=file_path.name,
        content_disposition_type="inline",
    )


@router.get("/metadata/compare", response_model=MetadataComparisonResult)
def compare_metadata(db: Session = Depends(get_db)):
    """Compare database metadata with file tags for all tracks."""
    return track_metadata.compare_with_files(db)


@router.post("/metadata/sync", response_model=MetadataSyncResult)
def sync_metadata(request: MetadataSyncRequest, db: Session = Depends(get_db)):
    """Apply metadata changes to the database (dry_run supported)."""
    return track_metadata.sync_to_db(db, request)


@router.post("/metadata/write-to-files", response_model=MetadataSyncResult)
def write_metadata_to_files(request: MetadataSyncRequest, db: Session = Depends(get_db)):
    """Write database metadata into file tags (dry_run supported)."""
    return track_metadata.write_to_files(db, request)
