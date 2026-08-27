"""Cameos API (cameos PRD, #140).

The Cameo sibling of the transitions router (ADR 0011): the write model
is client-authoritative — a whole ordered (host, guest) pair's Cameo set
replaces in one PUT, reconciled by uuid — update matching, insert new,
delete absent. Position is the payload index (cosmetic append order;
identity never rides on it). Deleting a Cameo DROPS Set Cameo pins
referencing it (there is no Unresolved for ornaments — degrade = drop).
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from .sets import degrade_cameo_pins

router = APIRouter()


def _row(c: models.Cameo) -> schemas.CameoRow:
    return schemas.CameoRow(
        host_track_id=c.host_track_id,
        guest_track_id=c.guest_track_id,
        uuid=c.uuid,
        position=c.position,
        name=c.name,
        favorite=c.favorite,
        data=json.loads(c.data_json),
        updated_at=c.updated_at,
    )


@router.get("", response_model=list[schemas.CameoRow])
def list_cameos(db: Session = Depends(get_db)):
    """All saved Cameos, ordered by (host, guest) pair then position."""
    rows = (
        db.query(models.Cameo)
        .order_by(
            models.Cameo.host_track_id,
            models.Cameo.guest_track_id,
            models.Cameo.position,
        )
        .all()
    )
    return [_row(c) for c in rows]


@router.put(
    "/pair/{host_track_id}/{guest_track_id}", response_model=list[schemas.CameoRow]
)
def replace_pair(
    host_track_id: int,
    guest_track_id: int,
    payload: schemas.CameoPairReplace,
    db: Session = Depends(get_db),
):
    """Replace the ordered (host, guest) pair's Cameo set (reconcile by
    uuid). host == guest is legal (a self-Cameo). An empty items list
    deletes the pair's rows. Idempotent, like the Transition pair PUT.
    """
    for track_id in {host_track_id, guest_track_id}:
        if db.query(models.Track.id).filter(models.Track.id == track_id).first() is None:
            raise HTTPException(status_code=404, detail=f"Track {track_id} not found")

    existing = {
        c.uuid: c
        for c in db.query(models.Cameo)
        .filter(
            models.Cameo.host_track_id == host_track_id,
            models.Cameo.guest_track_id == guest_track_id,
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
                models.Cameo(
                    host_track_id=host_track_id,
                    guest_track_id=guest_track_id,
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
    # Set Cameo pins referencing a deleted Cameo are dropped (#140) —
    # library cleanup never corrupts a Set.
    degrade_cameo_pins(db, "cameo", deleted_uuids)

    db.commit()

    rows = (
        db.query(models.Cameo)
        .filter(
            models.Cameo.host_track_id == host_track_id,
            models.Cameo.guest_track_id == guest_track_id,
        )
        .order_by(models.Cameo.position)
        .all()
    )
    return [_row(c) for c in rows]
