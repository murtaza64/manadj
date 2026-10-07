"""Take promotion re-points Set pins (sets 08, ADR 0023).

Promoting a Take is a one-time migration of every adjacency pin referencing it:
at the promotion endpoint, each pin of kind "take" with that uuid
is rewritten to ("transition", <promoted uuid>). No query-time
indirection — the rows themselves change. Clearing a promotion rewrites
nothing (pins already re-pointed stay on the Transition).

Mounts takes + transitions + sets routers together, in the style
of tests/test_takes_router.py / tests/test_track_archival.py.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import sets, takes, transitions


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(takes.router, prefix="/api/takes")
    app.include_router(sets.router, prefix="/api/sets")
    app.include_router(transitions.router, prefix="/api/transitions")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def take_payload(uuid: str, a_id: int, b_id: int):
    return {
        "uuid": uuid,
        "a_track_id": a_id,
        "b_track_id": b_id,
        "window_start_s": 10.0,
        "window_end_s": 22.5,
        "confidence": 0.9,
        "detector_version": 1,
        "params": {},
        "events": [],
    }


def make_set(client: TestClient, name: str = "Set") -> int:
    resp = client.post("/api/sets", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def put_entries(client: TestClient, set_id: int, items: list[dict]):
    resp = client.put(f"/api/sets/{set_id}/entries", json={"items": items})
    assert resp.status_code == 200, resp.text
    return resp.json()["entries"]


def get_pins(client: TestClient, set_id: int) -> list[tuple]:
    detail = client.get(f"/api/sets/{set_id}").json()
    return [(e["pin_kind"], e["pin_uuid"]) for e in detail["entries"]]


def save_transition(client: TestClient, a_id: int, b_id: int, uuid: str = "tr-9"):
    resp = client.put(f"/api/transitions/pair/{a_id}/{b_id}", json={
        "items": [{"uuid": uuid, "name": "Reviewed handover", "data": {
            "aExitS": 22.5, "bEntryS": 10.0, "durationS": 12.5,
        }}],
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_guest_take_links_saved_transition_without_relabeling_evidence(client, make_track):
    a, b = make_track(), make_track()
    payload = take_payload("guest-1", a.id, b.id) | {
        "kind": "guest",
        "origin": "manual",
        "engagement_uuid": "engagement-1",
        "params": {"audibleGain": 0.05, "settleHorizonS": 8},
        "events": [
            {"t": 10.0, "kind": "control", "control": "fader", "channel": "B", "value": 1.0},
            {"t": 22.5, "kind": "control", "control": "fader", "channel": "B", "value": 0.0},
        ],
    }
    resp = client.post("/api/takes", json=payload)
    assert resp.status_code == 200, resp.text
    evidence = client.get("/api/takes/guest-1").json()
    active, dormant = make_set(client, "Active"), make_set(client, "Dormant")
    ornament = {"pin_kind": "cameo-take", "pin_uuid": "guest-1"}
    put_entries(client, active, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "guest-1",
         "cameo_pins": [ornament]},
        {"track_id": b.id},
    ])
    resp = client.put(f"/api/sets/{dormant}/entries", json={
        "items": [{"track_id": b.id}],
        "dormant": [{"a_track_id": a.id, "b_track_id": b.id,
                     "pin_kind": "take", "pin_uuid": "guest-1"}],
        "dormant_cameos": [{"host_track_id": a.id, **ornament}],
    })
    assert resp.status_code == 200, resp.text

    saved = save_transition(client, a.id, b.id)
    resp = client.patch("/api/takes/guest-1/promoted", json={"promoted_transition_uuid": "tr-9"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["kind"] == "guest"
    assert client.get("/api/takes/guest-1").json() == {
        **evidence, "promoted_transition_uuid": "tr-9",
    }
    assert client.get("/api/transitions").json() == saved
    active_detail = client.get(f"/api/sets/{active}").json()
    dormant_detail = client.get(f"/api/sets/{dormant}").json()
    assert get_pins(client, active) == [("transition", "tr-9"), (None, None)]
    assert dormant_detail["dormant"] == [{
        "a_track_id": a.id, "b_track_id": b.id,
        "pin_kind": "transition", "pin_uuid": "tr-9",
    }]
    assert active_detail["entries"][0]["cameo_pins"] == [ornament]
    assert dormant_detail["dormant_cameos"] == [{"host_track_id": a.id, **ornament}]

    resp = client.patch("/api/takes/guest-1/promoted", json={"promoted_transition_uuid": None})
    assert resp.status_code == 200, resp.text
    assert client.get("/api/takes/guest-1").json() == evidence
    assert client.get(f"/api/sets/{active}").json() == active_detail
    assert client.get(f"/api/sets/{dormant}").json() == dormant_detail


@pytest.mark.parametrize("kind", ["guest", "handover"])
@pytest.mark.parametrize("target", ["missing", "reversed", "unrelated"])
def test_invalid_promotion_target_preserves_take_and_pins(client, make_track, kind, target):
    a, b, c, d = make_track(), make_track(), make_track(), make_track()
    resp = client.post("/api/takes", json=take_payload("tk-1", a.id, b.id) | {"kind": kind})
    assert resp.status_code == 200, resp.text
    save_transition(client, a.id, b.id, "previous")
    resp = client.patch("/api/takes/tk-1/promoted", json={"promoted_transition_uuid": "previous"})
    assert resp.status_code == 200, resp.text
    s = make_set(client)
    resp = client.put(f"/api/sets/{s}/entries", json={
        "items": [
            {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1",
             "cameo_pins": [{"pin_kind": "cameo-take", "pin_uuid": "tk-1"}]},
            {"track_id": b.id},
        ],
        "dormant": [{"a_track_id": a.id, "b_track_id": b.id,
                     "pin_kind": "take", "pin_uuid": "tk-1"}],
        "dormant_cameos": [{"host_track_id": c.id, "pin_kind": "cameo-take", "pin_uuid": "tk-1"}],
    })
    assert resp.status_code == 200, resp.text
    if target == "reversed":
        save_transition(client, b.id, a.id, "invalid")
    elif target == "unrelated":
        save_transition(client, c.id, d.id, "invalid")
    evidence = client.get("/api/takes/tk-1").json()
    pins = client.get(f"/api/sets/{s}").json()
    saved = client.get("/api/transitions").json()

    resp = client.patch("/api/takes/tk-1/promoted", json={"promoted_transition_uuid": "invalid"})
    assert resp.status_code == (404 if target == "missing" else 409), resp.text
    if target == "missing":
        assert resp.json()["detail"] == "promoted Transition not found"
    else:
        assert "invalid" in resp.json()["detail"]
        assert f"ordered track pair {a.id} -> {b.id}" in resp.json()["detail"]
    assert client.get("/api/takes/tk-1").json() == evidence
    assert client.get(f"/api/sets/{s}").json() == pins
    assert client.get("/api/transitions").json() == saved


def test_promotion_rewrites_pinned_take_to_transition(client, make_track):
    a, b = make_track(), make_track()
    save_transition(client, a.id, b.id)
    client.post("/api/takes", json=take_payload("tk-1", a.id, b.id))
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1"},
        {"track_id": b.id},
    ])

    resp = client.patch("/api/takes/tk-1/promoted", json={"promoted_transition_uuid": "tr-9"})
    assert resp.status_code == 200, resp.text

    assert get_pins(client, s) == [("transition", "tr-9"), (None, None)]


def test_promotion_rewrites_pins_in_every_set(client, make_track):
    a, b = make_track(), make_track()
    save_transition(client, a.id, b.id)
    client.post("/api/takes", json=take_payload("tk-1", a.id, b.id))
    s1, s2 = make_set(client, "One"), make_set(client, "Two")
    for s in (s1, s2):
        put_entries(client, s, [
            {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1"},
            {"track_id": b.id},
        ])

    client.patch("/api/takes/tk-1/promoted", json={"promoted_transition_uuid": "tr-9"})

    assert get_pins(client, s1)[0] == ("transition", "tr-9")
    assert get_pins(client, s2)[0] == ("transition", "tr-9")


def test_promotion_leaves_other_pins_untouched(client, make_track):
    a, b, c, d = make_track(), make_track(), make_track(), make_track()
    save_transition(client, a.id, b.id)
    save_transition(client, c.id, d.id, "tr-1")
    client.post("/api/takes", json=take_payload("tk-1", a.id, b.id))
    client.post("/api/takes", json=take_payload("tk-2", b.id, c.id))
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1"},
        {"track_id": b.id, "pin_kind": "take", "pin_uuid": "tk-2"},
        {"track_id": c.id, "pin_kind": "transition", "pin_uuid": "tr-1"},
        {"track_id": d.id},
    ])

    client.patch("/api/takes/tk-1/promoted", json={"promoted_transition_uuid": "tr-9"})

    assert get_pins(client, s) == [
        ("transition", "tr-9"),
        ("take", "tk-2"),
        ("transition", "tr-1"),
        (None, None),
    ]


def test_clearing_promotion_rewrites_nothing(client, make_track):
    """PATCH null clears the Take's reference; pins are not un-migrated,
    and remaining Take pins (same uuid, hypothetically) are untouched."""
    a, b = make_track(), make_track()
    client.post("/api/takes", json=take_payload("tk-1", a.id, b.id))
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1"},
        {"track_id": b.id},
    ])

    resp = client.patch("/api/takes/tk-1/promoted", json={"promoted_transition_uuid": None})
    assert resp.status_code == 200

    # No promotion happened — the Take pin stays a Take pin.
    assert get_pins(client, s) == [("take", "tk-1"), (None, None)]


def test_promotion_repoints_dormant_take_pins_too(client, make_track):
    """Sets 07: a Dormant Take memory joins the one-time migration — when
    its pair becomes adjacent again, it restores the Transition."""
    a, b = make_track(), make_track()
    save_transition(client, a.id, b.id)
    client.post("/api/takes", json=take_payload("tk-1", a.id, b.id))
    s = make_set(client)
    resp = client.put(f"/api/sets/{s}/entries", json={
        "items": [{"track_id": b.id}, {"track_id": a.id}],
        "dormant": [
            {"a_track_id": a.id, "b_track_id": b.id, "pin_kind": "take", "pin_uuid": "tk-1"},
        ],
    })
    assert resp.status_code == 200, resp.text

    client.patch("/api/takes/tk-1/promoted", json={"promoted_transition_uuid": "tr-9"})

    detail = client.get(f"/api/sets/{s}").json()
    assert [(d["pin_kind"], d["pin_uuid"]) for d in detail["dormant"]] == [
        ("transition", "tr-9")
    ]
