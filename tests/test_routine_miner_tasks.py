"""Routine mining as a task-system job + the suggestion-row surfaces
(routines 157): enqueue/dedupe, the handler's replace-wholesale
idempotency, the MINER_VERSION currency marker + backfill sweep, session
lifecycle hooks (end enqueues, delete sweeps rows), and the cast-prefix
query endpoint.

Real in-memory SQLite via the migration path (conftest); the queue is
driven synchronously with run_pending like the analysis-task tests.
"""

import json
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import models
from backend.database import get_db
from backend.routers import routine_candidates, sessions
from backend.routine_miner import MINER_VERSION
from backend.routine_miner_tasks import (
    ROUTINE_MINE_TASK_TYPE,
    enqueue_routine_mine,
    enqueue_stale_routine_mining,
    make_routine_mine_handler,
    playlist_orderings,
)
from backend.tasks.manager import run_pending
from backend.tasks.models import Task

from .test_routine_miner import weave_events


@pytest.fixture
def client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sessions.router, prefix="/api/sessions")
    app.include_router(routine_candidates.router, prefix="/api/routine-candidates")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def trio(db, make_track):
    """Three tracks on a playlist (positions 0..2) — the weave's cast."""
    tracks = [make_track() for _ in range(3)]
    playlist = models.Playlist(name="test set")
    db.add(playlist)
    db.commit()
    for i, t in enumerate(tracks):
        db.add(models.PlaylistTrack(playlist_id=playlist.id, track_id=t.id, position=i))
    db.commit()
    return tracks


def make_session(db, uuid, events, ended=True):
    s = models.Session(uuid=uuid)
    if ended:
        s.ended_at = datetime(2026, 8, 24)
    db.add(s)
    db.commit()
    db.add(
        models.SessionChunk(session_id=s.id, seq=0, events_json=json.dumps(events))
    )
    db.commit()
    return s


def run_miner(db):
    return run_pending(db, {ROUTINE_MINE_TASK_TYPE: make_routine_mine_handler()})


def test_playlist_orderings(db, trio):
    t1, t2, t3 = trio
    orderings = playlist_orderings(db)
    assert orderings == [{t1.id: 0, t2.id: 1, t3.id: 2}]


def test_mine_task_persists_suggestion_rows(db, trio):
    t1, t2, t3 = trio
    s = make_session(db, "s1", weave_events(t1.id, t2.id, t3.id))
    assert enqueue_routine_mine(db, "s1") is not None
    assert run_miner(db) == 1
    assert db.query(Task).filter_by(state="done").count() == 1

    rows = db.query(models.RoutineCandidate).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.session_uuid == "s1"
    assert json.loads(row.cast_json) == [t1.id, t2.id, t3.id]
    assert (row.entry_track_id, row.exit_track_id) == (t1.id, t3.id)
    assert (row.window_start_s, row.window_end_s) == (27, 83)
    assert json.loads(row.entry_offsets_json) == [0, 3, 45]
    assert json.loads(row.evidence_json) == {"returns": 1, "triples": 0, "doubles": 0}
    assert row.miner_version == MINER_VERSION

    db.refresh(s)
    assert s.routine_miner_version == MINER_VERSION


def test_mine_task_replaces_stale_rows(db, trio):
    t1, t2, t3 = trio
    make_session(db, "s1", weave_events(t1.id, t2.id, t3.id))
    db.add(
        models.RoutineCandidate(
            uuid="stale",
            session_uuid="s1",
            entry_track_id=999,
            exit_track_id=998,
            cast_json="[999, 997, 998]",
            window_start_s=0,
            window_end_s=1,
            entry_offsets_json="[0, 0.5, 1]",
            evidence_json="{}",
            miner_version=MINER_VERSION - 1,
        )
    )
    db.commit()
    enqueue_routine_mine(db, "s1")
    run_miner(db)
    rows = db.query(models.RoutineCandidate).all()
    assert len(rows) == 1
    assert rows[0].uuid != "stale"
    assert rows[0].miner_version == MINER_VERSION


def test_enqueue_dedupes_inflight(db, trio):
    make_session(db, "s1", [])
    assert enqueue_routine_mine(db, "s1") is not None
    assert enqueue_routine_mine(db, "s1") is None
    assert db.query(Task).count() == 1


