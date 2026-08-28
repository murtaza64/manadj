"""Routine edits layer (gh#170 pass 2): PUT /api/routines/{uuid}/edits
stores the editor's authored draft opaquely (the events_json posture),
the detail endpoint serves it, and retrim REBASES it (beats shift by the
start trim; out-of-range and dropped-slot entries drop).

Real in-memory SQLite via the migration path (conftest)."""

import json
import uuid as uuid_mod

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import models
from backend.beatgrid_utils import constant_tempo_changes
from backend.database import get_db
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
def promoted_routine(client, db, make_track):
    tracks = [make_track(bpm=12000) for _ in range(3)]
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
    take_uuid = str(uuid_mod.uuid4())
    res = client.post(
        "/api/routine-takes",
        json={
            "uuid": take_uuid,
            "session_uuid": "weave-session",
            "window_start_s": 0.0,
            "window_end_s": 60.0,
            "cast": [t.id for t in tracks],
            "entry_offsets": [0.0, 10.0, 30.0],
        },
    )
    assert res.status_code == 200, res.text
    res = client.post(f"/api/routine-takes/{take_uuid}/promote")
    assert res.status_code == 200, res.text
    return res.json()


# SlotId-addressed (ADR 0039): promoted routines carry index-string ids
# from the lossless migration.
EDITS = {
    "lanes": {"1:fader": [{"beat": 20.0, "value": 0.0}, {"beat": 40.0, "value": 1.0}]},
    "jumps": [{"id": "j1", "slotId": "2", "beat": 80.0, "deltaSec": -2.0, "repeat": 4}],
    "removedRecordedJumps": [{"slotId": "0", "beat": 30.0}],
}


def test_edits_roundtrip(client, promoted_routine):
    uuid = promoted_routine["uuid"]
    # Unedited: detail serves null.
    assert client.get(f"/api/routines/{uuid}").json()["edits"] is None
    res = client.put(f"/api/routines/{uuid}/edits", json={"edits": EDITS})
    assert res.status_code == 200, res.text
    assert res.json()["edits"] == EDITS
    # The recording itself never changed.
    detail = client.get(f"/api/routines/{uuid}").json()
    assert detail["edits"] == EDITS
    assert len(detail["events"]) > 0
    # Null clears.
    res = client.put(f"/api/routines/{uuid}/edits", json={"edits": None})
    assert res.status_code == 200
    assert client.get(f"/api/routines/{uuid}").json()["edits"] is None


def test_edits_unknown_routine_404(client):
    res = client.put("/api/routines/nope/edits", json={"edits": EDITS})
    assert res.status_code == 404


def test_retrim_rebases_edits(client, promoted_routine):
    uuid = promoted_routine["uuid"]
    client.put(f"/api/routines/{uuid}/edits", json={"edits": EDITS})
    # Trim 10 beats off the start (the weave runs 2 beats/s): every beat
    # rebases by −10; nothing falls outside.
    res = client.post(
        f"/api/routines/{uuid}/retrim",
        json={"trim_start_beats": 10.0, "trim_end_beats": 0.0},
    )
    assert res.status_code == 200, res.text
    edits = res.json()["edits"]
    assert edits["lanes"]["1:fader"][0]["beat"] == pytest.approx(10.0)
    assert edits["jumps"][0]["beat"] == pytest.approx(70.0)
    assert edits["jumps"][0]["repeat"] == 4
    assert edits["removedRecordedJumps"][0]["beat"] == pytest.approx(20.0)


def test_retrim_rebases_legacy_index_keyed_edits(client, promoted_routine):
    """Pre-ADR-0039 rows address slots by `slot` int — rebase still reads
    them (parseEdits migrates them client-side on the next open)."""
    uuid = promoted_routine["uuid"]
    legacy = {
        "lanes": {},
        "jumps": [{"id": "j1", "slot": 2, "beat": 80.0, "deltaSec": -2.0}],
        "removedRecordedJumps": [{"slot": 0, "beat": 30.0}],
    }
    client.put(f"/api/routines/{uuid}/edits", json={"edits": legacy})
    res = client.post(
        f"/api/routines/{uuid}/retrim",
        json={"trim_start_beats": 10.0, "trim_end_beats": 0.0},
    )
    assert res.status_code == 200, res.text
    edits = res.json()["edits"]
    assert edits["jumps"][0]["beat"] == pytest.approx(70.0)
    assert edits["removedRecordedJumps"][0]["beat"] == pytest.approx(20.0)


def test_retrim_drops_out_of_range_edits(client, promoted_routine):
    uuid = promoted_routine["uuid"]
    client.put(f"/api/routines/{uuid}/edits", json={"edits": EDITS})
    # 50 beats off the end (duration 120 → 70, all slots survive): the
    # slot-2 jump at beat 80 falls outside and drops; the lane points at
    # 20/40 survive.
    res = client.post(
        f"/api/routines/{uuid}/retrim",
        json={"trim_start_beats": 0.0, "trim_end_beats": 50.0},
    )
    assert res.status_code == 200, res.text
    edits = res.json()["edits"]
    assert edits["jumps"] == []
    assert [p["beat"] for p in edits["lanes"]["1:fader"]] == [20.0, 40.0]
