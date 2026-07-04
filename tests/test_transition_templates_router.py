"""Transition-templates router seam (mix-editor issue 03): plain CRUD.

Templates are global library artifacts (no pair scoping), saved by explicit
user acts — so unlike Transitions' client-authoritative pair-replace
(ADR 0011), this API is per-row CRUD keyed by the client-generated uuid.
Real in-memory SQLite via the migration path (conftest); the router IS the
seam under test.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import TransitionTemplate
from backend.routers import transition_templates


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(transition_templates.router, prefix="/api/transition-templates")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def template(uuid: str = "t1", name: str = "bass swap", **overrides) -> dict:
    payload = {
        "uuid": uuid,
        "name": name,
        "align_a_base": "cue_4",
        "align_a_delta_beats": 32,
        "align_b_base": "cue_4",
        "align_b_delta_beats": -32,
        "length_beats": 64,
        "scalable": True,
        "lanes": {"eqLowA": [{"x": 0, "y": 0.5}, {"x": 0.5, "y": 0}]},
    }
    payload.update(overrides)
    return payload


def test_create_and_list(client):
    resp = client.post("/api/transition-templates", json=template())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["uuid"] == "t1"
    assert body["align_b_delta_beats"] == -32
    assert body["lanes"]["eqLowA"][1]["y"] == 0

    listed = client.get("/api/transition-templates").json()
    assert [t["uuid"] for t in listed] == ["t1"]


def test_list_orders_by_creation(client):
    client.post("/api/transition-templates", json=template("t1", name="bass swap"))
    client.post("/api/transition-templates", json=template("t2", name="drop cut"))
    listed = client.get("/api/transition-templates").json()
    assert [t["uuid"] for t in listed] == ["t1", "t2"]


def test_duplicate_uuid_conflicts(client):
    client.post("/api/transition-templates", json=template("t1"))
    resp = client.post("/api/transition-templates", json=template("t1", name="other"))
    assert resp.status_code == 409


def test_duplicate_names_allowed(client):
    assert client.post("/api/transition-templates", json=template("t1")).status_code == 201
    assert client.post("/api/transition-templates", json=template("t2")).status_code == 201


def test_update(client, db_session):
    client.post("/api/transition-templates", json=template("t1"))
    row_id = db_session.query(TransitionTemplate).one().id

    resp = client.put(
        "/api/transition-templates/t1",
        json=template("t1", name="renamed", length_beats=32, scalable=False),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "renamed"
    assert resp.json()["length_beats"] == 32
    assert resp.json()["scalable"] is False
    # Same row updated in place.
    assert db_session.query(TransitionTemplate).one().id == row_id


def test_update_missing_404(client):
    resp = client.put("/api/transition-templates/nope", json=template("nope"))
    assert resp.status_code == 404


def test_update_uuid_mismatch_400(client):
    client.post("/api/transition-templates", json=template("t1"))
    resp = client.put("/api/transition-templates/t1", json=template("other"))
    assert resp.status_code == 400


def test_delete(client, db_session):
    client.post("/api/transition-templates", json=template("t1"))
    resp = client.delete("/api/transition-templates/t1")
    assert resp.status_code == 204
    assert db_session.query(TransitionTemplate).count() == 0


def test_delete_missing_404(client):
    assert client.delete("/api/transition-templates/nope").status_code == 404


@pytest.mark.parametrize("base", ["cue_0", "cue_9", "drop", ""])
def test_invalid_anchor_base_rejected(client, base):
    resp = client.post("/api/transition-templates", json=template(align_a_base=base))
    assert resp.status_code == 422


@pytest.mark.parametrize("base", ["cue_1", "cue_8", "grid_origin"])
def test_valid_anchor_bases_accepted(client, base):
    resp = client.post(
        "/api/transition-templates", json=template(align_a_base=base, align_b_base=base)
    )
    assert resp.status_code == 201
