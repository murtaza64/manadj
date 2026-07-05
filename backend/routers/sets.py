"""Sets API (sets PRD, issue 01).

A Set is an ordered sequence of Tracks whose adjacencies pin evidence
(issue 02) — a plan over the library, never an owner: deleting a Set
touches no Track/Transition/Take.

Set metadata is plain CRUD (mirroring playlists). The entry list is
client-authoritative (ADR 0011): the client owns Set state and replaces
the whole ordered list in one PUT, reconciled by track_id (entry
identity — a Track appears at most once per Set). Position is the
payload index.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db

router = APIRouter()


def _get_set(db: Session, set_id: int) -> models.Set:
    row = db.query(models.Set).filter(models.Set.id == set_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Set {set_id} not found")
    return row


def _with_entries(db: Session, set_id: int) -> models.Set:
    row = (
        db.query(models.Set)
        .options(selectinload(models.Set.entries))
        .filter(models.Set.id == set_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Set {set_id} not found")
    return row


@router.get("", response_model=list[schemas.SetRow])
def list_sets(db: Session = Depends(get_db)):
    """All Sets, in sidebar order."""
    return (
        db.query(models.Set)
        .order_by(models.Set.display_order, models.Set.id)
        .all()
    )


@router.post("", response_model=schemas.SetRow, status_code=201)
def create_set(payload: schemas.SetCreate, db: Session = Depends(get_db)):
    row = models.Set(
        name=payload.name,
        color=payload.color,
        display_order=payload.display_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{set_id}", response_model=schemas.SetWithEntries)
def get_set(set_id: int, db: Session = Depends(get_db)):
    """One Set with its ordered entries."""
    return _with_entries(db, set_id)


@router.patch("/{set_id}", response_model=schemas.SetRow)
def update_set(set_id: int, payload: schemas.SetUpdate, db: Session = Depends(get_db)):
    """Update Set properties (name, color, display_order)."""
    row = _get_set(db, set_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{set_id}", status_code=204)
def delete_set(set_id: int, db: Session = Depends(get_db)):
    """Delete a Set (entries go with it; Tracks/Transitions/Takes stay)."""
    row = _get_set(db, set_id)
    db.delete(row)
    db.commit()
    return None


@router.post("/reorder", status_code=200)
def reorder_sets(order: list[schemas.SetOrderItem], db: Session = Depends(get_db)):
    """Reorder Sets in the sidebar."""
    for item in order:
        db.query(models.Set).filter(models.Set.id == item.id).update(
            {"display_order": item.display_order}
        )
    db.commit()
    return {"message": "Sets reordered"}


@router.put("/{set_id}/entries", response_model=schemas.SetWithEntries)
def replace_entries(
    set_id: int,
    payload: schemas.SetEntriesReplace,
    db: Session = Depends(get_db),
):
    """Replace the Set's ordered entry list (reconcile by track_id).

    An empty items list clears the Set. Idempotent: re-PUTting the same
    payload is a no-op (rows keep their ids).
    """
    _get_set(db, set_id)

    seen: set[int] = set()
    for item in payload.items:
        if item.track_id in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate track {item.track_id}")
        seen.add(item.track_id)
        if db.query(models.Track.id).filter(models.Track.id == item.track_id).first() is None:
            raise HTTPException(status_code=404, detail=f"Track {item.track_id} not found")

    existing = {
        e.track_id: e
        for e in db.query(models.SetEntry).filter(models.SetEntry.set_id == set_id).all()
    }

    for position, item in enumerate(payload.items):
        entry = existing.get(item.track_id)
        if entry is None:
            db.add(models.SetEntry(set_id=set_id, track_id=item.track_id, position=position))
        else:
            entry.position = position

    for track_id, entry in existing.items():
        if track_id not in seen:
            db.delete(entry)

    db.commit()
    return _with_entries(db, set_id)
