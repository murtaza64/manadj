"""Routine mining on the task system (ADR 0035, routines 157; ADR 0003).

A Session gets mined when it ends (the sessions router enqueues on close
and on crash recovery); a startup sweep backfills every ended Session
whose `routine_miner_version` marker is missing or stale, so bumping
`routine_miner.MINER_VERSION` invalidates and recomputes the whole
corpus. The handler is idempotent: it replaces the Session's suggestion
rows wholesale and stamps the marker in the same transaction.

Cast contiguity runs against playlist orderings (a candidate's cast must
be a contiguous run of some playlist — the v1 stand-in for "the intended
set order"; see routine_miner's module docstring).
"""

import json
import logging
import uuid as uuid_lib
from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .routine_miner import MINER_VERSION, mine_session
from .tasks.manager import create_task
from .tasks.models import Task

logger = logging.getLogger(__name__)

ROUTINE_MINE_TASK_TYPE = "routine-mine"


def _ref(session_uuid: str) -> str:
    return f"session:{session_uuid}"


def playlist_orderings(db: Session) -> list[dict[int, int]]:
    """Every playlist as a {track_id: position} map — the ordered track
    lists the cast contiguity check runs against."""
    by_playlist: dict[int, dict[int, int]] = defaultdict(dict)
    rows = db.query(
        models.PlaylistTrack.playlist_id,
        models.PlaylistTrack.track_id,
        models.PlaylistTrack.position,
    ).all()
    for playlist_id, track_id, position in rows:
        by_playlist[playlist_id][track_id] = position
    return list(by_playlist.values())


def _dupes_confirmed_take(
    candidate_cast: list[int],
    window_start_s: float,
    window_end_s: float,
    takes: list[tuple[set[int], float, float]],
) -> bool:
    """Does a mined candidate duplicate an already-confirmed Routine Take?

    Re-mining mints fresh candidate uuids, so `origin_candidate_uuid`
    dangles by design — a confirmed span's re-mined twin would come back
    as a new suggestion and stack a dashed band under the confirmed one
    (gh#187). Span-shaped identity instead: time overlap ≥50% of the
    shorter window plus ≥2 shared cast tracks (adjacent distinct
    candidates share at most the one handover track).
    """
    cast = set(candidate_cast)
    for take_cast, t0, t1 in takes:
        overlap = min(window_end_s, t1) - max(window_start_s, t0)
        if overlap <= 0:
            continue
        shorter = min(window_end_s - window_start_s, t1 - t0)
        if overlap < 0.5 * shorter:
            continue
        if len(cast & take_cast) >= 2:
            return True
    return False


def replace_session_candidates(db: Session, session: models.Session) -> int:
    """Mine one Session and replace its suggestion rows; stamp the marker.

    Does not commit — the caller owns the transaction (handler and tests
    commit; a failure rolls the delete back with everything else).

    Mined candidates that duplicate an already-confirmed Routine Take of
    this Session are dropped (gh#187): the take chip/band is the
    surviving surface for that span.
    """
    events: list[dict[str, Any]] = []
    for chunk in session.chunks:  # relationship order: seq
        events.extend(json.loads(chunk.events_json))
    result = mine_session(events, playlist_orderings(db))
    confirmed = [
        (set(json.loads(t.cast_json)), t.window_start_s, t.window_end_s)
        for t in db.query(models.RoutineTake)
        .filter(models.RoutineTake.session_uuid == session.uuid)
        .all()
    ]
    db.query(models.RoutineCandidate).filter(
        models.RoutineCandidate.session_uuid == session.uuid
    ).delete()
    kept = 0
    for c in result.candidates:
        if _dupes_confirmed_take(c.cast, c.window_start_s, c.window_end_s, confirmed):
            continue
        kept += 1
        db.add(
            models.RoutineCandidate(
                uuid=str(uuid_lib.uuid4()),
                session_uuid=session.uuid,
                entry_track_id=c.entry_track_id,
                exit_track_id=c.exit_track_id,
                cast_json=json.dumps(c.cast),
                window_start_s=c.window_start_s,
                window_end_s=c.window_end_s,
                entry_offsets_json=json.dumps(
                    [round(o, 3) for o in c.entry_offsets]
                ),
                evidence_json=json.dumps(
                    {
                        "returns": c.n_returns,
                        "triples": c.n_triples,
                        "doubles": c.n_doubles,
                    }
                ),
                miner_version=MINER_VERSION,
            )
        )
    session.routine_miner_version = MINER_VERSION
    logger.info(
        "routine miner v%d session %s: %d candidates, %d confirmed dupes dropped"
        " (%d/%d returns practice)",
        MINER_VERSION,
        session.uuid,
        kept,
        len(result.candidates) - kept,
        result.n_practice_returns,
        result.n_returns,
    )
    return kept


def make_routine_mine_handler():
    """Build the task handler for `routine-mine` tasks."""

    def handle(db: Session, payload: dict[str, Any]) -> None:
        session_uuid = str(payload["session_uuid"])
        session = (
            db.query(models.Session)
            .filter(models.Session.uuid == session_uuid)
            .first()
        )
        if session is None:
            # The Session was deleted between enqueue and run — nothing to
            # mine, and delete_session already swept its suggestion rows.
            logger.info("routine-mine: session %s gone, skipping", session_uuid)
            return
        replace_session_candidates(db, session)
        db.commit()

    return handle


def enqueue_routine_mine(db: Session, session_uuid: str) -> Task | None:
    """Enqueue mining for one Session; no-op if one is queued/running."""
    existing = (
        db.query(Task)
        .filter(
            Task.type == ROUTINE_MINE_TASK_TYPE,
            Task.ref == _ref(session_uuid),
            Task.state.in_(("pending", "running")),
        )
        .first()
    )
    if existing is not None:
        return None
    return create_task(
        db,
        ROUTINE_MINE_TASK_TYPE,
        {"session_uuid": session_uuid},
        ref=_ref(session_uuid),
    )


def enqueue_stale_routine_mining(db: Session) -> int:
    """Startup sweep / backfill: enqueue every ended Session whose
    suggestion rows are missing or from another MINER_VERSION. Open
    Sessions wait — they get mined when they end."""
    rows = (
        db.query(models.Session.uuid)
        .filter(
            models.Session.ended_at.isnot(None),
            (models.Session.routine_miner_version.is_(None))
            | (models.Session.routine_miner_version != MINER_VERSION),
        )
        .all()
    )
    enqueued = 0
    for (session_uuid,) in rows:
        if enqueue_routine_mine(db, session_uuid) is not None:
            enqueued += 1
    if enqueued:
        logger.info("enqueued %d routine-mine tasks", enqueued)
    return enqueued
