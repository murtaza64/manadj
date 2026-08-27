"""Cameos router seam (cameos PRD, #140): CRUD via pair-replace + Set
Cameo-pin degradation.

Real in-memory SQLite via the migration path (conftest), fake nothing —
the transitions router test pattern, mirrored for the Cameo sibling. The
write model is client-authoritative: one PUT replaces the whole ordered
(host, guest) pair's Cameo set, reconciled by uuid.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import cameos, sets


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(cameos.router, prefix="/api/cameos")
    app.include_router(sets.router, prefix="/api/sets")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def item(uuid: str, name: str = "tease", **over):
    payload = {
        "uuid": uuid,
        "name": name,
        "favorite": False,
        "data": {"entryHostSec": 120.0, "exitHostSec": 150.0, "guestStartSec": 60.0},
    }
    payload.update(over)
    return payload


def put_pair(client: TestClient, host: int, guest: int, items: list[dict]):
    return client.put(f"/api/cameos/pair/{host}/{guest}", json={"items": items})


def test_replace_pair_creates_and_lists(client, make_track):
    host, guest = make_track(), make_track()
    resp = put_pair(client, host.id, guest.id, [item("c1"), item("c2", "double")])
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert [r["uuid"] for r in rows] == ["c1", "c2"]
    assert [r["position"] for r in rows] == [0, 1]
    assert rows[0]["host_track_id"] == host.id
    assert rows[0]["guest_track_id"] == guest.id
    assert rows[0]["data"]["entryHostSec"] == 120.0

    listed = client.get("/api/cameos").json()
    assert [r["uuid"] for r in listed] == ["c1", "c2"]


def test_replace_updates_and_deletes(client, make_track):
    host, guest = make_track(), make_track()
    put_pair(client, host.id, guest.id, [item("c1"), item("c2")])
    resp = put_pair(
        client, host.id, guest.id, [item("c2", "renamed", favorite=True)]
    )
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["uuid"] == "c2"
    assert rows[0]["name"] == "renamed"
    assert rows[0]["favorite"] is True
    assert rows[0]["position"] == 0


def test_empty_items_deletes_pair(client, make_track):
    host, guest = make_track(), make_track()
    put_pair(client, host.id, guest.id, [item("c1")])
    resp = put_pair(client, host.id, guest.id, [])
    assert resp.status_code == 200
    assert resp.json() == []
    assert client.get("/api/cameos").json() == []


def test_self_cameo_is_legal(client, make_track):
    t = make_track()
    resp = put_pair(client, t.id, t.id, [item("self1")])
    assert resp.status_code == 200, resp.text
    row = resp.json()[0]
    assert row["host_track_id"] == row["guest_track_id"] == t.id


def test_pair_is_ordered_and_directional(client, make_track):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, [item("ab")])
    put_pair(client, b.id, a.id, [item("ba")])
    rows = client.get("/api/cameos").json()
    assert len(rows) == 2  # host→guest is directional; no collision


def test_duplicate_uuid_400(client, make_track):
    host, guest = make_track(), make_track()
    resp = put_pair(client, host.id, guest.id, [item("c1"), item("c1")])
    assert resp.status_code == 400


def test_unknown_track_404(client, make_track):
    t = make_track()
    resp = put_pair(client, t.id, 99999, [item("c1")])
    assert resp.status_code == 404


def test_deleting_cameo_drops_set_pins(client, make_track):
    """Ornament pins have no Unresolved: deleting the Cameo drops the pin
    rows outright, active and dormant alike (#140)."""
    host, guest, other = make_track(), make_track(), make_track()
    put_pair(client, host.id, guest.id, [item("c1"), item("keep")])

    set_id = client.post("/api/sets", json={"name": "s"}).json()["id"]
    resp = client.put(
        f"/api/sets/{set_id}/entries",
        json={
            "items": [
                {
                    "track_id": host.id,
                    "cameo_pins": [
                        {"pin_kind": "cameo", "pin_uuid": "c1"},
                        {"pin_kind": "cameo", "pin_uuid": "keep"},
                    ],
                },
                {"track_id": other.id},
            ],
            "dormant_cameos": [
                {"host_track_id": guest.id, "pin_kind": "cameo", "pin_uuid": "c1"}
            ],
        },
    )
    assert resp.status_code == 200, resp.text

    # Deleting c1 from the library (absent from the PUT) drops both pins.
    put_pair(client, host.id, guest.id, [item("keep")])
    detail = client.get(f"/api/sets/{set_id}").json()
    entry = next(e for e in detail["entries"] if e["track_id"] == host.id)
    assert entry["cameo_pins"] == [{"pin_kind": "cameo", "pin_uuid": "keep"}]
    assert detail["dormant_cameos"] == []
