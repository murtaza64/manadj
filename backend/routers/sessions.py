"""Sessions: the persisted whole capture-event log (Sessions PRD, ADR 0033,
amended sessions 11).

One row per stretch of live performance — the client opens a row on the
first Master-audible instant and splits after ten continuous minutes of
silence — streamed to disk as append-only chunks (~5s flush). The write
model is create + append + end + delete; the list returns headers only (no
chunks) with a derived Take count. Chunks are opaque JSON arrays of the
capture event vocabulary — the same posture as a Take's slice.

No 100%-silent Session survives (sessions 11): ending a silent row deletes
it (shutdown and the auto-split both end through that route), and recovery
sweeps every silent row — open orphans and closed legacy rows alike.

Deleting a Session cascades its chunks and NEVER touches a Take: Takes keep
their own event slice and remain self-contained (ADR 0033). The Session id a
Take carries is provenance, not a dependency.
"""

import json
from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session, object_session

from backend import models, schemas
from backend.database import get_db
from backend.peer_sync.group_history import deny_group_uuid, owns_uuid
from backend.peer_sync.group_history import views as group_views
from backend.routine_miner_tasks import enqueue_routine_mine
from backend.session_audibility import events_contain_audible
from backend.session_source import deny_peer_write, peer_audio, replay_generation, session_events

router = APIRouter()


def _drop_routine_candidates(db: Session, session_uuid: str) -> None:
    """Suggestion rows die with their Session (routines 157): a candidate
    span without its timeline is meaningless — unlike Takes, which are
    self-contained evidence and survive."""
    db.query(models.RoutineCandidate).filter(
        models.RoutineCandidate.session_uuid == session_uuid
    ).delete()


def _is_silent(s: models.Session) -> bool:
    """True when no instant of the Session's stream had a Master-audible
    Deck (sessions 11) — chunk by chunk, short-circuiting on the first
    audible instant, so real Sessions stop at their opening seconds."""

    if s.peer_history is not None or s.group_history is not None or owns_uuid(object_session(s), s.uuid):
        return False  # immutable source was complete/audible at materialization

    def _events():
        for chunk in s.chunks:  # relationship order: seq
            yield from json.loads(chunk.events_json)

    return not events_contain_audible(_events())


def _row(db: Session, s: models.Session, projections=None) -> schemas.SessionRow:
    take_count = (
        db.query(func.count(models.Take.id))
        .filter(models.Take.session_uuid == s.uuid)
        .scalar()
    )
    return schemas.SessionRow(
        uuid=s.uuid,
        started_at=s.started_at,
        ended_at=s.ended_at,
        take_count=take_count or 0,
        origin=s.origin,
        group_history=group_views(db, s.uuid) if projections is None else projections,
    )


@router.get("", response_model=list[schemas.SessionRow])
def list_sessions(db: Session = Depends(get_db)) -> list[schemas.SessionRow]:
    """The Sessions list, newest first — headers + Take count, no chunks."""
    rows = (
        db.query(models.Session)
        .order_by(models.Session.started_at.desc(), models.Session.id.desc())
        .all()
    )
    projections = {}
    for projection in group_views(db):
        projections.setdefault(str(projection.session_uuid), []).append(projection)
    result = [_row(db, s, projections.get(s.uuid, [])) for s in rows]
    present = {s.uuid for s in rows}
    for uuid, items in projections.items():
        if uuid not in present and any(item.status != "invalid" for item in items):
            result.append(schemas.SessionRow(uuid=uuid, started_at=items[0].started_at,
                ended_at=items[0].ended_at, origin=items[0].origin.label, take_count=0, group_history=items))
    return sorted(result, key=lambda row: row.started_at.replace(tzinfo=UTC), reverse=True)


@router.post("", response_model=schemas.SessionRow)
def create_session(
    payload: schemas.SessionCreate, db: Session = Depends(get_db)
) -> schemas.SessionRow:
    """Open a Session (recorder start). Idempotent on the client uuid is
    not offered — a duplicate uuid is a client bug (400)."""
    deny_group_uuid(db, payload.uuid)
    if db.query(models.Session.id).filter(models.Session.uuid == payload.uuid).first() is not None:
        raise HTTPException(status_code=400, detail=f"duplicate session uuid {payload.uuid}")
    s = models.Session(uuid=payload.uuid)
    if payload.started_at is not None:
        s.started_at = payload.started_at
    db.add(s)
    db.commit()
    db.refresh(s)
    return _row(db, s)


