"""Track-links API (linked-pairs PRD, issue 01).

Linked: a stored, symmetric assertion that two Tracks go well together —
one fact per unordered pair of distinct Tracks. The pair is normalized
server-side (low < high), so PUT a/b and PUT b/a address the same fact.
Write model mirrors the transitions router's minimal shape: one boot-load
GET plus an idempotent pair PUT.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.get("", response_model=list[schemas.TrackLinkRow])
def list_track_links(db: Session = Depends(get_db)):
    """All Linked pairs, ordered by pair (boot load)."""
    return (
        db.query(models.TrackLink)
        .order_by(models.TrackLink.low_track_id, models.TrackLink.high_track_id)
        .all()
    )


@router.put("/pair/{a_track_id}/{b_track_id}", response_model=schemas.TrackLinkState)
def set_pair_linked(
    a_track_id: int,
    b_track_id: int,
    payload: schemas.TrackLinkState,
    db: Session = Depends(get_db),
):
    """Idempotently set or clear the Linked fact for an unordered pair."""
    if a_track_id == b_track_id:
        raise HTTPException(status_code=400, detail="A Track cannot be Linked to itself")
    for track_id in (a_track_id, b_track_id):
        if db.query(models.Track.id).filter(models.Track.id == track_id).first() is None:
            raise HTTPException(status_code=404, detail=f"Track {track_id} not found")

    low, high = sorted((a_track_id, b_track_id))
    row = (
        db.query(models.TrackLink)
        .filter(
            models.TrackLink.low_track_id == low,
            models.TrackLink.high_track_id == high,
        )
        .first()
    )

    if payload.linked and row is None:
        db.add(models.TrackLink(low_track_id=low, high_track_id=high))
        db.commit()
    elif not payload.linked and row is not None:
        db.delete(row)
        db.commit()

    return schemas.TrackLinkState(linked=payload.linked)
