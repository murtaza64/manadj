"""API routes for hot cues."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Dict, List
from .. import crud, schemas
from ..database import get_db

router = APIRouter()


# Declared before /{track_id} so "bulk" never parses as a track id.
@router.get("/bulk", response_model=Dict[int, List[schemas.HotCue]])
def get_hotcues_bulk(
    track_ids: str = Query(..., description="Comma-separated track ids"),
    db: Session = Depends(get_db),
):
    """Hot cues for many tracks in one request, keyed by track id.

    Tracks without cues are present with an empty list, so the client can
    distinguish "no cues" from "not asked". (Set open: issue 43.)
    """
    try:
        ids = [int(part) for part in track_ids.split(",") if part.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="track_ids must be comma-separated integers")
    result: Dict[int, List[schemas.HotCue]] = {tid: [] for tid in ids}
    for cue in crud.get_hotcues_bulk(db, ids):
        result[cue.track_id].append(schemas.HotCue.model_validate(cue))
    return result


@router.get("/{track_id}", response_model=List[schemas.HotCue])
def get_hotcues(track_id: int, db: Session = Depends(get_db)):
    """Get all hot cues for a track."""
    return crud.get_hotcues(db, track_id)


@router.put("/{track_id}/{slot_number}", response_model=schemas.HotCue)
def set_hotcue(
    track_id: int,
    slot_number: int,
    data: schemas.HotCueSet,
    db: Session = Depends(get_db)
):
    """Set or update a hot cue (stored verbatim — snapping is client-side)."""
    if not 1 <= slot_number <= 8:
        raise HTTPException(status_code=400, detail="Slot number must be between 1 and 8")

    return crud.set_hotcue(
        db,
        track_id=track_id,
        slot_number=slot_number,
        time_seconds=data.time_seconds,
        label=data.label,
        color=data.color
    )


@router.delete("/{track_id}/{slot_number}")
def delete_hotcue(track_id: int, slot_number: int, db: Session = Depends(get_db)):
    """Delete a hot cue."""
    if not 1 <= slot_number <= 8:
        raise HTTPException(status_code=400, detail="Slot number must be between 1 and 8")

    deleted = crud.delete_hotcue(db, track_id, slot_number)
    if not deleted:
        raise HTTPException(status_code=404, detail="Hot cue not found")

    return {"message": "Hot cue deleted"}
