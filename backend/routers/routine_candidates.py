"""Routine candidates: miner-suggested Routine spans (ADR 0035, routines 157).

Read-only suggestion surface. Rows are produced by the `routine-mine`
task (backend/routine_miner_tasks.py), die with their Session, and are
invalidated wholesale by a MINER_VERSION bump — nothing here mutates.

Two reads:
- `GET ?session_uuid=` — a Session's candidate spans, timeline order
  (the confirm-into-Routine-Take surface reads this).
- `POST /query` — cast-prefix match against an ordered track list: the
  pin picker's "Routines available" hint. A candidate matches when its
  cast covers exactly the list's next len(cast) entries, entering on the
  first and exiting on the last (ADR 0035: offerable exactly when its
  cast is the next n entries; interior order is presentational, so
  membership + boundaries decide, not interior sequence).
"""

import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend import models, schemas
from backend.database import get_db

router = APIRouter()


def _row(c: models.RoutineCandidate) -> schemas.RoutineCandidateRow:
    return schemas.RoutineCandidateRow(
        uuid=c.uuid,
        session_uuid=c.session_uuid,
        cast=json.loads(c.cast_json),
        window_start_s=c.window_start_s,
        window_end_s=c.window_end_s,
        entry_offsets=json.loads(c.entry_offsets_json),
        evidence=json.loads(c.evidence_json),
        miner_version=c.miner_version,
        created_at=c.created_at,
    )


@router.get("", response_model=list[schemas.RoutineCandidateRow])
def list_candidates(
    session_uuid: str | None = None, db: Session = Depends(get_db)
) -> list[schemas.RoutineCandidateRow]:
    """Candidate spans, timeline order; optionally one Session's."""
    query = db.query(models.RoutineCandidate)
    if session_uuid is not None:
        query = query.filter(models.RoutineCandidate.session_uuid == session_uuid)
    rows = query.order_by(
        models.RoutineCandidate.session_uuid,
        models.RoutineCandidate.window_start_s,
    ).all()
    return [_row(c) for c in rows]


@router.post("/query", response_model=list[schemas.RoutineCandidateRow])
def query_by_cast_prefix(
    payload: schemas.RoutineCandidateQuery, db: Session = Depends(get_db)
) -> list[schemas.RoutineCandidateRow]:
    """Candidates whose cast is a prefix of the given ordered track list.

    Match = the cast's membership equals the list's first len(cast)
    entries, the entry track is the list's head, and the exit track is
    the len(cast)-th entry. Strongest evidence first."""
    track_ids = payload.track_ids
    if not track_ids:
        return []
    rows = (
        db.query(models.RoutineCandidate)
        .filter(models.RoutineCandidate.entry_track_id == track_ids[0])
        .all()
    )
    matches = []
    for c in rows:
        cast = json.loads(c.cast_json)
        n = len(cast)
        if n > len(track_ids):
            continue
        window = track_ids[:n]
        if set(cast) == set(window) and c.exit_track_id == window[-1]:
            matches.append(c)
    matches.sort(
        key=lambda c: (-sum(json.loads(c.evidence_json).values()), c.session_uuid)
    )
    return [_row(c) for c in matches]
