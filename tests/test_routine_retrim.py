"""Boundary trim + mechanical re-promotion (gh#170, ADR 0035's v1 review
affordance): the pure `retrim` (beat-domain trim amounts inverted through
the promotion's own beat clock, then a plain re-`promote` over the
narrowed window) and the router path (Routine row updated IN PLACE, same
uuid — Set pins keep their reference; the raw take untouched).

Canonical fixture: test_routine_promotion's 3-track weave — constant
2 beats/s, window 0..60 s ⇒ 120 beats, entries at [0, 20, 60] beats.
"""

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
from backend.routine_promotion import PromotionError, promote, retrim

from .test_routine_promotion import CAST, GRIDS, OFFSETS, WINDOW, weave_events

# ── Pure module ──────────────────────────────────────────────────────────


def test_retrim_noop_matches_promote():
    base = promote(weave_events(), CAST, *WINDOW, OFFSETS, GRIDS)
    trimmed = retrim(weave_events(), CAST, *WINDOW, OFFSETS, GRIDS, 0.0, 0.0)
    assert trimmed.cast == base.cast
    assert trimmed.duration_beats == pytest.approx(base.duration_beats)
    assert trimmed.entry_offsets_beats == pytest.approx(base.entry_offsets_beats)


def test_retrim_start_rebases_offsets():
    # 10 beats = 5 s at the weave's constant 2 beats/s: window → 5..60,
    # entries rebase to [0, 5, 25] s ⇒ [0, 10, 50] beats, duration 110.
    r = retrim(weave_events(), CAST, *WINDOW, OFFSETS, GRIDS, 10.0, 0.0)
    assert r.cast == CAST
    assert r.duration_beats == pytest.approx(110.0, abs=0.5)
    assert r.entry_offsets_beats == pytest.approx([0.0, 10.0, 50.0], abs=0.5)


def test_retrim_end_keeps_cast_when_entries_survive():
    # 50 beats off the end: window → 0..35 s; slot 2 enters at 30 s < 35 s
    # so the cast survives; duration 70 beats.
    r = retrim(weave_events(), CAST, *WINDOW, OFFSETS, GRIDS, 0.0, 50.0)
    assert r.cast == CAST
    assert r.duration_beats == pytest.approx(70.0, abs=0.5)


def test_retrim_end_dropping_below_three_raises():
    # 70 beats off the end: window → 0..25 s; slot 2's entry (30 s) falls
    # past the new end — cast would shrink to 2 (a Transition, forbidden).
    with pytest.raises(PromotionError, match="fewer than 3"):
        retrim(weave_events(), CAST, *WINDOW, OFFSETS, GRIDS, 0.0, 70.0)


def test_retrim_collapse_raises():
    with pytest.raises(PromotionError, match="collapses"):
        retrim(weave_events(), CAST, *WINDOW, OFFSETS, GRIDS, 80.0, 80.0)


def test_retrim_widens_outward_bounded_by_the_slice(subtests=None):
    # Start from an under-sized window 5..55 (offsets rebased: entries at
    # abs 0/10/30 → the miner "missed" 5 s on each side). Negative trims
    # widen back out; the session slice (events 0..60) is the outer bound.
    offsets = [0.0, 5.0, 25.0]
    base = retrim(weave_events(), CAST, 5.0, 55.0, offsets, GRIDS, 0.0, 0.0)
    assert base.duration_beats == pytest.approx(100.0, abs=0.5)
    # Widen 10 beats (= 5 s at 2 beats/s) on each side → the full 0..60.
    widened = retrim(weave_events(), CAST, 5.0, 55.0, offsets, GRIDS, -10.0, -10.0)
    assert widened.duration_beats == pytest.approx(120.0, abs=1.0)
    # Entry MARKS stay put (the recording's truth); only the window moved
    # — slot 0's entry now sits 10 beats into the widened span.
    assert widened.entry_offsets_beats == pytest.approx([10.0, 20.0, 60.0], abs=1.0)
    # Over-widening clamps to the slice extent — never invents audio.
    clamped = retrim(weave_events(), CAST, 5.0, 55.0, offsets, GRIDS, -500.0, -500.0)
    assert clamped.duration_beats == pytest.approx(120.0, abs=1.5)


# ── Router (in-memory SQLite via conftest) ───────────────────────────────


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
    """A promoted weave Routine with its origin take + Session in place."""
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
    cast = [t.id for t in tracks]
    take_uuid = str(uuid_mod.uuid4())
    res = client.post(
        "/api/routine-takes",
        json={
            "uuid": take_uuid,
            "session_uuid": "weave-session",
            "window_start_s": 0.0,
            "window_end_s": 60.0,
            "cast": cast,
            "entry_offsets": [0.0, 10.0, 30.0],
        },
    )
    assert res.status_code == 200, res.text
    res = client.post(f"/api/routine-takes/{take_uuid}/promote")
    assert res.status_code == 200, res.text
    return res.json(), take_uuid, cast


