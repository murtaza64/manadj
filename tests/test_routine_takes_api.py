"""Routine Take confirm + promote endpoints (ADR 0035, routines 158):
confirm-with-trim creates the reference row (n ≥ 3 enforced, 2-cast
routed to hand-cut Takes), promotion reads the Session slice + cast
Beatgrids and saves a slot-addressed beat-domain Routine, the raw take
row staying untouched (evidence doctrine).

Real in-memory SQLite via the migration path (conftest)."""

import json
import uuid as uuid_mod

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import models
from backend.database import get_db
from backend.beatgrid_utils import constant_tempo_changes
from backend.routers import routine_takes, routines, sessions

from .test_routine_promotion import weave_events


@pytest.fixture
def client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sessions.router, prefix="/api/sessions")
    app.include_router(routine_takes.router, prefix="/api/routine-takes")
    app.include_router(routines.router, prefix="/api/routines")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def weave_session(db, make_track):
    """An ended Session carrying the canonical 3-track weave, with track
    rows (ids remapped into the events) and constant-120 Beatgrids."""
    tracks = [make_track(bpm=12000) for _ in range(3)]  # 120.00 BPM centi
    idmap = {1: tracks[0].id, 2: tracks[1].id, 3: tracks[2].id}
    events = []
    for e in weave_events():
        e = dict(e)
        if e.get("kind") == "load":
            e["trackId"] = idmap[e["trackId"]]
        events.append(e)
    s = models.Session(uuid="weave-session", ended_at=None)
    db.add(s)
    db.commit()
    db.add(models.SessionChunk(session_id=s.id, seq=0, events_json=json.dumps(events)))
    for t in tracks:
        db.add(
            models.Beatgrid(
                track_id=t.id,
                tempo_changes_json=json.dumps(constant_tempo_changes(120.0)),
                origin="analyzed",
            )
        )
    db.commit()
    return s, [t.id for t in tracks]


def confirm_payload(cast, **over):
    return {
        "uuid": str(uuid_mod.uuid4()),
        "session_uuid": "weave-session",
        "window_start_s": 0.0,
        "window_end_s": 60.0,
        "cast": cast,
        "entry_offsets": [0.0, 10.0, 30.0][: len(cast)],
        "origin_candidate_uuid": "cand-1",
        **over,
    }


def test_confirm_creates_routine_take(client, weave_session):
    _, cast = weave_session
    res = client.post("/api/routine-takes", json=confirm_payload(cast))
    assert res.status_code == 200, res.text
    row = res.json()
    assert row["cast"] == cast
    assert row["origin_candidate_uuid"] == "cand-1"
    assert row["promoted_routine_uuid"] is None
    listed = client.get("/api/routine-takes", params={"session_uuid": "weave-session"}).json()
    assert [r["uuid"] for r in listed] == [row["uuid"]]


def test_confirm_rejects_two_cast(client, weave_session):
    _, cast = weave_session
    payload = confirm_payload(cast[:2], entry_offsets=[0.0, 10.0])
    res = client.post("/api/routine-takes", json=payload)
    assert res.status_code == 422
    assert "hand-cut Take" in res.text


def test_confirm_requires_session(client, weave_session):
    _, cast = weave_session
    res = client.post("/api/routine-takes", json=confirm_payload(cast, session_uuid="nope"))
    assert res.status_code == 404


