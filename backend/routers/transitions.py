"""Transitions API (ADR 0011).

The write model is client-authoritative: the editor's debounced autosave
replaces a whole pair's Transition set in one PUT, and this router
reconciles rows by (a_track_id, b_track_id, uuid) — update matching,
insert new, delete absent. Position is the payload index (cosmetic append
order; identity never rides on it).
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from .sets import degrade_pins

router = APIRouter()


def _row(t: models.Transition) -> schemas.TransitionRow:
    return schemas.TransitionRow(
        a_track_id=t.a_track_id,
        b_track_id=t.b_track_id,
        uuid=t.uuid,
        position=t.position,
        name=t.name,
        favorite=t.favorite,
        data=json.loads(t.data_json),
        updated_at=t.updated_at,
    )


@router.get("", response_model=list[schemas.TransitionRow])
def list_transitions(db: Session = Depends(get_db)):
    """All saved Transitions, ordered by pair then position (boot load)."""
    rows = (
        db.query(models.Transition)
        .order_by(
            models.Transition.a_track_id,
            models.Transition.b_track_id,
            models.Transition.position,
        )
        .all()
    )
    return [_row(t) for t in rows]


@router.put("/pair/{a_track_id}/{b_track_id}", response_model=list[schemas.TransitionRow])
def replace_pair(
    a_track_id: int,
    b_track_id: int,
    payload: schemas.TransitionPairReplace,
    db: Session = Depends(get_db),
):
    """Replace the ordered pair's Transition set (reconcile by uuid).

    An empty items list deletes the pair's rows. Idempotent: re-PUTting
    the same payload is a no-op (rows keep their ids).
    """
    for track_id in (a_track_id, b_track_id):
        if db.query(models.Track.id).filter(models.Track.id == track_id).first() is None:
            raise HTTPException(status_code=404, detail=f"Track {track_id} not found")

    existing = {
        t.uuid: t
        for t in db.query(models.Transition)
        .filter(
            models.Transition.a_track_id == a_track_id,
            models.Transition.b_track_id == b_track_id,
        )
        .all()
    }

    seen_uuids = set()
    for position, item in enumerate(payload.items):
        if item.uuid in seen_uuids:
            raise HTTPException(status_code=400, detail=f"Duplicate uuid {item.uuid}")
        seen_uuids.add(item.uuid)
        data_json = json.dumps(item.data)
        row = existing.get(item.uuid)
        if row is None:
            db.add(
                models.Transition(
                    a_track_id=a_track_id,
                    b_track_id=b_track_id,
                    uuid=item.uuid,
                    position=position,
                    name=item.name,
                    favorite=item.favorite,
                    data_json=data_json,
                )
            )
        else:
            row.position = position
            row.name = item.name
            row.favorite = item.favorite
            row.data_json = data_json

    deleted_uuids = set()
    for uuid, row in existing.items():
        if uuid not in seen_uuids:
            db.delete(row)
            deleted_uuids.add(uuid)
    # Set pins referencing a deleted Transition degrade to Unresolved
    # (sets 12) — library cleanup never corrupts a Set.
    degrade_pins(db, "transition", deleted_uuids)

    db.commit()

    rows = (
        db.query(models.Transition)
        .filter(
            models.Transition.a_track_id == a_track_id,
            models.Transition.b_track_id == b_track_id,
        )
        .order_by(models.Transition.position)
        .all()
    )
    return [_row(t) for t in rows]
