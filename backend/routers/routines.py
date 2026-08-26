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
from backend.beatgrid_utils import constant_tempo_changes
from backend.database import get_db
from backend.routers.sets import degrade_pins
from backend.routine_promotion import PromotionError, retrim

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


def _detail(r: models.Routine) -> schemas.RoutineDetail:
    return schemas.RoutineDetail(
        **_row(r).model_dump(),
        events=json.loads(r.events_json),
        edits=json.loads(r.edits_json) if r.edits_json else None,
    )


@router.get("/{uuid}", response_model=schemas.RoutineDetail)
def get_routine(uuid: str, db: Session = Depends(get_db)) -> schemas.RoutineDetail:
    r = db.query(models.Routine).filter(models.Routine.uuid == uuid).first()
    if r is None:
        raise HTTPException(status_code=404, detail="routine not found")
    return _detail(r)


@router.put("/{uuid}/edits", response_model=schemas.RoutineDetail)
def put_routine_edits(
    uuid: str, payload: schemas.RoutineEditsPut, db: Session = Depends(get_db)
) -> schemas.RoutineDetail:
    """Replace the authored edits layer (gh#170 pass 2). The recording
    (events_json) is evidence and never changes; edits are the Routine
    editor's draft — lane envelopes + Jumps, beat-domain — applied at
    replay-build time by every consumer (editor audition AND set
    Conductor). Null clears."""
    r = db.query(models.Routine).filter(models.Routine.uuid == uuid).first()
    if r is None:
        raise HTTPException(status_code=404, detail="routine not found")
    r.edits_json = json.dumps(payload.edits) if payload.edits else None
    db.commit()
    db.refresh(r)
    return _detail(r)


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


@router.post("/{uuid}/retrim", response_model=schemas.RoutineDetail)
def retrim_routine(
    uuid: str, payload: schemas.RoutineRetrim, db: Session = Depends(get_db)
) -> schemas.RoutineDetail:
    """Boundary trim + mechanical re-promotion (gh#170, the v1 review
    affordance promised at confirm time): re-run promotion over the origin
    Routine Take with the window moved by beat amounts from either edge
    (positive narrows, negative widens — gh#170 follow-up). The amounts
    are relative to the routine's CURRENT window (gh#190: the editor's
    axis is the current routine clock, so a second trim must not measure
    against the take's original bounds), which is stored on the Routine
    and updated here; pre-#190 rows fall back to the take window once.
    The Routine row updates IN PLACE (same uuid — Set pins keep their
    reference and re-validate against the new cast/boundaries at plan
    time); the raw take is untouched. 422 when the origin take or its
    Session is gone, or when the trim breaks n ≥ 3."""
    r = db.query(models.Routine).filter(models.Routine.uuid == uuid).first()
    if r is None:
        raise HTTPException(status_code=404, detail="routine not found")
    if r.origin_take_uuid is None:
        raise HTTPException(
            status_code=422, detail="routine has no origin take — boundaries are baked"
        )
    rt = (
        db.query(models.RoutineTake)
        .filter(models.RoutineTake.uuid == r.origin_take_uuid)
        .first()
    )
    if rt is None:
        raise HTTPException(
            status_code=422, detail="the origin Routine Take is gone — cannot re-promote"
        )
    s = db.query(models.Session).filter(models.Session.uuid == rt.session_uuid).first()
    if s is None:
        raise HTTPException(
            status_code=422,
            detail="the take's Session is gone — its event slice reference cannot be read",
        )
    events: list[dict] = []
    for chunk in s.chunks:
        events.extend(json.loads(chunk.events_json))

    # Measure against the routine's CURRENT window (gh#190). The cast is
    # the routine's current cast — a prefix of the take's (end trims drop
    # a suffix; start trims never drop). Entry instants are fixed session
    # evidence, so current-window offsets re-derive from the take's:
    # clamped at 0 for slots whose true entry precedes the current start
    # (the narrow-rebase rule).
    cur_s0 = r.window_start_s if r.window_start_s is not None else rt.window_start_s
    cur_s1 = r.window_end_s if r.window_end_s is not None else rt.window_end_s
    take_offsets = json.loads(rt.entry_offsets_json)
    cast = json.loads(r.cast_json)
    if len(cast) > len(take_offsets) or cast != json.loads(rt.cast_json)[: len(cast)]:
        raise HTTPException(
            status_code=422,
            detail="routine cast no longer derives from the origin take — cannot re-promote",
        )
    offsets = [
        max(0.0, rt.window_start_s + take_offsets[i] - cur_s0) for i in range(len(cast))
    ]
    grids: dict[int, list[dict]] = {}
    for tid in cast:
        bg = db.query(models.Beatgrid).filter(models.Beatgrid.track_id == tid).first()
        if bg is not None:
            grids[tid] = json.loads(bg.tempo_changes_json)
            continue
        track = db.query(models.Track).filter(models.Track.id == tid).first()
        bpm = track.bpm_projected if track is not None else None
        if bpm is None or bpm <= 0:
            raise HTTPException(
                status_code=422, detail=f"cast track {tid} has no beatgrid or BPM"
            )
        grids[tid] = constant_tempo_changes(bpm)

    try:
        result = retrim(
            events,
            cast,
            cur_s0,
            cur_s1,
            offsets,
            grids,
            payload.trim_start_beats,
            payload.trim_end_beats,
        )
    except PromotionError as e:
        raise HTTPException(status_code=422, detail=str(e))

    r.entry_track_id = result.cast[0]
    r.exit_track_id = result.cast[-1]
    r.cast_json = json.dumps(result.cast)
    r.entry_offsets_beats_json = json.dumps(result.entry_offsets_beats)
    r.entry_positions_json = json.dumps(result.entry_positions)
    r.duration_beats = result.duration_beats
    r.events_json = json.dumps(result.events)
    r.window_start_s = result.window_start_s
    r.window_end_s = result.window_end_s
    # Authored edits ride the trim (gh#170 pass 2): beats rebase by the
    # start trim; entries falling outside the new span (or on dropped
    # slots) drop. Best-effort — removed-recorded-jump matches may
    # resurface if the rebased clock lands off their tolerance.
    if r.edits_json:
        shifted = _shift_edits(
            json.loads(r.edits_json),
            payload.trim_start_beats,
            result.duration_beats,
            len(result.cast),
        )
        r.edits_json = json.dumps(shifted) if shifted else None
    db.commit()
    db.refresh(r)
    return _detail(r)


