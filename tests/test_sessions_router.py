"""Sessions router seam (Sessions PRD, ADR 0033): status + shape.

Real in-memory SQLite via the migration path (conftest) — same
minimal-app pattern as the takes router tests. A Session is a header + an
append-only chunk log; the list carries a derived Take count; delete
cascades chunks but never a Take.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import sessions, takes


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sessions.router, prefix="/api/sessions")
    app.include_router(takes.router, prefix="/api/takes")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def take_payload(uuid: str, a_id: int, b_id: int, **over):
    payload = {
        "uuid": uuid,
        "a_track_id": a_id,
        "b_track_id": b_id,
        "window_start_s": 10.0,
        "window_end_s": 22.5,
        "confidence": 0.9,
        "detector_version": 1,
        "params": {"audibleGain": 0.05},
        "events": [{"t": 10.0, "kind": "tick", "playheads": {}}],
    }
    payload.update(over)
    return payload


def test_create_then_list(client):
    resp = client.post("/api/sessions", json={"uuid": "s1"})
    assert resp.status_code == 200, resp.text
    row = resp.json()
    assert row["uuid"] == "s1"
    assert row["ended_at"] is None
    assert row["take_count"] == 0
    assert row["started_at"] is not None

    rows = client.get("/api/sessions").json()
    assert [r["uuid"] for r in rows] == ["s1"]


def test_list_is_newest_first(client):
    client.post("/api/sessions", json={"uuid": "s1", "started_at": "2026-07-14T20:00:00"})
    client.post("/api/sessions", json={"uuid": "s2", "started_at": "2026-07-15T20:00:00"})
    rows = client.get("/api/sessions").json()
    assert [r["uuid"] for r in rows] == ["s2", "s1"]


def test_duplicate_session_uuid_400(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    assert client.post("/api/sessions", json={"uuid": "s1"}).status_code == 400


AUDIBLE_EVENTS = [
    {"t": 1.0, "kind": "load", "channel": "A", "trackId": 1, "bpm": 174.0},
    {"t": 2.0, "kind": "transport", "channel": "A", "action": "play", "playhead": 0.0},
]

SILENT_EVENTS = [
    {"t": 1.0, "kind": "load", "channel": "A", "trackId": 1, "bpm": 174.0},
    {"t": 2.0, "kind": "control", "control": "fader", "channel": "A", "value": 0.8},
    {"t": 3.0, "kind": "tick", "playheads": {}},
]


def test_recover_closes_audible_orphans_and_deletes_silent_ones(client):
    """Crash recovery still closes stale open Sessions — but a row whose
    stream was 100% silent (legacy activation on non-audible events, or
    empty) is deleted, not closed (sessions 11)."""
    client.post("/api/sessions", json={"uuid": "empty"})
    client.post("/api/sessions", json={"uuid": "silent"})
    client.post("/api/sessions/silent/chunks", json={"seq": 0, "events": SILENT_EVENTS})
    client.post("/api/sessions", json={"uuid": "with-audible"})
    client.post("/api/sessions/with-audible/chunks", json={"seq": 0, "events": AUDIBLE_EVENTS})

    resp = client.post("/api/sessions/recover")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"closed": 1, "deleted": 2}
    rows = client.get("/api/sessions").json()
    assert [r["uuid"] for r in rows] == ["with-audible"]
    assert rows[0]["ended_at"] is not None


def test_recover_sweeps_closed_legacy_silent_rows_too(client, db_session):
    """No empty/silent history entry survives — even one a legacy path had
    already closed cleanly (inserted directly: the new end path would have
    deleted it)."""
    import datetime
    import json as jsonlib

    from backend import models

    legacy = models.Session(uuid="legacy-silent", ended_at=datetime.datetime(2026, 7, 15, 21, 0))
    db_session.add(legacy)
    db_session.commit()
    db_session.add(
        models.SessionChunk(session_id=legacy.id, seq=0, events_json=jsonlib.dumps(SILENT_EVENTS))
    )
    db_session.commit()
    client.post("/api/sessions", json={"uuid": "kept"})
    client.post("/api/sessions/kept/chunks", json={"seq": 0, "events": AUDIBLE_EVENTS})
    client.patch("/api/sessions/kept/end", json={})

    resp = client.post("/api/sessions/recover")
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted"] == 1
    rows = client.get("/api/sessions").json()
    assert [r["uuid"] for r in rows] == ["kept"]


def test_append_chunks_accumulate(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    r0 = client.post(
        "/api/sessions/s1/chunks",
        json={"seq": 0, "events": [{"t": 1.0, "kind": "tick", "playheads": {}}]},
    )
    assert r0.status_code == 200, r0.text
    r1 = client.post(
        "/api/sessions/s1/chunks",
        json={"seq": 1, "events": [{"t": 6.0, "kind": "tick", "playheads": {}}]},
    )
    assert r1.status_code == 200, r1.text


def test_get_session_concatenates_chunks_in_seq_order(client):
    """The inspection read model: one fetch, whole log, seq-ordered."""
    client.post("/api/sessions", json={"uuid": "s1"})
    # Append out of order — the fetch must still read seq-ordered.
    client.post(
        "/api/sessions/s1/chunks",
        json={"seq": 1, "events": [{"t": 6.0, "kind": "tick", "playheads": {}}]},
    )
    client.post(
        "/api/sessions/s1/chunks",
        json={"seq": 0, "events": [{"t": 1.0, "kind": "tick", "playheads": {}}]},
    )
    resp = client.get("/api/sessions/s1")
    assert resp.status_code == 200, resp.text
    detail = resp.json()
    assert detail["uuid"] == "s1"
    assert detail["take_count"] == 0
    assert [e["t"] for e in detail["events"]] == [1.0, 6.0]


def test_get_session_empty_log(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    detail = client.get("/api/sessions/s1").json()
    assert detail["events"] == []


def test_get_unknown_session_404(client):
    assert client.get("/api/sessions/nope").status_code == 404


def test_append_unknown_session_404(client):
    assert client.post("/api/sessions/nope/chunks", json={"seq": 0, "events": []}).status_code == 404


def test_duplicate_chunk_seq_400(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/sessions/s1/chunks", json={"seq": 0, "events": []})
    assert client.post("/api/sessions/s1/chunks", json={"seq": 0, "events": []}).status_code == 400


def test_end_session(client):
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/sessions/s1/chunks", json={"seq": 0, "events": AUDIBLE_EVENTS})
    resp = client.patch("/api/sessions/s1/end", json={"ended_at": "2026-07-15T21:30:00"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ended_at"] is not None
    assert client.get("/api/sessions").json()[0]["ended_at"] is not None


def test_end_deletes_a_100_percent_silent_session(client):
    """Clean shutdown (and the auto-split, which ends through the same
    route) leaves no persisted Session whose stream was 100% silent
    (sessions 11)."""
    client.post("/api/sessions", json={"uuid": "silent"})
    client.post("/api/sessions/silent/chunks", json={"seq": 0, "events": SILENT_EVENTS})
    resp = client.patch("/api/sessions/silent/end", json={})
    assert resp.status_code == 200, resp.text
    assert client.get("/api/sessions").json() == []


def test_end_deletes_an_empty_session(client):
    client.post("/api/sessions", json={"uuid": "empty"})
    assert client.patch("/api/sessions/empty/end", json={}).status_code == 200
    assert client.get("/api/sessions").json() == []


def test_split_persists_two_audible_sessions(client):
    """The client-side ten-minute split as the router sees it: end the old
    Session, then open a fresh one on the next audible instant — two rows
    persist, both audible, seq restarting at 0 in the second."""
    client.post("/api/sessions", json={"uuid": "night-1"})
    client.post("/api/sessions/night-1/chunks", json={"seq": 0, "events": AUDIBLE_EVENTS})
    # The observed idle tail stays in the OLD append-only log.
    client.post(
        "/api/sessions/night-1/chunks",
        json={"seq": 1, "events": [{"t": 700.0, "kind": "tick", "playheads": {}}]},
    )
    client.patch("/api/sessions/night-1/end", json={})

    client.post("/api/sessions", json={"uuid": "night-2"})
    client.post("/api/sessions/night-2/chunks", json={"seq": 0, "events": AUDIBLE_EVENTS})
    client.patch("/api/sessions/night-2/end", json={})

    rows = client.get("/api/sessions").json()
    assert sorted(r["uuid"] for r in rows) == ["night-1", "night-2"]
    assert all(r["ended_at"] is not None for r in rows)
    tail = client.get("/api/sessions/night-1").json()["events"]
    assert tail[-1]["t"] == 700.0


def test_end_unknown_session_404(client):
    assert client.patch("/api/sessions/nope/end", json={}).status_code == 404


def test_take_count_reflects_stamped_takes(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/takes", json=take_payload("t1", a.id, b.id, session_uuid="s1"))
    client.post("/api/takes", json=take_payload("t2", a.id, b.id, session_uuid="s1"))
    # A sessionless Take does not count toward any Session.
    client.post("/api/takes", json=take_payload("t3", a.id, b.id))
    row = next(r for r in client.get("/api/sessions").json() if r["uuid"] == "s1")
    assert row["take_count"] == 2


def test_take_carries_session_and_origin(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/takes", json=take_payload("t1", a.id, b.id, session_uuid="s1"))
    take = client.get("/api/takes").json()[0]
    assert take["session_uuid"] == "s1"
    assert take["origin"] == "detected"


def test_delete_session_cascades_chunks_but_spares_takes(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/sessions", json={"uuid": "s1"})
    client.post("/api/sessions/s1/chunks", json={"seq": 0, "events": []})
    client.post("/api/takes", json=take_payload("t1", a.id, b.id, session_uuid="s1"))

    assert client.delete("/api/sessions/s1").status_code == 200
    assert client.get("/api/sessions").json() == []
    # The Take survives with its own event slice — deleting a Session never
    # destroys kept evidence (ADR 0033).
    takes_rows = client.get("/api/takes").json()
    assert [t["uuid"] for t in takes_rows] == ["t1"]
    detail = client.get("/api/takes/t1").json()
    assert detail["session_uuid"] == "s1"  # provenance survives the Session
    assert len(detail["events"]) == 1


def test_delete_unknown_session_404(client):
    assert client.delete("/api/sessions/nope").status_code == 404