def test_mine_task_skips_deleted_session(db):
    enqueue_routine_mine(db, "ghost")
    run_miner(db)
    assert db.query(Task).filter_by(state="done").count() == 1


def test_sweep_enqueues_unmined_and_stale_only(db, trio):
    t1, t2, t3 = trio
    make_session(db, "unmined", [])
    stale = make_session(db, "stale", [])
    stale.routine_miner_version = MINER_VERSION - 1
    current = make_session(db, "current", [])
    current.routine_miner_version = MINER_VERSION
    make_session(db, "open", [], ended=False)
    db.commit()

    assert enqueue_stale_routine_mining(db) == 2
    refs = {t.ref for t in db.query(Task).all()}
    assert refs == {"session:unmined", "session:stale"}


def test_version_bump_invalidates(db, trio, monkeypatch):
    t1, t2, t3 = trio
    make_session(db, "s1", weave_events(t1.id, t2.id, t3.id))
    enqueue_routine_mine(db, "s1")
    run_miner(db)
    assert enqueue_stale_routine_mining(db) == 0  # current: nothing to do

    import backend.routine_miner_tasks as rmt

    monkeypatch.setattr(rmt, "MINER_VERSION", MINER_VERSION + 1)
    assert enqueue_stale_routine_mining(db) == 1
    run_miner(db)
    rows = db.query(models.RoutineCandidate).all()
    assert len(rows) == 1
    assert rows[0].miner_version == MINER_VERSION + 1


def test_end_session_enqueues_mining(db, client, trio):
    t1, t2, t3 = trio
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post(
        "/api/sessions/s1/chunks",
        json={"seq": 0, "events": weave_events(t1.id, t2.id, t3.id)},
    )
    resp = client.patch("/api/sessions/s1/end", json={})
    assert resp.status_code == 200, resp.text
    task = db.query(Task).filter_by(type=ROUTINE_MINE_TASK_TYPE).one()
    assert task.ref == "session:s1"


def test_delete_session_sweeps_suggestion_rows(db, client, trio):
    t1, t2, t3 = trio
    make_session(db, "s1", weave_events(t1.id, t2.id, t3.id))
    enqueue_routine_mine(db, "s1")
    run_miner(db)
    assert db.query(models.RoutineCandidate).count() == 1
    assert client.delete("/api/sessions/s1").status_code == 200
    assert db.query(models.RoutineCandidate).count() == 0


# --- read surfaces ---


def test_list_candidates_by_session(db, client, trio):
    t1, t2, t3 = trio
    make_session(db, "s1", weave_events(t1.id, t2.id, t3.id))
    enqueue_routine_mine(db, "s1")
    run_miner(db)

    rows = client.get("/api/routine-candidates", params={"session_uuid": "s1"}).json()
    assert len(rows) == 1
    assert rows[0]["cast"] == [t1.id, t2.id, t3.id]
    assert rows[0]["entry_offsets"] == [0, 3, 45]
    assert rows[0]["evidence"] == {"returns": 1, "triples": 0, "doubles": 0}
    assert rows[0]["miner_version"] == MINER_VERSION
    assert client.get(
        "/api/routine-candidates", params={"session_uuid": "other"}
    ).json() == []


def test_cast_prefix_query(db, client, trio):
    t1, t2, t3 = trio
    make_session(db, "s1", weave_events(t1.id, t2.id, t3.id))
    enqueue_routine_mine(db, "s1")
    run_miner(db)

    def query(track_ids):
        resp = client.post("/api/routine-candidates/query", json={"track_ids": track_ids})
        assert resp.status_code == 200, resp.text
        return resp.json()

    # cast == the list's next-3 entries: offered
    assert len(query([t1.id, t2.id, t3.id])) == 1
    assert len(query([t1.id, t2.id, t3.id, 999])) == 1
    # interior order is presentational — membership + boundaries decide
    assert len(query([t1.id, t3.id, t2.id])) == 0  # exit mismatch
    assert len(query([t2.id, t1.id, t3.id])) == 0  # entry mismatch
    # the Set runs out of entries before the cast completes: not offered
    assert len(query([t1.id, t2.id])) == 0
    # a stranger between the cast entries breaks the prefix
    assert len(query([t1.id, 999, t2.id, t3.id])) == 0
    assert query([]) == []
