"""Set lifecycle edges (sets 12): graceful degradation at the Set's
boundaries with the rest of the library.

- Deleting a pinned Take (DELETE /api/takes/{uuid}) or a pinned
  Transition (dropped from its pair's wholesale PUT) degrades the pin to
  Unresolved server-side: pin_kind/pin_uuid are nulled — the DB never
  keeps a broken reference. (The client already degrades dangling pins at
  render time, adjacency.ts; this makes a fresh load agree.)
- Archiving a Track that belongs to a Set flags the Set
  (has_archived_tracks on Set serializations) rather than silently
  altering it — archive_track removes from Playlists but never from Sets.

Dormant pins (issue 07, unstarted) are out of scope here — dropping
dormant pins that reference deleted artifacts is deferred to 07.

Mounts sets + takes + transitions + tracks routers as needed, in the
style of tests/test_track_archival.py.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import sets, takes, transitions
from backend.routers.tracks import router as tracks_router


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sets.router, prefix="/api/sets")
    app.include_router(takes.router, prefix="/api/takes")
    app.include_router(transitions.router, prefix="/api/transitions")
    app.include_router(tracks_router, prefix="/api/tracks")
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


def transition_item(uuid: str, **over):
    return {"uuid": uuid, "name": f"Transition {uuid}", "favorite": False, "data": {}, **over}


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


# ── Deleting a pinned Take degrades the pin ─────────────────────────────


def test_deleting_pinned_take_nulls_the_pin(client, make_track):
    a, b = make_track(), make_track()
    client.post("/api/takes", json=take_payload("tk-1", a.id, b.id))
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1"},
        {"track_id": b.id},
    ])

    assert client.delete("/api/takes/tk-1").status_code == 200

    assert get_pins(client, s) == [(None, None), (None, None)]


def test_deleting_take_degrades_in_every_set_and_spares_others(client, make_track):
    a, b, c = make_track(), make_track(), make_track()
    client.post("/api/takes", json=take_payload("tk-1", a.id, b.id))
    client.post("/api/takes", json=take_payload("tk-2", b.id, c.id))
    s1, s2 = make_set(client, "One"), make_set(client, "Two")
    put_entries(client, s1, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1"},
        {"track_id": b.id, "pin_kind": "take", "pin_uuid": "tk-2"},
        {"track_id": c.id},
    ])
    put_entries(client, s2, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "tk-1"},
        {"track_id": b.id, "pin_kind": "transition", "pin_uuid": "tr-1"},
        {"track_id": c.id},
    ])

    client.delete("/api/takes/tk-1")

    assert get_pins(client, s1) == [(None, None), ("take", "tk-2"), (None, None)]
    assert get_pins(client, s2) == [(None, None), ("transition", "tr-1"), (None, None)]


# ── Deleting a pinned Transition (via pair replace) degrades the pin ────


def test_transition_dropped_from_pair_nulls_the_pin(client, make_track):
    a, b = make_track(), make_track()
    client.put(
        f"/api/transitions/pair/{a.id}/{b.id}",
        json={"items": [transition_item("tr-1"), transition_item("tr-2")]},
    )
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "transition", "pin_uuid": "tr-1"},
        {"track_id": b.id},
    ])

    # The editor's autosave drops tr-1 from the pair.
    resp = client.put(
        f"/api/transitions/pair/{a.id}/{b.id}",
        json={"items": [transition_item("tr-2")]},
    )
    assert resp.status_code == 200, resp.text

    assert get_pins(client, s) == [(None, None), (None, None)]


def test_pair_replace_update_keeps_pins(client, make_track):
    """Updating (not deleting) a pinned Transition never touches the pin."""
    a, b = make_track(), make_track()
    client.put(
        f"/api/transitions/pair/{a.id}/{b.id}",
        json={"items": [transition_item("tr-1")]},
    )
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "transition", "pin_uuid": "tr-1"},
        {"track_id": b.id},
    ])

    client.put(
        f"/api/transitions/pair/{a.id}/{b.id}",
        json={"items": [transition_item("tr-1", name="Renamed", favorite=True)]},
    )

    assert get_pins(client, s) == [("transition", "tr-1"), (None, None)]


def test_pair_delete_spares_same_uuid_take_pins_nowhere_but_transition_kind(client, make_track):
    """Degradation is kind-aware: a Take pin whose uuid coincides with a
    deleted Transition uuid is untouched (uuids are namespaced by kind)."""
    a, b = make_track(), make_track()
    client.put(
        f"/api/transitions/pair/{a.id}/{b.id}",
        json={"items": [transition_item("shared-uuid")]},
    )
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "take", "pin_uuid": "shared-uuid"},
        {"track_id": b.id},
    ])

    client.put(f"/api/transitions/pair/{a.id}/{b.id}", json={"items": []})

    assert get_pins(client, s) == [("take", "shared-uuid"), (None, None)]


# ── Archiving a Track flags the Set (never alters it) ───────────────────


def test_archiving_a_set_track_flags_the_set(client, make_track):
    a, b = make_track(), make_track()
    s = make_set(client)
    put_entries(client, s, [{"track_id": a.id}, {"track_id": b.id}])

    rows = client.get("/api/sets").json()
    assert rows[0]["has_archived_tracks"] is False
    assert client.get(f"/api/sets/{s}").json()["has_archived_tracks"] is False

    assert client.post(f"/api/tracks/{a.id}/archive").status_code == 200

    rows = client.get("/api/sets").json()
    assert rows[0]["has_archived_tracks"] is True
    assert client.get(f"/api/sets/{s}").json()["has_archived_tracks"] is True

    # Unarchive clears the flag.
    client.post(f"/api/tracks/{a.id}/unarchive")
    assert client.get(f"/api/sets/{s}").json()["has_archived_tracks"] is False


def test_archiving_never_alters_the_set(client, make_track):
    """Archive removes the Track from Playlists (existing semantics) but a
    Set keeps its entry, order, and pins — the flag is the whole story."""
    a, b, c = make_track(), make_track(), make_track()
    s = make_set(client)
    put_entries(client, s, [
        {"track_id": a.id, "pin_kind": "transition", "pin_uuid": "tr-1"},
        {"track_id": b.id},
        {"track_id": c.id},
    ])

    client.post(f"/api/tracks/{b.id}/archive")

    detail = client.get(f"/api/sets/{s}").json()
    assert [e["track_id"] for e in detail["entries"]] == [a.id, b.id, c.id]
    assert get_pins(client, s) == [("transition", "tr-1"), (None, None), (None, None)]


def test_flag_is_per_set(client, make_track):
    a, b = make_track(), make_track()
    s1, s2 = make_set(client, "One"), make_set(client, "Two")
    put_entries(client, s1, [{"track_id": a.id}])
    put_entries(client, s2, [{"track_id": b.id}])

    client.post(f"/api/tracks/{a.id}/archive")

    rows = {r["name"]: r["has_archived_tracks"] for r in client.get("/api/sets").json()}
    assert rows == {"One": True, "Two": False}
