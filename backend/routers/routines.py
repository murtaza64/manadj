"""Routines: saved n-track choreography (ADR 0035, routines 158).

Read + rename + delete. Rows are minted by promotion
(POST /api/routine-takes/{uuid}/promote) — there is no direct create:
every Routine descends from a hand-confirmed Routine Take (v1; the
Routine editor may add authoring later). The list returns metadata only;
the slot-addressed beat-domain event replay rides the detail endpoint.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.database import get_db

router = APIRouter()


def _row(r: models.Routine) -> schemas.RoutineRow:
    return schemas.RoutineRow(
        uuid=r.uuid,
        name=r.name,
        cast=json.loads(r.cast_json),
        entry_offsets_beats=json.loads(r.entry_offsets_beats_json),
        entry_positions=json.loads(r.entry_positions_json),
        duration_beats=r.duration_beats,
        origin_take_uuid=r.origin_take_uuid,
        created_at=r.created_at,
    )


@router.get("", response_model=list[schemas.RoutineRow])
def list_routines(db: Session = Depends(get_db)) -> list[schemas.RoutineRow]:
    """All Routines, newest first."""
    rows = (
        db.query(models.Routine)
        .order_by(models.Routine.created_at.desc(), models.Routine.id.desc())
        .all()
    )
    return [_row(r) for r in rows]


@router.get("/{uuid}", response_model=schemas.RoutineDetail)
def get_routine(uuid: str, db: Session = Depends(get_db)) -> schemas.RoutineDetail:
    r = db.query(models.Routine).filter(models.Routine.uuid == uuid).first()
    if r is None:
        raise HTTPException(status_code=404, detail="routine not found")
    return schemas.RoutineDetail(
        **_row(r).model_dump(), events=json.loads(r.events_json)
    )


@router.patch("/{uuid}", response_model=schemas.RoutineRow)
def patch_routine(
    uuid: str, payload: schemas.RoutinePatch, db: Session = Depends(get_db)
) -> schemas.RoutineRow:
    """Rename — the only mutable field before the Routine editor exists."""
    r = db.query(models.Routine).filter(models.Routine.uuid == uuid).first()
    if r is None:
        raise HTTPException(status_code=404, detail="routine not found")
    r.name = payload.name
    db.commit()
    db.refresh(r)
    return _row(r)


@router.delete("/{uuid}")
def delete_routine(uuid: str, db: Session = Depends(get_db)) -> dict:
    """Delete a Routine and clear the promoted mark on its origin take —
    the evidence survives and may be re-promoted."""
    r = db.query(models.Routine).filter(models.Routine.uuid == uuid).first()
    if r is None:
        raise HTTPException(status_code=404, detail="routine not found")
    db.query(models.RoutineTake).filter(
        models.RoutineTake.promoted_routine_uuid == uuid
    ).update({models.RoutineTake.promoted_routine_uuid: None}, synchronize_session=False)
    db.delete(r)
    db.commit()
    return {"ok": True}
