"""Takes router seam (transition-takes 02, ADR 0020): status + shape.

Real in-memory SQLite via the migration path (conftest), fake nothing —
same minimal-app pattern as the transitions router tests. Takes are
immutable audit rows: create, list (metadata only), detail (with the raw
event slice), delete.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import takes


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
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
        "params": {"audibleGain": 0.05, "settleHorizonS": 8},
        "events": [
            {"t": 10.0, "kind": "control", "control": "fader", "channel": "B", "value": 1.0},
            {"t": 22.5, "kind": "control", "control": "fader", "channel": "A", "value": 0.0},
        ],
    }
    payload.update(over)
    return payload


def test_create_then_list(client, make_track):
    a, b = make_track(), make_track()
    resp = client.post("/api/takes", json=take_payload("t1", a.id, b.id))
    assert resp.status_code == 200, resp.text

    rows = client.get("/api/takes").json()
    assert len(rows) == 1
    row = rows[0]
    assert row["uuid"] == "t1"
    assert row["a_track_id"] == a.id
    assert row["b_track_id"] == b.id
    assert row["window_start_s"] == 10.0
    assert row["window_end_s"] == 22.5
    assert row["confidence"] == 0.9
    assert row["detector_version"] == 1
    assert row["promoted_transition_uuid"] is None
    assert row["detected_at"] is not None
    # List rows are metadata only — the raw slice stays behind the detail.
    assert "events" not in row


def test_list_is_newest_first(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/takes", json=take_payload("t1", a.id, b.id))
    client.post("/api/takes", json=take_payload("t2", a.id, b.id))
    rows = client.get("/api/takes").json()
    assert [r["uuid"] for r in rows] == ["t2", "t1"]


def test_detail_returns_raw_slice(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/takes", json=take_payload("t1", a.id, b.id))
    detail = client.get("/api/takes/t1").json()
    assert detail["uuid"] == "t1"
    assert detail["params"]["settleHorizonS"] == 8
    assert [e["t"] for e in detail["events"]] == [10.0, 22.5]


def test_detail_unknown_404(client):
    assert client.get("/api/takes/nope").status_code == 404


def test_create_unknown_track_404(client, make_track):
    a = make_track()
    resp = client.post("/api/takes", json=take_payload("t1", a.id, 99999))
    assert resp.status_code == 404


def test_duplicate_uuid_400(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/takes", json=take_payload("t1", a.id, b.id))
    resp = client.post("/api/takes", json=take_payload("t1", a.id, b.id))
    assert resp.status_code == 400


def test_delete(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/takes", json=take_payload("t1", a.id, b.id))
    assert client.delete("/api/takes/t1").status_code == 200
    assert client.get("/api/takes").json() == []
    assert client.delete("/api/takes/t1").status_code == 404


def test_promote_reference(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/takes", json=take_payload("t1", a.id, b.id))
    resp = client.patch("/api/takes/t1/promoted", json={"promoted_transition_uuid": "tr-9"})
    assert resp.status_code == 200
    assert client.get("/api/takes").json()[0]["promoted_transition_uuid"] == "tr-9"
    # Clearing is allowed (the promoted Transition may be deleted later).
    resp = client.patch("/api/takes/t1/promoted", json={"promoted_transition_uuid": None})
    assert resp.status_code == 200
    assert client.get("/api/takes").json()[0]["promoted_transition_uuid"] is None
    assert client.patch("/api/takes/nope/promoted", json={"promoted_transition_uuid": "x"}).status_code == 404
