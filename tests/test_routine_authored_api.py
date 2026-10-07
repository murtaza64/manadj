"""Authored Routines (ADR 0039, gh#325): POST /api/routines mints a
Routine with no origin take and an empty recording; PUT
/{uuid}/structure replaces its cast/slot ids/entry offsets/positions;
promoted rows refuse structure writes."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import routine_takes, routines, sessions

from .test_routine_edits_api import promoted_routine  # noqa: F401 (fixture)


@pytest.fixture
def client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sessions.router, prefix="/api/sessions")
    app.include_router(routine_takes.router, prefix="/api/routine-takes")
    app.include_router(routines.router, prefix="/api/routines")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def cast(make_track):
    return [make_track(bpm=12000).id for _ in range(4)]


def body(tracks, **over):
    b = {
        "uuid": "auth-1",
        "cast": tracks[:3],
        "slot_ids": ["a", "b", "c"],
        "entry_offsets_beats": [0.0, 32.0, 64.0],
        "entry_positions": [0.0, 12.5, 0.0],
        "duration_beats": 96.0,
        "edits": {"lanes": {"b:fader": [{"beat": 31.9, "value": 0}, {"beat": 32, "value": 1}]}},
    }
    b.update(over)
    return b


def test_create_authored_routine_round_trips(client, cast):
    res = client.post("/api/routines", json=body(cast))
    assert res.status_code == 201, res.text
    d = res.json()
    assert d["authored"] is True
    assert d["origin_take_uuid"] is None
    assert d["events"] == []
    assert d["slot_ids"] == ["a", "b", "c"]
    assert d["edits"]["lanes"]["b:fader"][1]["value"] == 1
    got = client.get("/api/routines/auth-1").json()
    assert got == d
    listed = client.get("/api/routines").json()
    assert [r["uuid"] for r in listed] == ["auth-1"]
    assert listed[0]["authored"] is True


def test_create_sorts_slots_into_entry_order(client, cast):
    res = client.post(
        "/api/routines",
        json=body(cast, entry_offsets_beats=[0.0, 64.0, 32.0], entry_positions=[0.0, 1.0, 2.0]),
    )
    d = res.json()
    assert d["cast"] == [cast[0], cast[2], cast[1]]
    assert d["slot_ids"] == ["a", "c", "b"]
    assert d["entry_offsets_beats"] == [0.0, 32.0, 64.0]
    assert d["entry_positions"] == [0.0, 2.0, 1.0]


def test_create_duplicate_uuid_409(client, cast):
    assert client.post("/api/routines", json=body(cast)).status_code == 201
    assert client.post("/api/routines", json=body(cast)).status_code == 409


@pytest.mark.parametrize(
    "over",
    [
        {"cast": [1, 2], "slot_ids": ["a", "b"], "entry_offsets_beats": [0, 8], "entry_positions": [0, 0]},
        {"slot_ids": ["a", "a", "c"]},
        {"entry_positions": [0.0, 1.0]},
        {"duration_beats": 64.0},
        {"cast": [999999, 999998, 999997]},
    ],
)
def test_create_rejects_invalid_structure(client, cast, over):
    assert client.post("/api/routines", json=body(cast, **over)).status_code == 422


def test_structure_put_adds_slot_and_keeps_edits_unless_sent(client, cast):
    client.post("/api/routines", json=body(cast))
    res = client.put(
        "/api/routines/auth-1/structure",
        json={
            "cast": cast,
            "slot_ids": ["a", "b", "c", "d"],
            "entry_offsets_beats": [0.0, 32.0, 64.0, 96.0],
            "entry_positions": [0.0, 12.5, 0.0, 3.0],
            "duration_beats": 128.0,
        },
    )
    assert res.status_code == 200, res.text
    d = res.json()
    assert d["cast"] == cast
    assert d["duration_beats"] == 128.0
    assert d["edits"] is not None  # untouched: edits not sent
    res = client.put(
        "/api/routines/auth-1/structure",
        json={
            "cast": cast[:3],
            "slot_ids": ["a", "b", "c"],
            "entry_offsets_beats": [0.0, 32.0, 64.0],
            "entry_positions": [0.0, 12.5, 0.0],
            "duration_beats": 128.0,
            "edits": None,
        },
    )
    assert res.json()["edits"] is None  # sent null → cleared


def test_structure_put_refuses_below_three_slots(client, cast):
    client.post("/api/routines", json=body(cast))
    res = client.put(
        "/api/routines/auth-1/structure",
        json={
            "cast": cast[:2],
            "slot_ids": ["a", "b"],
            "entry_offsets_beats": [0.0, 32.0],
            "entry_positions": [0.0, 0.0],
            "duration_beats": 64.0,
        },
    )
    assert res.status_code == 422


def test_structure_put_refuses_promoted(client, promoted_routine):  # noqa: F811
    p = promoted_routine
    res = client.put(
        f"/api/routines/{p['uuid']}/structure",
        json={
            "cast": p["cast"],
            "slot_ids": [str(i) for i in range(len(p["cast"]))],
            "entry_offsets_beats": p["entry_offsets_beats"],
            "entry_positions": p["entry_positions"],
            "duration_beats": p["duration_beats"],
        },
    )
    assert res.status_code == 409
    assert p["authored"] is False


def test_retrim_refuses_authored(client, cast):
    client.post("/api/routines", json=body(cast))
    res = client.post(
        "/api/routines/auth-1/retrim", json={"trim_start_beats": 0, "trim_end_beats": 4}
    )
    assert res.status_code == 422


# ── Kind crossings (ADR 0039, gh#330) ────────────────────────────────────

from backend import models  # noqa: E402


def _set_with(db, track_ids, pins):
    s = models.Set(name="s", display_order=0)
    db.add(s)
    db.commit()
    for i, tid in enumerate(track_ids):
        kind, uuid = pins.get(tid, (None, None))
        db.add(models.SetEntry(set_id=s.id, track_id=tid, position=i, pin_kind=kind, pin_uuid=uuid))
    db.commit()
    return s


def test_routine_to_transition_repoints_pins_and_deletes_routine(client, db, cast):
    client.post("/api/routines", json=body(cast))
    s = _set_with(db, cast[:3], {cast[0]: ("routine", "auth-1"), cast[1]: ("routine", "auth-1")})
    db.add(models.SetDormantPin(set_id=s.id, a_track_id=cast[0], b_track_id=cast[1], pin_kind="routine", pin_uuid="auth-1"))
    db.add(models.SetDormantPin(set_id=s.id, a_track_id=cast[2], b_track_id=cast[0], pin_kind="routine", pin_uuid="auth-1"))
    db.commit()
    res = client.post(
        "/api/routines/auth-1/to-transition",
        json={"transition_uuid": "t-1", "a_track_id": cast[0], "b_track_id": cast[1], "name": "T", "data": {"startSec": 1}},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"kind": "transition", "uuid": "t-1", "repointed_pins": 2, "dropped_pins": 2}
    assert client.get("/api/routines/auth-1").status_code == 404
    t = db.query(models.Transition).filter_by(uuid="t-1").one()
    assert (t.a_track_id, t.b_track_id, t.position) == (cast[0], cast[1], 0)
    pins = {e.track_id: (e.pin_kind, e.pin_uuid) for e in db.query(models.SetEntry).all()}
    assert pins[cast[0]] == ("transition", "t-1")
    assert pins[cast[1]] == (None, None)
    dormant = db.query(models.SetDormantPin).all()
    assert [(d.a_track_id, d.pin_kind, d.pin_uuid) for d in dormant] == [(cast[0], "transition", "t-1")]


def test_routine_to_transition_refuses_promoted(client, promoted_routine):  # noqa: F811
    p = promoted_routine
    res = client.post(
        f"/api/routines/{p['uuid']}/to-transition",
        json={"transition_uuid": "t", "a_track_id": p["cast"][0], "b_track_id": p["cast"][1], "name": "T", "data": {}},
    )
    assert res.status_code == 409


def test_transition_to_routine_repoints_pins_and_clears_take(client, db, cast):
    db.add(models.Transition(a_track_id=cast[0], b_track_id=cast[1], uuid="t-1", position=0, name="T", data_json="{}"))
    db.add(models.Take(uuid="tk", a_track_id=cast[0], b_track_id=cast[1], window_start_s=0, window_end_s=1,
                       confidence=1, detector_version=1, params_json="{}", events_json="[]", promoted_transition_uuid="t-1"))
    _set_with(db, cast[:3], {cast[0]: ("transition", "t-1")})
    res = client.post("/api/routines/from-transition/t-1", json=body(cast, uuid="r-1"))
    assert res.status_code == 200, res.text
    assert res.json() == {"kind": "routine", "uuid": "r-1", "repointed_pins": 1, "dropped_pins": 0}
    assert client.get("/api/routines/r-1").json()["authored"] is True
    assert db.query(models.Transition).filter_by(uuid="t-1").first() is None
    assert db.query(models.Take).filter_by(uuid="tk").one().promoted_transition_uuid is None
    e = db.query(models.SetEntry).filter_by(track_id=cast[0]).one()
    assert (e.pin_kind, e.pin_uuid) == ("routine", "r-1")


def test_transition_to_routine_404_and_validation(client, db, cast):
    assert client.post("/api/routines/from-transition/nope", json=body(cast)).status_code == 404
    db.add(models.Transition(a_track_id=cast[0], b_track_id=cast[1], uuid="t-1", position=0, name="T", data_json="{}"))
    db.commit()
    bad = body(cast, cast=cast[:2], slot_ids=["a", "b"], entry_offsets_beats=[0, 8], entry_positions=[0, 0])
    assert client.post("/api/routines/from-transition/t-1", json=bad).status_code == 422
    assert db.query(models.Transition).filter_by(uuid="t-1").first() is not None
