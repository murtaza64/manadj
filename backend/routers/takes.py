"""Takes: detected Handovers from live capture (transition-takes 02, ADR 0020).

Immutable audit rows — the write model is create-only (the frontend
detector POSTs a Take when a Handover settles), plus delete. The list
returns metadata only; the raw event slice rides the detail endpoint.
The promoted-Transition reference gets its write path with promotion
(issue 03).
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.database import get_db
from backend.routers.sets import degrade_pins

router = APIRouter()


def _row(t: models.Take) -> schemas.TakeRow:
    return schemas.TakeRow(
        uuid=t.uuid,
        a_track_id=t.a_track_id,
        b_track_id=t.b_track_id,
        detected_at=t.detected_at,
        window_start_s=t.window_start_s,
        window_end_s=t.window_end_s,
        confidence=t.confidence,
        detector_version=t.detector_version,
        promoted_transition_uuid=t.promoted_transition_uuid,
    )


@router.get("", response_model=list[schemas.TakeRow])
def list_takes(db: Session = Depends(get_db)) -> list[schemas.TakeRow]:
    """The Transition history, newest first."""
    rows = (
        db.query(models.Take)
        .order_by(models.Take.detected_at.desc(), models.Take.id.desc())
        .all()
    )
    return [_row(t) for t in rows]


@router.get("/{uuid}", response_model=schemas.TakeDetail)
def get_take(uuid: str, db: Session = Depends(get_db)) -> schemas.TakeDetail:
    t = db.query(models.Take).filter(models.Take.uuid == uuid).first()
    if t is None:
        raise HTTPException(status_code=404, detail="take not found")
    return schemas.TakeDetail(
        **_row(t).model_dump(),
        params=json.loads(t.params_json),
        events=json.loads(t.events_json),
    )


@router.post("", response_model=schemas.TakeRow)
def create_take(payload: schemas.TakeCreate, db: Session = Depends(get_db)) -> schemas.TakeRow:
    for track_id in (payload.a_track_id, payload.b_track_id):
        if db.query(models.Track.id).filter(models.Track.id == track_id).first() is None:
            raise HTTPException(status_code=404, detail=f"track {track_id} not found")
    if db.query(models.Take.id).filter(models.Take.uuid == payload.uuid).first() is not None:
        raise HTTPException(status_code=400, detail=f"duplicate take uuid {payload.uuid}")
    t = models.Take(
        uuid=payload.uuid,
        a_track_id=payload.a_track_id,
        b_track_id=payload.b_track_id,
        window_start_s=payload.window_start_s,
        window_end_s=payload.window_end_s,
        confidence=payload.confidence,
        detector_version=payload.detector_version,
        params_json=json.dumps(payload.params),
        events_json=json.dumps(payload.events),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _row(t)


@router.patch("/{uuid}/promoted", response_model=schemas.TakeRow)
def set_promoted(
    uuid: str, payload: schemas.TakePromotedPatch, db: Session = Depends(get_db)
) -> schemas.TakeRow:
    """Record (or clear) which Transition this Take was promoted into —
    the only mutable field on an otherwise immutable audit row (issue 03).

    Promotion also re-points Set pins (sets 08, ADR 0023): every
    set_entries pin referencing this Take is rewritten to the resulting
    Transition's uuid, right here at promotion time — a one-time
    migration, never query-time indirection. Dormant pins (sets 07)
    referencing the Take are rewritten the same way — the memory
    restores the Transition. Clearing (null) rewrites nothing:
    already-migrated pins stay on the Transition.
    """
    t = db.query(models.Take).filter(models.Take.uuid == uuid).first()
    if t is None:
        raise HTTPException(status_code=404, detail="take not found")
    t.promoted_transition_uuid = payload.promoted_transition_uuid
    if payload.promoted_transition_uuid is not None:
        db.query(models.SetEntry).filter(
            models.SetEntry.pin_kind == "take",
            models.SetEntry.pin_uuid == uuid,
        ).update(
            {
                models.SetEntry.pin_kind: "transition",
                models.SetEntry.pin_uuid: payload.promoted_transition_uuid,
            },
            synchronize_session=False,
        )
        db.query(models.SetDormantPin).filter(
            models.SetDormantPin.pin_kind == "take",
            models.SetDormantPin.pin_uuid == uuid,
        ).update(
            {
                models.SetDormantPin.pin_kind: "transition",
                models.SetDormantPin.pin_uuid: payload.promoted_transition_uuid,
            },
            synchronize_session=False,
        )
    db.commit()
    db.refresh(t)
    return _row(t)


@router.delete("/{uuid}")
def delete_take(uuid: str, db: Session = Depends(get_db)) -> dict:
    """Delete a Take. Set pins referencing it degrade to Unresolved
    (sets 12) — library cleanup never corrupts a Set."""
    t = db.query(models.Take).filter(models.Take.uuid == uuid).first()
    if t is None:
        raise HTTPException(status_code=404, detail="take not found")
    db.delete(t)
    degrade_pins(db, "take", {uuid})
    db.commit()
    return {"ok": True}
