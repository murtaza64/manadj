"""Routine Takes: hand-confirmed Routine spans (ADR 0035, routines 158).

The confirm side of the suggestion-first pipeline: the miner marks
candidate spans (routine_candidates, #157), a human confirms one on the
Session timeline — with boundary trim — into a Routine Take here. The
write model is create + delete, plus the one mechanical mutation:
`POST /{uuid}/promote` runs deck→slot re-addressing + beat-domain rebase
(backend/routine_promotion.py) and saves a Routine, recording
`promoted_routine_uuid` on the take. The raw take is never altered
(evidence doctrine — Take.promoted_transition_uuid parity).

n ≥ 3 enforced at create: a 2-cast confirm is a hand-cut Take and
belongs to POST /api/takes (origin "manual").
"""

import json
import uuid as uuid_mod

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.database import get_db
from backend.routine_preview import PreviewError, build_promotion_preview

router = APIRouter()


def _row(rt: models.RoutineTake) -> schemas.RoutineTakeRow:
    return schemas.RoutineTakeRow(
        uuid=rt.uuid,
        session_uuid=rt.session_uuid,
        cast=json.loads(rt.cast_json),
        window_start_s=rt.window_start_s,
        window_end_s=rt.window_end_s,
        entry_offsets=json.loads(rt.entry_offsets_json),
        origin_candidate_uuid=rt.origin_candidate_uuid,
        promoted_routine_uuid=rt.promoted_routine_uuid,
        confirmed_at=rt.confirmed_at,
    )


@router.get("", response_model=list[schemas.RoutineTakeRow])
def list_routine_takes(
    session_uuid: str | None = None, db: Session = Depends(get_db)
) -> list[schemas.RoutineTakeRow]:
    """Routine Takes, newest first (the Transition history reads this
    alongside GET /api/takes)."""
    query = db.query(models.RoutineTake)
    if session_uuid is not None:
        query = query.filter(models.RoutineTake.session_uuid == session_uuid)
    rows = query.order_by(
        models.RoutineTake.confirmed_at.desc(), models.RoutineTake.id.desc()
    ).all()
    return [_row(rt) for rt in rows]


@router.post("", response_model=schemas.RoutineTakeRow)
def create_routine_take(
    payload: schemas.RoutineTakeCreate, db: Session = Depends(get_db)
) -> schemas.RoutineTakeRow:
    """Confirm a candidate span (with boundary trim) into a Routine Take.

    The event slice stays a REFERENCE (session_uuid + window) — nothing is
    copied; the Session must exist at confirm time. n ≥ 3 is validated in
    the schema; the pydantic 422 carries the hand-cut-Take routing hint."""
    s = (
        db.query(models.Session)
        .filter(models.Session.uuid == payload.session_uuid)
        .first()
    )
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    if (
        db.query(models.RoutineTake.id)
        .filter(models.RoutineTake.uuid == payload.uuid)
        .first()
        is not None
    ):
        raise HTTPException(status_code=400, detail=f"duplicate routine take uuid {payload.uuid}")
    rt = models.RoutineTake(
        uuid=payload.uuid,
        session_uuid=payload.session_uuid,
        entry_track_id=payload.cast[0],
        exit_track_id=payload.cast[-1],
        cast_json=json.dumps(payload.cast),
        window_start_s=payload.window_start_s,
        window_end_s=payload.window_end_s,
        entry_offsets_json=json.dumps(payload.entry_offsets),
        origin_candidate_uuid=payload.origin_candidate_uuid,
    )
    db.add(rt)
    db.commit()
    db.refresh(rt)
    return _row(rt)


@router.post("/{uuid}/promote", response_model=schemas.RoutineRow)
def promote_routine_take(uuid: str, db: Session = Depends(get_db)) -> schemas.RoutineRow:
    """Mechanically promote: deck→slot re-addressing + beat-domain rebase
    via the cast Tracks' Beatgrids → a saved Routine. Idempotent-ish: an
    already-promoted take 400s (delete the Routine first to re-promote).
    The raw take row is untouched apart from `promoted_routine_uuid`."""
    rt = db.query(models.RoutineTake).filter(models.RoutineTake.uuid == uuid).first()
    if rt is None:
        raise HTTPException(status_code=404, detail="routine take not found")
    if rt.promoted_routine_uuid is not None:
        raise HTTPException(status_code=400, detail="already promoted")
    try:
        result = build_promotion_preview(
            db,
            rt.session_uuid,
            json.loads(rt.cast_json),
            rt.window_start_s,
            rt.window_end_s,
            json.loads(rt.entry_offsets_json),
        )
    except PreviewError as e:
        raise HTTPException(status_code=422, detail=str(e))

    routine = models.Routine(
        uuid=str(uuid_mod.uuid4()),
        name=None,
        entry_track_id=result.cast[0],
        exit_track_id=result.cast[-1],
        cast_json=json.dumps(result.cast),
        entry_offsets_beats_json=json.dumps(result.entry_offsets_beats),
        entry_positions_json=json.dumps(result.entry_positions),
        duration_beats=result.duration_beats,
        events_json=json.dumps(result.events),
        origin_take_uuid=rt.uuid,
        window_start_s=result.window_start_s,
        window_end_s=result.window_end_s,
    )
    db.add(routine)
    rt.promoted_routine_uuid = routine.uuid
    db.commit()
    db.refresh(routine)
    return schemas.RoutineRow(
        uuid=routine.uuid,
        name=routine.name,
        cast=result.cast,
        entry_offsets_beats=result.entry_offsets_beats,
        entry_positions=result.entry_positions,
        duration_beats=result.duration_beats,
        origin_take_uuid=routine.origin_take_uuid,
        created_at=routine.created_at,
    )


@router.get("/{uuid}/preview", response_model=schemas.RoutineDetail)
def preview_routine_take(uuid: str, db: Session = Depends(get_db)) -> schemas.RoutineDetail:
    """Promotion PREVIEW (#205 draft-everywhere): the exact geometry
    `POST /{uuid}/promote` would mint, persisted NOWHERE — the Mix editor
    opens the take as an editable, auditionable, discardable review draft;
    Promote stays the explicit persisting act. The synthetic uuid namespaces
    the client's draft store; it never lands in the routines table."""
    rt = db.query(models.RoutineTake).filter(models.RoutineTake.uuid == uuid).first()
    if rt is None:
        raise HTTPException(status_code=404, detail="routine take not found")
    try:
        result = build_promotion_preview(
            db,
            rt.session_uuid,
            json.loads(rt.cast_json),
            rt.window_start_s,
            rt.window_end_s,
            json.loads(rt.entry_offsets_json),
        )
    except PreviewError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return schemas.RoutineDetail(
        uuid=f"preview-take-{rt.uuid}",
        name=None,
        cast=result.cast,
        entry_offsets_beats=result.entry_offsets_beats,
        entry_positions=result.entry_positions,
        duration_beats=result.duration_beats,
        origin_take_uuid=None,
        created_at=None,
        events=result.events,
        edits=None,
    )


@router.delete("/{uuid}")
def delete_routine_take(uuid: str, db: Session = Depends(get_db)) -> dict:
    """Delete a Routine Take. Its promoted Routine (if any) survives —
    library artifacts never die with their evidence."""
    rt = db.query(models.RoutineTake).filter(models.RoutineTake.uuid == uuid).first()
    if rt is None:
        raise HTTPException(status_code=404, detail="routine take not found")
    db.delete(rt)
    db.commit()
    return {"ok": True}