def _shift_edits(
    edits: dict, shift_beats: float, new_duration: float, kept_slots: int
) -> dict | None:
    """Rebase an edits layer onto a retrimmed Routine's clock."""
    lanes: dict = {}
    for key, pts in (edits.get("lanes") or {}).items():
        try:
            slot = int(str(key).split(":")[0])
        except ValueError:
            continue
        if slot >= kept_slots or not isinstance(pts, list):
            continue
        shifted = [
            {**p, "beat": p["beat"] - shift_beats}
            for p in pts
            if isinstance(p, dict) and isinstance(p.get("beat"), (int, float))
        ]
        shifted = [p for p in shifted if -1e-6 <= p["beat"] <= new_duration + 1e-6]
        if shifted:
            lanes[key] = shifted
    def rebase(items: list, needs_delta: bool) -> list:
        out = []
        for j in items or []:
            if not isinstance(j, dict):
                continue
            slot = j.get("slot")
            beat = j.get("beat")
            if not isinstance(slot, int) or slot >= kept_slots:
                continue
            if not isinstance(beat, (int, float)):
                continue
            if needs_delta and not isinstance(j.get("deltaSec"), (int, float)):
                continue
            nb = beat - shift_beats
            if nb < 0 or nb > new_duration:
                continue
            out.append({**j, "beat": nb})
        return out
    jumps = rebase(edits.get("jumps") or [], needs_delta=True)
    removed = rebase(edits.get("removedRecordedJumps") or [], needs_delta=False)
    # Alignment nudges (gh#190 item 6) are beat-free track-time slides —
    # they ride the trim untouched, minus dropped slots.
    nudges = {}
    for key, val in (edits.get("nudges") or {}).items():
        try:
            slot = int(str(key))
        except ValueError:
            continue
        if slot < kept_slots and isinstance(val, (int, float)) and val:
            nudges[str(slot)] = val
    if not lanes and not jumps and not removed and not nudges:
        return None
    return {
        "lanes": lanes,
        "jumps": jumps,
        "removedRecordedJumps": removed,
        "nudges": nudges,
    }


@router.delete("/{uuid}")
def delete_routine(uuid: str, db: Session = Depends(get_db)) -> dict:
    """Delete a Routine and clear the promoted mark on its origin take —
    the evidence survives and may be re-promoted. Set pins referencing
    it degrade to Unresolved; Dormant memories of it are dropped
    (sets 12 rule, extended to routine pins in sets 160)."""
    r = db.query(models.Routine).filter(models.Routine.uuid == uuid).first()
    if r is None:
        raise HTTPException(status_code=404, detail="routine not found")
    db.query(models.RoutineTake).filter(
        models.RoutineTake.promoted_routine_uuid == uuid
    ).update({models.RoutineTake.promoted_routine_uuid: None}, synchronize_session=False)
    degrade_pins(db, "routine", {uuid})
    db.delete(r)
    db.commit()
    return {"ok": True}
