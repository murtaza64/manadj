"""Set entry Cameo pins (cameos PRD, #140): wholesale round-trip,
manual-only storage, host-keyed dormancy rows, guest-Take degradation.

Same minimal-app pattern as the sets router tests. Cameo pins are entry
ornaments: adjacency-independent, always manual, no Unresolved — degrade
(on artifact deletion) means DROP.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import sets, takes


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sets.router, prefix="/api/sets")
    app.include_router(takes.router, prefix="/api/takes")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def make_set(client: TestClient, name: str = "s") -> int:
    return client.post("/api/sets", json={"name": name}).json()["id"]


def test_cameo_pins_round_trip(client, make_track):
    a, b = make_track(), make_track()
    set_id = make_set(client)
    resp = client.put(
        f"/api/sets/{set_id}/entries",
        json={
            "items": [
                {
                    "track_id": a.id,
                    "cameo_pins": [
                        {"pin_kind": "cameo", "pin_uuid": "c1"},
                        {"pin_kind": "cameo-take", "pin_uuid": "t1"},
                    ],
                },
                {"track_id": b.id},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    detail = client.get(f"/api/sets/{set_id}").json()
    entry_a = next(e for e in detail["entries"] if e["track_id"] == a.id)
    entry_b = next(e for e in detail["entries"] if e["track_id"] == b.id)
    # Order preserved; multiple pins per entry are the point (PRD story 14).
    assert entry_a["cameo_pins"] == [
        {"pin_kind": "cameo", "pin_uuid": "c1"},
        {"pin_kind": "cameo-take", "pin_uuid": "t1"},
    ]
    assert entry_b["cameo_pins"] == []
    assert detail["dormant_cameos"] == []


def test_cameo_pin_kind_vocabulary(client, make_track):
    a = make_track()
    set_id = make_set(client)
    resp = client.put(
        f"/api/sets/{set_id}/entries",
        json={
            "items": [
                {
                    "track_id": a.id,
                    "cameo_pins": [{"pin_kind": "transition", "pin_uuid": "x"}],
                }
            ]
        },
    )
    assert resp.status_code == 422


def test_dormant_cameo_round_trip(client, make_track):
    """Cameo dormancy keys on the host Track per Set: the memory row may
    reference a track absent from the entries (that IS its meaning)."""
    a, gone = make_track(), make_track()
    set_id = make_set(client)
    resp = client.put(
        f"/api/sets/{set_id}/entries",
        json={
            "items": [{"track_id": a.id}],
            "dormant_cameos": [
                {"host_track_id": gone.id, "pin_kind": "cameo", "pin_uuid": "c9"}
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    detail = client.get(f"/api/sets/{set_id}").json()
    assert detail["dormant_cameos"] == [
        {"host_track_id": gone.id, "pin_kind": "cameo", "pin_uuid": "c9"}
    ]


def test_cameo_pins_replace_wholesale(client, make_track):
    a = make_track()
    set_id = make_set(client)
    client.put(
        f"/api/sets/{set_id}/entries",
        json={
            "items": [
                {"track_id": a.id, "cameo_pins": [{"pin_kind": "cameo", "pin_uuid": "c1"}]}
            ]
        },
    )
    client.put(f"/api/sets/{set_id}/entries", json={"items": [{"track_id": a.id}]})
    detail = client.get(f"/api/sets/{set_id}").json()
    assert detail["entries"][0]["cameo_pins"] == []


def test_deleting_guest_take_drops_cameo_take_pins(client, make_track):
    host, guest = make_track(), make_track()
    resp = client.post(
        "/api/takes",
        json={
            "uuid": "gt1",
            "a_track_id": host.id,
            "b_track_id": guest.id,
            "window_start_s": 100.0,
            "window_end_s": 130.0,
            "confidence": 0.9,
            "detector_version": 4,
            "params": {},
            "events": [],
            "kind": "guest",
            "engagement_uuid": "e1",
        },
    )
    assert resp.status_code == 200, resp.text

    set_id = make_set(client)
    client.put(
        f"/api/sets/{set_id}/entries",
        json={
            "items": [
                {
                    "track_id": host.id,
                    "cameo_pins": [{"pin_kind": "cameo-take", "pin_uuid": "gt1"}],
                }
            ]
        },
    )
    client.delete("/api/takes/gt1")
    detail = client.get(f"/api/sets/{set_id}").json()
    assert detail["entries"][0]["cameo_pins"] == []


def test_take_kind_and_engagement_round_trip(client, make_track):
    a, b = make_track(), make_track()
    client.post(
        "/api/takes",
        json={
            "uuid": "gt1",
            "a_track_id": a.id,
            "b_track_id": b.id,
            "window_start_s": 1.0,
            "window_end_s": 2.0,
            "confidence": 0.9,
            "detector_version": 4,
            "params": {},
            "events": [],
            "kind": "guest",
            "engagement_uuid": "e1",
        },
    )
    row = client.get("/api/takes").json()[0]
    assert row["kind"] == "guest"
    assert row["engagement_uuid"] == "e1"


def test_take_kind_defaults_to_handover(client, make_track):
    a, b = make_track(), make_track()
    client.post(
        "/api/takes",
        json={
            "uuid": "t1",
            "a_track_id": a.id,
            "b_track_id": b.id,
            "window_start_s": 1.0,
            "window_end_s": 2.0,
            "confidence": 0.9,
            "detector_version": 4,
            "params": {},
            "events": [],
        },
    )
    row = client.get("/api/takes").json()[0]
    assert row["kind"] == "handover"
    assert row["engagement_uuid"] is None


def test_guest_take_refuses_transition_promotion(client, make_track):
    a, b = make_track(), make_track()
    client.post(
        "/api/takes",
        json={
            "uuid": "gt1",
            "a_track_id": a.id,
            "b_track_id": b.id,
            "window_start_s": 1.0,
            "window_end_s": 2.0,
            "confidence": 0.9,
            "detector_version": 4,
            "params": {},
            "events": [],
            "kind": "guest",
        },
    )
    resp = client.patch(
        "/api/takes/gt1/promoted", json={"promoted_transition_uuid": "tr1"}
    )
    assert resp.status_code == 409