def test_promote_end_to_end(client, db, weave_session):
    _, cast = weave_session
    take = client.post("/api/routine-takes", json=confirm_payload(cast)).json()

    res = client.post(f"/api/routine-takes/{take['uuid']}/promote")
    assert res.status_code == 200, res.text
    routine = res.json()
    assert routine["cast"] == cast
    assert routine["entry_offsets_beats"][0] == pytest.approx(0.0)
    assert routine["entry_offsets_beats"][1] == pytest.approx(20.0, abs=0.5)
    assert routine["duration_beats"] == pytest.approx(120.0, abs=2.0)
    assert routine["origin_take_uuid"] == take["uuid"]

    # The promoted mark lands on the take; the raw row is otherwise intact.
    row = client.get("/api/routine-takes").json()[0]
    assert row["promoted_routine_uuid"] == routine["uuid"]
    assert row["window_start_s"] == take["window_start_s"]
    assert row["cast"] == take["cast"]

    # Detail carries the slot-addressed, beat-domain replay.
    detail = client.get(f"/api/routines/{routine['uuid']}").json()
    assert all("beat" in e and "channel" not in e for e in detail["events"])
    plays = [e for e in detail["events"] if e.get("action") == "play"]
    assert [e["slot"] for e in plays] == [0, 1, 2]

    # Re-promotion refuses while the Routine exists.
    assert client.post(f"/api/routine-takes/{take['uuid']}/promote").status_code == 400

    # Deleting the Routine clears the mark — the evidence is re-promotable.
    assert client.delete(f"/api/routines/{routine['uuid']}").status_code == 200
    row = client.get("/api/routine-takes").json()[0]
    assert row["promoted_routine_uuid"] is None
    assert client.post(f"/api/routine-takes/{take['uuid']}/promote").status_code == 200


def test_promote_falls_back_to_track_bpm(client, db, weave_session):
    _, cast = weave_session
    db.query(models.Beatgrid).delete()
    db.commit()
    take = client.post("/api/routine-takes", json=confirm_payload(cast)).json()
    res = client.post(f"/api/routine-takes/{take['uuid']}/promote")
    assert res.status_code == 200, res.text
    assert res.json()["duration_beats"] == pytest.approx(120.0, abs=2.0)


def test_promote_gone_session_422(client, db, weave_session):
    _, cast = weave_session
    take = client.post("/api/routine-takes", json=confirm_payload(cast)).json()
    db.query(models.SessionChunk).delete()
    db.query(models.Session).delete()
    db.commit()
    res = client.post(f"/api/routine-takes/{take['uuid']}/promote")
    assert res.status_code == 422
    assert "Session is gone" in res.text


def test_delete_routine_take(client, weave_session):
    _, cast = weave_session
    take = client.post("/api/routine-takes", json=confirm_payload(cast)).json()
    assert client.delete(f"/api/routine-takes/{take['uuid']}").status_code == 200
    assert client.get("/api/routine-takes").json() == []


def test_rename_routine(client, weave_session):
    _, cast = weave_session
    take = client.post("/api/routine-takes", json=confirm_payload(cast)).json()
    routine = client.post(f"/api/routine-takes/{take['uuid']}/promote").json()
    res = client.patch(f"/api/routines/{routine['uuid']}", json={"name": "s49 finale"})
    assert res.status_code == 200
    assert res.json()["name"] == "s49 finale"


def test_delete_routine_degrades_set_pins(client, db, weave_session):
    """Sets 160: deleting a Routine nulls Set pins referencing it and
    drops Dormant memories of it (the sets 12 rule, routine kind)."""
    _, cast = weave_session
    take = client.post("/api/routine-takes", json=confirm_payload(cast)).json()
    routine = client.post(f"/api/routine-takes/{take['uuid']}/promote").json()

    s = models.Set(name="degrade")
    db.add(s)
    db.commit()
    db.add(
        models.SetEntry(
            set_id=s.id,
            track_id=cast[0],
            position=0,
            pin_kind="routine",
            pin_uuid=routine["uuid"],
        )
    )
    db.add(
        models.SetDormantPin(
            set_id=s.id,
            a_track_id=cast[0],
            b_track_id=cast[-1],
            pin_kind="routine",
            pin_uuid=routine["uuid"],
        )
    )
    db.commit()

    assert client.delete(f"/api/routines/{routine['uuid']}").status_code == 200
    entry = db.query(models.SetEntry).filter(models.SetEntry.set_id == s.id).one()
    assert entry.pin_kind is None and entry.pin_uuid is None
    assert db.query(models.SetDormantPin).filter(models.SetDormantPin.set_id == s.id).count() == 0
