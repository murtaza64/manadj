"""Transitions router seam (ADR 0011): the pair-replace reconcile matrix.

Real in-memory SQLite via the migration path (conftest), fake nothing —
the router IS the seam under test. Builds a minimal app with just the
transitions router (importing backend.main would pull the analysis stack).
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Transition
from backend.routers import transitions


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(transitions.router, prefix="/api/transitions")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def item(uuid: str, name: str = "Transition 1", favorite: bool = False, **data):
    payload = {"startSec": 30.0, "durationSec": 20.0, "bInSec": 31.2, "lanes": {}}
    payload.update(data)
    return {"uuid": uuid, "name": name, "favorite": favorite, "data": payload}


def put_pair(client: TestClient, a: int, b: int, items: list) -> list:
    resp = client.put(f"/api/transitions/pair/{a}/{b}", json={"items": items})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_insert_and_get(client, make_track):
    a, b = make_track(), make_track()
    rows = put_pair(client, a.id, b.id, [item("u1"), item("u2", name="Transition 2")])
    assert [(r["uuid"], r["position"]) for r in rows] == [("u1", 0), ("u2", 1)]

    listed = client.get("/api/transitions").json()
    assert len(listed) == 2
    assert listed[0]["a_track_id"] == a.id
    assert listed[0]["b_track_id"] == b.id
    assert listed[0]["data"]["bInSec"] == 31.2


def test_re_put_is_idempotent_and_keeps_row_ids(client, make_track, db_session):
    a, b = make_track(), make_track()
    items = [item("u1"), item("u2", name="Transition 2")]
    put_pair(client, a.id, b.id, items)
    ids_before = {t.uuid: t.id for t in db_session.query(Transition).all()}

    put_pair(client, a.id, b.id, items)
    ids_after = {t.uuid: t.id for t in db_session.query(Transition).all()}
    assert ids_after == ids_before


def test_update_in_place_preserves_row_id(client, make_track, db_session):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, [item("u1")])
    row_id = db_session.query(Transition).one().id

    rows = put_pair(
        client, a.id, b.id, [item("u1", name="drop swap", favorite=True, bInSec=-2.0)]
    )
    assert rows[0]["name"] == "drop swap"
    assert rows[0]["favorite"] is True
    assert rows[0]["data"]["bInSec"] == -2.0
    assert db_session.query(Transition).one().id == row_id


def test_delete_absent_uuid_only(client, make_track, db_session):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, [item("u1"), item("u2"), item("u3")])
    u2_id = db_session.query(Transition).filter_by(uuid="u2").one().id

    rows = put_pair(client, a.id, b.id, [item("u2"), item("u3")])
    assert [r["uuid"] for r in rows] == ["u2", "u3"]
    assert [r["position"] for r in rows] == [0, 1]  # position renumbers…
    assert db_session.query(Transition).filter_by(uuid="u2").one().id == u2_id  # …identity doesn't


def test_empty_items_deletes_pair(client, make_track, db_session):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, [item("u1")])
    rows = put_pair(client, a.id, b.id, [])
    assert rows == []
    assert db_session.query(Transition).count() == 0


def test_pairs_are_directional_and_isolated(client, make_track):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, [item("u1")])
    put_pair(client, b.id, a.id, [item("u1", name="reverse")])  # same uuid, other direction

    listed = client.get("/api/transitions").json()
    assert len(listed) == 2

    put_pair(client, a.id, b.id, [])  # clearing A→B leaves B→A alone
    listed = client.get("/api/transitions").json()
    assert [(r["a_track_id"], r["b_track_id"]) for r in listed] == [(b.id, a.id)]


def test_unknown_track_404(client, make_track):
    a = make_track()
    resp = client.put(f"/api/transitions/pair/{a.id}/99999", json={"items": []})
    assert resp.status_code == 404


def test_duplicate_uuid_in_payload_400(client, make_track):
    a, b = make_track(), make_track()
    resp = client.put(
        f"/api/transitions/pair/{a.id}/{b.id}",
        json={"items": [item("u1"), item("u1")]},
    )
    assert resp.status_code == 400


def test_track_delete_cascades_transitions(client, make_track, db_session):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, [item("u1")])
    put_pair(client, b.id, a.id, [item("u2")])

    # No track-delete feature exists yet; exercise the ORM cascade directly
    # (ADR 0011: revisit when soft-delete lands).
    db_session.delete(db_session.merge(a))
    db_session.commit()
    assert db_session.query(Transition).count() == 0
