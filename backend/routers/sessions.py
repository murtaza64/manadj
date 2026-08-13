"""Sessions: the persisted whole capture-event log (Sessions PRD, ADR 0033).

One row per recorder lifetime, streamed to disk as append-only chunks
(~5s flush). The write model is create + append + end + delete; the list
returns headers only (no chunks) with a derived Take count. Chunks are
opaque JSON arrays of the capture event vocabulary — the same posture as a
Take's slice.

Deleting a Session cascades its chunks and NEVER touches a Take: Takes keep
their own event slice and remain self-contained (ADR 0033). The Session id a
Take carries is provenance, not a dependency.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.database import get_db

router = APIRouter()


def _row(db: Session, s: models.Session) -> schemas.SessionRow:
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
    )


@router.get("", response_model=list[schemas.SessionRow])
def list_sessions(db: Session = Depends(get_db)) -> list[schemas.SessionRow]:
    """The Sessions list, newest first — headers + Take count, no chunks."""
    rows = (
        db.query(models.Session)
        .order_by(models.Session.started_at.desc(), models.Session.id.desc())
        .all()
    )
    return [_row(db, s) for s in rows]


@router.post("", response_model=schemas.SessionRow)
def create_session(
    payload: schemas.SessionCreate, db: Session = Depends(get_db)
) -> schemas.SessionRow:
    """Open a Session (recorder start). Idempotent on the client uuid is
    not offered — a duplicate uuid is a client bug (400)."""
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
    """Close Sessions orphaned by a renderer crash/reload.

    `ended_at IS NULL` means the end request never reached the backend, not
    necessarily that the recorder is still alive. Boot calls this before it
    opens a new Session. Use the last persisted chunk time (or started_at for
    an empty legacy row), so downtime is not counted as performance duration.
    """
    rows = db.query(models.Session).filter(models.Session.ended_at.is_(None)).all()
    for s in rows:
        last_chunk_at = (
            db.query(func.max(models.SessionChunk.created_at))
            .filter(models.SessionChunk.session_id == s.id)
            .scalar()
        )
        s.ended_at = last_chunk_at or s.started_at
    db.commit()
    return {"closed": len(rows)}


@router.get("/{uuid}", response_model=schemas.SessionDetail)
def get_session(uuid: str, db: Session = Depends(get_db)) -> schemas.SessionDetail:
    """One Session with its whole event log: chunks concatenated in seq
    order (the relationship's order_by). The diagnostic/inspection seam —
    the persisted events, readable through the app boundary."""
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    events: list[dict] = []
    for chunk in s.chunks:
        events.extend(json.loads(chunk.events_json))
    header = _row(db, s)
    return schemas.SessionDetail(**header.model_dump(), events=events)


@router.post("/{uuid}/chunks", response_model=schemas.SessionRow)
def append_chunk(
    uuid: str, payload: schemas.SessionChunkAppend, db: Session = Depends(get_db)
) -> schemas.SessionRow:
    """Append one batch of events. `seq` must be new within the Session — a
    duplicate seq is a client retry bug (400); the sink never retries."""
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
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
    """Close a Session (recorder dispose / page-hide). Setting ended_at on an
    already-ended Session just overwrites it — closing twice is harmless."""
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    s.ended_at = payload.ended_at if payload.ended_at is not None else func.now()
    db.commit()
    db.refresh(s)
    return _row(db, s)


@router.delete("/{uuid}")
def delete_session(uuid: str, db: Session = Depends(get_db)) -> dict:
    """Delete a Session and its chunks. Takes are untouched — pruning a
    Session's timeline never destroys kept evidence (ADR 0033)."""
    s = db.query(models.Session).filter(models.Session.uuid == uuid).first()
    if s is None:
        raise HTTPException(status_code=404, detail="session not found")
    db.delete(s)  # ORM cascade drops the chunks; Takes are unrelated rows
    db.commit()
    return {"ok": True}