def test_retrim_endpoint_updates_in_place(client, promoted_routine):
    routine, take_uuid, cast = promoted_routine
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 10.0, "trim_end_beats": 0.0},
    )
    assert res.status_code == 200, res.text
    out = res.json()
    # Same uuid (pins survive), narrowed clock, events re-promoted.
    assert out["uuid"] == routine["uuid"]
    assert out["cast"] == cast
    assert out["duration_beats"] == pytest.approx(110.0, abs=0.5)
    assert out["origin_take_uuid"] == take_uuid
    assert len(out["events"]) > 0
    assert all("beat" in e for e in out["events"])
    # The raw take is untouched (evidence doctrine).
    takes = client.get("/api/routine-takes").json()
    assert takes[0]["window_start_s"] == 0.0
    assert takes[0]["window_end_s"] == 60.0
    # The detail endpoint serves the updated row.
    detail = client.get(f"/api/routines/{routine['uuid']}").json()
    assert detail["duration_beats"] == pytest.approx(110.0, abs=0.5)


def test_retrim_endpoint_sequential_trims_measure_current_window(
    client, db, promoted_routine
):
    """gh#190 item 8: a second retrim's beat amounts are relative to the
    routine's CURRENT window — not the origin take's original bounds (the
    old stateless behavior silently reverted the first trim)."""
    routine, _, cast = promoted_routine
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 0.0, "trim_end_beats": 20.0},
    )
    assert res.status_code == 200, res.text
    assert res.json()["duration_beats"] == pytest.approx(100.0, abs=0.5)
    # Second trim from the other edge must PRESERVE the first.
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 10.0, "trim_end_beats": 0.0},
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["duration_beats"] == pytest.approx(90.0, abs=0.5)
    assert out["entry_offsets_beats"] == pytest.approx([0.0, 10.0, 50.0], abs=0.5)
    # The stored window tracks both trims (10 beats = 5 s at 2 beats/s).
    row = (
        db.query(models.Routine).filter(models.Routine.uuid == routine["uuid"]).first()
    )
    assert row.window_start_s == pytest.approx(5.0, abs=0.3)
    assert row.window_end_s == pytest.approx(50.0, abs=0.3)


def test_retrim_endpoint_widens_back_after_narrow(client, promoted_routine):
    """gh#190 item 8: NEGATIVE trim amounts widen the CURRENT window back
    out (bounded by the session slice) — the ✓ Apply expansion path."""
    routine, _, cast = promoted_routine
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 0.0, "trim_end_beats": 20.0},
    )
    assert res.status_code == 200, res.text
    assert res.json()["duration_beats"] == pytest.approx(100.0, abs=0.5)
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 0.0, "trim_end_beats": -20.0},
    )
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["cast"] == cast
    assert out["duration_beats"] == pytest.approx(120.0, abs=1.0)


def test_retrim_preserves_nudges(client, promoted_routine):
    """gh#190 item 6: alignment nudges are beat-free track-time slides —
    they ride a retrim untouched (dropped slots excepted)."""
    routine, _, _ = promoted_routine
    res = client.put(
        f"/api/routines/{routine['uuid']}/edits",
        json={"edits": {"lanes": {}, "jumps": [], "removedRecordedJumps": [],
                        "nudges": {"1": 0.05}}},
    )
    assert res.status_code == 200, res.text
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 10.0, "trim_end_beats": 0.0},
    )
    assert res.status_code == 200, res.text
    assert res.json()["edits"]["nudges"] == {"1": 0.05}


def test_retrim_rebases_pause_edits(client, promoted_routine):
    """gh#190 play/pause events: authored pauses and removed recorded
    pauses rebase by the start trim like jumps (durBeats rides along)."""
    routine, _, _ = promoted_routine
    res = client.put(
        f"/api/routines/{routine['uuid']}/edits",
        json={"edits": {"lanes": {}, "jumps": [], "removedRecordedJumps": [],
                        "pauses": [{"id": "p1", "slot": 1, "beat": 30.0, "durBeats": 4.0}],
                        "removedRecordedPauses": [{"slot": 1, "beat": 40.0}],
                        "nudges": {}}},
    )
    assert res.status_code == 200, res.text
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 10.0, "trim_end_beats": 0.0},
    )
    assert res.status_code == 200, res.text
    edits = res.json()["edits"]
    assert edits["pauses"] == [{"id": "p1", "slot": 1, "beat": 20.0, "durBeats": 4.0}]
    assert edits["removedRecordedPauses"] == [{"slot": 1, "beat": 30.0}]


def test_retrim_endpoint_rejects_broken_cast(client, promoted_routine):
    routine, _, _ = promoted_routine
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 0.0, "trim_end_beats": 70.0},
    )
    assert res.status_code == 422
    assert "fewer than 3" in res.json()["detail"]


def test_retrim_endpoint_requires_origin_take(client, db, promoted_routine):
    routine, take_uuid, _ = promoted_routine
    client.delete(f"/api/routine-takes/{take_uuid}")
    res = client.post(
        f"/api/routines/{routine['uuid']}/retrim",
        json={"trim_start_beats": 5.0, "trim_end_beats": 0.0},
    )
    assert res.status_code == 422
    assert "origin" in res.json()["detail"].lower()