@router.post("/recover")
def recover_open_sessions(db: Session = Depends(get_db)) -> dict:
    """Close Sessions orphaned by a renderer crash/reload; sweep silent rows.

    `ended_at IS NULL` means the end request never reached the backend, not
    necessarily that the recorder is still alive. Boot calls this before it
    opens a new Session. Audible orphans close at the last persisted chunk
    time, so downtime is not counted as performance duration. Any 100%-silent
    row — an empty or silent orphan, or a closed legacy row from before
    audible-only activation — is deleted instead (sessions 11): no
    empty/silent history entry survives recovery.
    """
    closed = 0
    deleted = 0
    for s in db.query(models.Session).all():
        if _is_silent(s):
            _drop_routine_candidates(db, s.uuid)
            db.delete(s)
            deleted += 1
        elif s.ended_at is None:
            last_chunk_at = (
                db.query(func.max(models.SessionChunk.created_at))
                .filter(models.SessionChunk.session_id == s.id)
                .scalar()
            )
            s.ended_at = last_chunk_at or s.started_at
            closed += 1
            # A recovered close is a close: mine it (routines 157).
            enqueue_routine_mine(db, s.uuid)
    db.commit()
    return {"closed": closed, "deleted": deleted}


@router.get("/{uuid}", response_model=schemas.SessionDetail)
def get_session(uuid: str, db: Session = Depends(get_db)) -> schemas.SessionDetail:
    """One Session with its whole event log: chunks concatenated in seq
    order (the relationship's order_by). The diagnostic/inspection seam —
    the persisted events, readable through the app boundary."""
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    projections = group_views(db, uuid)
    if projections:
        if s is None and all(view.status == "invalid" for view in projections):
            raise HTTPException(409, "invalid_group_session_evidence")
        header = _row(db, s, projections) if s is not None else schemas.SessionRow(uuid=uuid,
            started_at=projections[0].started_at, ended_at=projections[0].ended_at,
            take_count=0, origin=projections[0].origin.label, group_history=projections)
        return schemas.SessionDetail(**header.model_dump(), events=[], replay_generation=None)
    deny_group_uuid(db, uuid)
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    events = session_events(db, s)
    header = _row(db, s)
    return schemas.SessionDetail(**header.model_dump(), events=events, replay_generation=replay_generation(s))


@router.get("/{uuid}/audio/{track_id}")
def get_peer_audio(uuid: str, track_id: int, generation: str, db: Session = Depends(get_db)):
    deny_group_uuid(db, uuid)
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None or s.peer_history is None:
        raise HTTPException(404, "peer_history_not_found")
    data = peer_audio(db, s, track_id, generation)
    return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


@router.post("/{uuid}/chunks", response_model=schemas.SessionRow)
def append_chunk(
    uuid: str, payload: schemas.SessionChunkAppend, db: Session = Depends(get_db)
) -> schemas.SessionRow:
    """Append one batch of events. `seq` must be new within the Session — a
    duplicate seq is a client retry bug (400); the sink never retries."""
    deny_group_uuid(db, uuid)
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    deny_peer_write(s)
    dup = (
        db.query(models.SessionChunk.id)
        .filter(models.SessionChunk.session_id == s.id, models.SessionChunk.seq == payload.seq)
        .first()
    )
    if dup is not None:
        raise HTTPException(status_code=400, detail=f"duplicate chunk seq {payload.seq}")
    db.add(
        models.SessionChunk(
            session_id=s.id,
            seq=payload.seq,
            events_json=json.dumps(payload.events),
        )
    )
    db.commit()
    db.refresh(s)
    return _row(db, s)


@router.patch("/{uuid}/end", response_model=schemas.SessionRow)
def end_session(
    uuid: str, payload: schemas.SessionEndPatch, db: Session = Depends(get_db)
) -> schemas.SessionRow:
    """Close a Session (recorder dispose / page-hide / ten-minute split).
    Setting ended_at on an already-ended Session just overwrites it —
    closing twice is harmless. A 100%-silent Session is deleted instead of
    closed (sessions 11): shutdown and the auto-split both end through
    here, and neither may leave a silent history entry."""
    deny_group_uuid(db, uuid)
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    deny_peer_write(s)
    if _is_silent(s):
        header = _row(db, s)
        _drop_routine_candidates(db, s.uuid)
        db.delete(s)  # cascade drops the chunks; Takes are unrelated rows
        db.commit()
        return header
    s.ended_at = payload.ended_at if payload.ended_at is not None else func.now()
    db.commit()
    # An ended Session is minable: enqueue the Routine miner (routines 157).
    enqueue_routine_mine(db, s.uuid)
    db.refresh(s)
    return _row(db, s)


@router.delete("/{uuid}")
def delete_session(uuid: str, db: Session = Depends(get_db)) -> dict:
    """Delete a Session and its chunks. Takes are untouched — pruning a
    Session's timeline never destroys kept evidence (ADR 0033)."""
    deny_group_uuid(db, uuid)
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    _drop_routine_candidates(db, s.uuid)
    db.delete(s)  # ORM cascade drops the chunks; Takes are unrelated rows
    db.commit()
    return {"ok": True}
