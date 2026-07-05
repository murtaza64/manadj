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
