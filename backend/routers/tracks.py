"""API routes for tracks."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
from pathlib import Path
import mimetypes
from .. import crud, schemas, models
from ..database import get_db
from ..id3_utils import extract_id3_metadata

router = APIRouter()


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
    items, total = crud.get_tracks(
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
        key_camelot_ids=key_camelot_ids
    )

    return {
        "items": items,
        "total": total,
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
    update_data: schemas.TrackUpdate,
    db: Session = Depends(get_db)
):
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Update title if provided
    if update_data.title is not None:
        track.title = update_data.title

    # Update artist if provided
    if update_data.artist is not None:
        track.artist = update_data.artist

    # Update energy if provided
    if update_data.energy is not None:
        if not 1 <= update_data.energy <= 5:
            raise HTTPException(status_code=400, detail="Energy must be 1-5")
        track.energy = update_data.energy

    # Update tags if provided
    if update_data.tag_ids is not None:
        track = crud.update_track_tags(db, track_id, update_data.tag_ids)

    db.commit()
    db.refresh(track)

    # Reload to get tags with categories
    track = crud.get_track(db, track_id)
    return track


@router.post("/refresh-metadata")
def refresh_metadata(
    track_id: int | None = Query(None),
    db: Session = Depends(get_db)
):
    """
    Refresh ID3 metadata for tracks.

    If track_id is provided, refresh only that track.
    Otherwise, refresh metadata for all tracks.
    """
    if track_id is not None:
        # Refresh single track
        track = crud.get_track(db, track_id)
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")

        metadata = extract_id3_metadata(track.filename)
        track.title = metadata["title"]
        track.artist = metadata["artist"]
        track.key = metadata["key"]
        # Convert BPM to centiBPM (multiply by 100) for storage
        track.bpm = int(metadata["bpm"] * 100) if metadata["bpm"] is not None else None

        db.commit()
        db.refresh(track)

        return {"message": f"Refreshed metadata for track {track_id}", "track": track}

    else:
        # Refresh all tracks
        tracks = db.query(models.Track).all()
        updated_count = 0

        for track in tracks:
            metadata = extract_id3_metadata(track.filename)
            track.title = metadata["title"]
            track.artist = metadata["artist"]
            track.key = metadata["key"]
            # Convert BPM to centiBPM (multiply by 100) for storage
            track.bpm = int(metadata["bpm"] * 100) if metadata["bpm"] is not None else None
            updated_count += 1

        db.commit()

        return {"message": f"Refreshed metadata for {updated_count} tracks", "count": updated_count}


@router.get("/{track_id}/audio")
def get_track_audio(track_id: int, db: Session = Depends(get_db)):
    """Stream audio file for a track."""
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    file_path = Path(track.filename)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Detect MIME type
    mime_type, _ = mimetypes.guess_type(str(file_path))
    if mime_type is None:
        mime_type = "audio/mpeg"

    # Stream file
    def iterfile():
        with open(file_path, "rb") as f:
            yield from f

    return StreamingResponse(
        iterfile(),
        media_type=mime_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f"inline; filename=\"{file_path.name}\""
        }
    )
