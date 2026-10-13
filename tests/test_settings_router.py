"""Settings router (settings, #176): key -> raw preference string.

Real in-memory SQLite via the migration path (conftest), same minimal-app
pattern as the takes router tests. Covers upsert, delete, and the
seed-only-when-empty guard (a sandbox clone's empty localStorage must
never clobber the real app's rows).
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers import settings


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(settings.router, prefix="/api/settings")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def test_empty_then_put_then_get(client):
    assert client.get("/api/settings").json() == {"settings": {}}

    resp = client.put(
        "/api/settings/manadj.waveformStyles", json={"value": '{"version":1}'}
    )
    assert resp.status_code == 200

    rows = client.get("/api/settings").json()["settings"]
    assert rows == {"manadj.waveformStyles": '{"version":1}'}


def test_put_upserts(client):
    client.put("/api/settings/manadj-quantize", json={"value": "true"})
    client.put("/api/settings/manadj-quantize", json={"value": "false"})
    rows = client.get("/api/settings").json()["settings"]
    assert rows == {"manadj-quantize": "false"}


def test_delete(client):
    client.put("/api/settings/manadj-keylock", json={"value": "{}"})
    assert client.delete("/api/settings/manadj-keylock").status_code == 204
    assert client.get("/api/settings").json() == {"settings": {}}
    # Deleting a missing key is fine (reset paths race with fresh DBs).
    assert client.delete("/api/settings/manadj-keylock").status_code == 204


def test_seed_only_when_empty(client):
    resp = client.post(
        "/api/settings/seed",
        json={"settings": {"manadj-quantize": "false", "trackListSort": "{}"}},
    )
    assert resp.json() == {"seeded": True}
    assert len(client.get("/api/settings").json()["settings"]) == 2

    # Second seed (e.g. a fresh clone's origin) is a no-op.
    resp = client.post(
        "/api/settings/seed", json={"settings": {"manadj-quantize": "true"}}
    )
    assert resp.json() == {"seeded": False}
    rows = client.get("/api/settings").json()["settings"]
    assert rows["manadj-quantize"] == "false"


def test_dotted_and_prefixed_keys_roundtrip(client):
    # Keys contain dots and colons (manadj.waveformStyles,
    # manadj-visualizer-params:<preset>) — path encoding must round-trip.
    key = "manadj-visualizer-params:neon-tunnel"
    client.put(f"/api/settings/{key}", json={"value": '{"speed":2}'})
    rows = client.get("/api/settings").json()["settings"]
    assert rows == {key: '{"speed":2}'}
