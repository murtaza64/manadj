"""API routes for hot cues."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import crud, schemas
from ..database import get_db

router = APIRouter()


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
