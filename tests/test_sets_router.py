"""Sets router seam (sets 01): CRUD + client-authoritative entry replace.

Real in-memory SQLite via the migration path (conftest), fake nothing —
same minimal-app pattern as the takes/transitions router tests. A Set is
a plan over the library: deleting one touches no Track/Transition/Take.
Entries follow the client-authoritative wholesale-replace pattern
(ADR 0011): one PUT replaces the whole ordered entry list, reconciled by
track_id (a Track appears at most once per Set — entry identity).
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import models
from backend.database import get_db
from backend.routers import sets


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(sets.router, prefix="/api/sets")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def make_set(client: TestClient, name: str = "Friday night", **over) -> dict:
    resp = client.post("/api/sets", json={"name": name, **over})
    assert resp.status_code == 201, resp.text
    return resp.json()


def put_entries(client: TestClient, set_id: int, track_ids: list[int]):
    return client.put(
        f"/api/sets/{set_id}/entries",
        json={"items": [{"track_id": tid} for tid in track_ids]},
    )


# ── Set CRUD ────────────────────────────────────────────────────────────


def test_create_then_list(client):
    created = make_set(client, "Friday night", color="#ff0080")
    assert created["name"] == "Friday night"
    assert created["color"] == "#ff0080"

    rows = client.get("/api/sets").json()
    assert len(rows) == 1
    assert rows[0]["id"] == created["id"]
    assert rows[0]["name"] == "Friday night"


def test_list_ordered_by_display_order(client):
    a = make_set(client, "A", display_order=2)
    b = make_set(client, "B", display_order=0)
    c = make_set(client, "C", display_order=1)
    rows = client.get("/api/sets").json()
    assert [r["id"] for r in rows] == [b["id"], c["id"], a["id"]]


def test_rename_and_recolor(client):
    s = make_set(client)
    resp = client.patch(f"/api/sets/{s['id']}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    resp = client.patch(f"/api/sets/{s['id']}", json={"color": "#00d0ff"})
    assert resp.status_code == 200
    assert resp.json()["color"] == "#00d0ff"
    # Name untouched by the color-only patch.
    assert resp.json()["name"] == "Renamed"


def test_patch_unknown_404(client):
    assert client.patch("/api/sets/999", json={"name": "x"}).status_code == 404


def test_delete(client):
    s = make_set(client)
    assert client.delete(f"/api/sets/{s['id']}").status_code == 204
    assert client.get("/api/sets").json() == []
    assert client.delete(f"/api/sets/{s['id']}").status_code == 404


def test_get_unknown_404(client):
    assert client.get("/api/sets/999").status_code == 404


# ── Tempo policy (sets 06) ──────────────────────────────────────────────


def test_tempo_policy_defaults_to_riding(client):
    s = make_set(client)
    assert s["tempo_policy"] == "riding"
    assert s["set_tempo_bpm"] is None


def test_tempo_policy_persists(client):
    s = make_set(client)
    resp = client.patch(
        f"/api/sets/{s['id']}", json={"tempo_policy": "fixed", "set_tempo_bpm": 128.0}
    )
    assert resp.status_code == 200
    assert resp.json()["tempo_policy"] == "fixed"
    assert resp.json()["set_tempo_bpm"] == 128.0

    # Round-trips through GET; other fields untouched.
    detail = client.get(f"/api/sets/{s['id']}").json()
    assert detail["tempo_policy"] == "fixed"
    assert detail["set_tempo_bpm"] == 128.0
    assert detail["name"] == s["name"]

    # Back to riding; a null Set tempo is legal (defaults at plan time).
    resp = client.patch(
        f"/api/sets/{s['id']}", json={"tempo_policy": "riding", "set_tempo_bpm": None}
    )
    assert resp.status_code == 200
    assert resp.json()["tempo_policy"] == "riding"
    assert resp.json()["set_tempo_bpm"] is None


def test_tempo_policy_rejects_unknown_values(client):
    s = make_set(client)
    assert client.patch(f"/api/sets/{s['id']}", json={"tempo_policy": "swing"}).status_code == 422
    assert client.patch(f"/api/sets/{s['id']}", json={"set_tempo_bpm": 0}).status_code == 422


# ── Entries: wholesale replace (ADR 0011 pattern) ───────────────────────


def test_get_empty_set_has_no_entries(client):
    s = make_set(client)
    detail = client.get(f"/api/sets/{s['id']}").json()
    assert detail["name"] == s["name"]
    assert detail["entries"] == []


def test_replace_sets_order(client, make_track):
    t1, t2, t3 = make_track(), make_track(), make_track()
    s = make_set(client)
    resp = put_entries(client, s["id"], [t2.id, t1.id, t3.id])
    assert resp.status_code == 200, resp.text
    entries = resp.json()["entries"]
    assert [e["track_id"] for e in entries] == [t2.id, t1.id, t3.id]
    assert [e["position"] for e in entries] == [0, 1, 2]

    # Round-trips through GET.
    detail = client.get(f"/api/sets/{s['id']}").json()
    assert [e["track_id"] for e in detail["entries"]] == [t2.id, t1.id, t3.id]


def test_replace_reorders_and_removes(client, make_track):
    t1, t2, t3 = make_track(), make_track(), make_track()
    s = make_set(client)
    put_entries(client, s["id"], [t1.id, t2.id, t3.id])
    resp = put_entries(client, s["id"], [t3.id, t1.id])
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    assert [e["track_id"] for e in entries] == [t3.id, t1.id]

    # Idempotent: re-PUTting the same payload is a no-op.
    resp = put_entries(client, s["id"], [t3.id, t1.id])
    assert [e["track_id"] for e in resp.json()["entries"]] == [t3.id, t1.id]


def test_replace_empty_clears(client, make_track):
    t1 = make_track()
    s = make_set(client)
    put_entries(client, s["id"], [t1.id])
    resp = put_entries(client, s["id"], [])
    assert resp.status_code == 200
    assert resp.json()["entries"] == []


def test_duplicate_track_400(client, make_track):
    """A Track appears at most once in a Set (PRD invariant)."""
    t1 = make_track()
    s = make_set(client)
    resp = put_entries(client, s["id"], [t1.id, t1.id])
    assert resp.status_code == 400


def test_unknown_track_404(client, make_track):
    t1 = make_track()
    s = make_set(client)
    resp = put_entries(client, s["id"], [t1.id, 99999])
    assert resp.status_code == 404


def test_replace_unknown_set_404(client, make_track):
    t1 = make_track()
    assert put_entries(client, 999, [t1.id]).status_code == 404


# ── A Set is a plan, never an owner ─────────────────────────────────────


def test_delete_set_touches_no_track_transition_take(client, db_session, make_track):
    t1, t2 = make_track(), make_track()
    db_session.add(
        models.Transition(
            a_track_id=t1.id, b_track_id=t2.id, uuid="tr-1", position=0,
            name="Transition 1", data_json="{}",
        )
    )
    db_session.add(
        models.Take(
            uuid="tk-1", a_track_id=t1.id, b_track_id=t2.id,
            window_start_s=0.0, window_end_s=1.0, confidence=1.0,
            detector_version=1, params_json="{}", events_json="[]",
        )
    )
    db_session.commit()

    s = make_set(client)
    put_entries(client, s["id"], [t1.id, t2.id])
    assert client.delete(f"/api/sets/{s['id']}").status_code == 204

    assert db_session.query(models.Track).count() == 2
    assert db_session.query(models.Transition).count() == 1
    assert db_session.query(models.Take).count() == 1
    # The entries went with the Set.
    assert db_session.query(models.SetEntry).count() == 0


def test_sidebar_reorder(client):
    a, b = make_set(client, "A"), make_set(client, "B")
    resp = client.post(
        "/api/sets/reorder",
        json=[{"id": b["id"], "display_order": 0}, {"id": a["id"], "display_order": 1}],
    )
    assert resp.status_code == 200
    rows = client.get("/api/sets").json()
    assert [r["id"] for r in rows] == [b["id"], a["id"]]


# ── Adjacency pins (sets 02) ────────────────────────────────────────────
# The entry's pin describes the adjacency it heads (this entry → the
# next). Pins are explicit, nullable, stable references: a Transition
# uuid, a Take uuid, or nothing (Unresolved). The backend stores what the
# client asserts — it never resolves or validates pin uuids against the
# transitions/takes tables (dangling pins degrade client-side).


def test_pins_round_trip(client, make_track):
    t1, t2, t3 = make_track(), make_track(), make_track()
    s = make_set(client)
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={
            "items": [
                {"track_id": t1.id, "pin_kind": "transition", "pin_uuid": "tr-1"},
                {"track_id": t2.id, "pin_kind": "take", "pin_uuid": "tk-1"},
                {"track_id": t3.id},
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    entries = resp.json()["entries"]
    assert [(e["pin_kind"], e["pin_uuid"]) for e in entries] == [
        ("transition", "tr-1"),
        ("take", "tk-1"),
        (None, None),
    ]

    detail = client.get(f"/api/sets/{s['id']}").json()
    assert [(e["pin_kind"], e["pin_uuid"]) for e in detail["entries"]] == [
        ("transition", "tr-1"),
        ("take", "tk-1"),
        (None, None),
    ]


def test_replace_updates_and_clears_pins(client, make_track):
    t1, t2 = make_track(), make_track()
    s = make_set(client)
    client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [
            {"track_id": t1.id, "pin_kind": "transition", "pin_uuid": "tr-1"},
            {"track_id": t2.id},
        ]},
    )
    # Re-pin to a different Transition, then unpin entirely.
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [
            {"track_id": t1.id, "pin_kind": "transition", "pin_uuid": "tr-2"},
            {"track_id": t2.id},
        ]},
    )
    assert resp.json()["entries"][0]["pin_uuid"] == "tr-2"
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [{"track_id": t1.id}, {"track_id": t2.id}]},
    )
    assert resp.json()["entries"][0]["pin_kind"] is None
    assert resp.json()["entries"][0]["pin_uuid"] is None


def test_pin_kind_requires_uuid_and_vice_versa(client, make_track):
    t1 = make_track()
    s = make_set(client)
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [{"track_id": t1.id, "pin_kind": "transition"}]},
    )
    assert resp.status_code == 422
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [{"track_id": t1.id, "pin_uuid": "tr-1"}]},
    )
    assert resp.status_code == 422


def test_pin_kind_vocabulary(client, make_track):
    t1 = make_track()
    s = make_set(client)
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [{"track_id": t1.id, "pin_kind": "vibes", "pin_uuid": "x"}]},
    )
    assert resp.status_code == 422


# ── Hard-cut pins (sets 26) ─────────────────────────────────────────────
# An explicit "cut here, play no Transition" pin kind: carries no uuid
# (it references nothing), stored and round-tripped like any pin.


def test_hardcut_pin_round_trips_without_uuid(client, make_track):
    t1, t2 = make_track(), make_track()
    s = make_set(client)
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [
            {"track_id": t1.id, "pin_kind": "hardcut"},
            {"track_id": t2.id},
        ]},
    )
    assert resp.status_code == 200, resp.text
    assert (resp.json()["entries"][0]["pin_kind"], resp.json()["entries"][0]["pin_uuid"]) == (
        "hardcut",
        None,
    )
    detail = client.get(f"/api/sets/{s['id']}").json()
    assert (detail["entries"][0]["pin_kind"], detail["entries"][0]["pin_uuid"]) == (
        "hardcut",
        None,
    )


def test_hardcut_pin_rejects_a_uuid(client, make_track):
    t1 = make_track()
    s = make_set(client)
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [{"track_id": t1.id, "pin_kind": "hardcut", "pin_uuid": "x"}]},
    )
    assert resp.status_code == 422


def test_hardcut_dormant_pin_round_trips(client, make_track):
    # Dormancy treats a Hard-cut pin like any pin (sets 26): the memory
    # survives with a NULL uuid.
    t1, t2 = make_track(), make_track()
    s = make_set(client)
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={
            "items": [{"track_id": t1.id}],
            "dormant": [
                {"a_track_id": t1.id, "b_track_id": t2.id, "pin_kind": "hardcut", "pin_uuid": None}
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    dormant = client.get(f"/api/sets/{s['id']}").json()["dormant"]
    assert [(d["pin_kind"], d["pin_uuid"]) for d in dormant] == [("hardcut", None)]


def test_dormant_transition_pin_still_requires_uuid(client, make_track):
    t1, t2 = make_track(), make_track()
    s = make_set(client)
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={
            "items": [{"track_id": t1.id}],
            "dormant": [
                {"a_track_id": t1.id, "b_track_id": t2.id, "pin_kind": "transition", "pin_uuid": None}
            ],
        },
    )
    assert resp.status_code == 422


# ── Dormant pins (sets 07) ──────────────────────────────────────────────
# A Dormant pin is the Set's memory of a pin whose adjacency was broken
# by reorder/removal — per ORDERED pair, per Set, replaced wholesale with
# the entries (dormancy is Set state, client-authoritative like the rest).


def put_state(client: TestClient, set_id: int, items: list[dict], dormant: list[dict]):
    return client.put(
        f"/api/sets/{set_id}/entries", json={"items": items, "dormant": dormant}
    )


def dormant_item(a_id: int, b_id: int, kind: str = "transition", uuid: str = "tr-1") -> dict:
    return {"a_track_id": a_id, "b_track_id": b_id, "pin_kind": kind, "pin_uuid": uuid}


def test_dormant_pins_round_trip(client, make_track):
    t1, t2, t3 = make_track(), make_track(), make_track()
    s = make_set(client)
    resp = put_state(
        client,
        s["id"],
        [{"track_id": t2.id}, {"track_id": t1.id}, {"track_id": t3.id}],
        [
            dormant_item(t1.id, t2.id, "transition", "tr-1"),
            dormant_item(t2.id, t3.id, "take", "tk-1"),
        ],
    )
    assert resp.status_code == 200, resp.text
    assert [(d["a_track_id"], d["b_track_id"], d["pin_kind"], d["pin_uuid"])
            for d in resp.json()["dormant"]] == [
        (t1.id, t2.id, "transition", "tr-1"),
        (t2.id, t3.id, "take", "tk-1"),
    ]

    # Round-trips through GET (persists across reloads).
    detail = client.get(f"/api/sets/{s['id']}").json()
    assert [(d["a_track_id"], d["b_track_id"], d["pin_kind"], d["pin_uuid"])
            for d in detail["dormant"]] == [
        (t1.id, t2.id, "transition", "tr-1"),
        (t2.id, t3.id, "take", "tk-1"),
    ]


def test_dormant_defaults_empty_and_replaces_wholesale(client, make_track):
    t1, t2 = make_track(), make_track()
    s = make_set(client)

    # A dormant-less PUT (and a fresh Set) reads back empty.
    put_entries(client, s["id"], [t1.id, t2.id])
    assert client.get(f"/api/sets/{s['id']}").json()["dormant"] == []

    # Wholesale: the next PUT's dormant list is the whole truth.
    put_state(client, s["id"], [{"track_id": t1.id}, {"track_id": t2.id}],
              [dormant_item(t1.id, t2.id)])
    assert len(client.get(f"/api/sets/{s['id']}").json()["dormant"]) == 1
    put_state(client, s["id"], [{"track_id": t1.id}, {"track_id": t2.id}], [])
    assert client.get(f"/api/sets/{s['id']}").json()["dormant"] == []


def test_dormant_never_leaks_to_other_sets(client, make_track):
    t1, t2 = make_track(), make_track()
    s1, s2 = make_set(client, "One"), make_set(client, "Two")
    put_state(client, s1["id"], [{"track_id": t1.id}, {"track_id": t2.id}],
              [dormant_item(t1.id, t2.id)])
    put_entries(client, s2["id"], [t1.id, t2.id])

    assert len(client.get(f"/api/sets/{s1['id']}").json()["dormant"]) == 1
    assert client.get(f"/api/sets/{s2['id']}").json()["dormant"] == []


def test_dormant_may_reference_tracks_outside_the_set(client, make_track):
    """A removed track's memory survives — its pair may return someday."""
    t1, t2, gone = make_track(), make_track(), make_track()
    s = make_set(client)
    resp = put_state(client, s["id"], [{"track_id": t1.id}, {"track_id": t2.id}],
                     [dormant_item(t1.id, gone.id, "take", "tk-1")])
    assert resp.status_code == 200, resp.text
    assert client.get(f"/api/sets/{s['id']}").json()["dormant"][0]["b_track_id"] == gone.id


