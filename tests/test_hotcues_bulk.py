"""Bulk hot-cues endpoint at the router seam (sets issue 43).

A set open fetches every entry's cues in one request instead of N — the
endpoint returns a map keyed by track id with EVERY asked id present
(empty list = no cues), and must not shadow the per-track route.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import crud
from backend.database import get_db
from backend.routers import hotcues


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(hotcues.router, prefix="/api/hotcues")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def test_bulk_returns_cues_keyed_by_track(client: TestClient, db_session, make_track):
    a = make_track()
    b = make_track()
    no_cues = make_track()
    crud.set_hotcue(db_session, track_id=a.id, slot_number=1, time_seconds=10.0, label=None, color=None)
    crud.set_hotcue(db_session, track_id=a.id, slot_number=3, time_seconds=30.0, label=None, color=None)
    crud.set_hotcue(db_session, track_id=b.id, slot_number=2, time_seconds=20.0, label=None, color=None)

    resp = client.get(f"/api/hotcues/bulk?track_ids={a.id},{b.id},{no_cues.id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Every asked id is present — "no cues" is distinguishable from "not asked".
    assert set(data.keys()) == {str(a.id), str(b.id), str(no_cues.id)}
    assert [c["slot_number"] for c in data[str(a.id)]] == [1, 3]
    assert [c["time_seconds"] for c in data[str(b.id)]] == [20.0]
    assert data[str(no_cues.id)] == []


def test_bulk_rejects_non_integer_ids(client: TestClient):
    resp = client.get("/api/hotcues/bulk?track_ids=1,nope")
    assert resp.status_code == 400


def test_bulk_does_not_shadow_per_track_route(client: TestClient, db_session, make_track):
    t = make_track()
    crud.set_hotcue(db_session, track_id=t.id, slot_number=1, time_seconds=5.0, label=None, color=None)
    resp = client.get(f"/api/hotcues/{t.id}")
    assert resp.status_code == 200
    assert [c["slot_number"] for c in resp.json()] == [1]