def test_dormant_duplicate_pair_400(client, make_track):
    t1, t2 = make_track(), make_track()
    s = make_set(client)
    resp = put_state(client, s["id"], [],
                     [dormant_item(t1.id, t2.id, uuid="tr-1"),
                      dormant_item(t1.id, t2.id, uuid="tr-2")])
    assert resp.status_code == 400


def test_dormant_unknown_track_404(client, make_track):
    t1 = make_track()
    s = make_set(client)
    resp = put_state(client, s["id"], [], [dormant_item(t1.id, 99999)])
    assert resp.status_code == 404


def test_dormant_validation_422(client, make_track):
    t1, t2 = make_track(), make_track()
    s = make_set(client)
    # Unknown kind.
    resp = put_state(client, s["id"], [], [dormant_item(t1.id, t2.id, kind="vibes")])
    assert resp.status_code == 422
    # A memory always carries a pin — no null uuid.
    resp = client.put(
        f"/api/sets/{s['id']}/entries",
        json={"items": [], "dormant": [
            {"a_track_id": t1.id, "b_track_id": t2.id, "pin_kind": "transition"}
        ]},
    )
    assert resp.status_code == 422


def test_delete_set_drops_its_dormant_pins(client, db_session, make_track):
    t1, t2 = make_track(), make_track()
    s = make_set(client)
    put_state(client, s["id"], [{"track_id": t1.id}], [dormant_item(t1.id, t2.id)])
    assert client.delete(f"/api/sets/{s['id']}").status_code == 204
    assert db_session.query(models.SetDormantPin).count() == 0
