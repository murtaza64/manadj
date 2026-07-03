"""Smoke test for GET /api/sync/status (status + shape only, ADR-0002)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.routers import sync_status as sync_status_router
from backend.sync_status import adapters


@pytest.fixture()
def client(db, monkeypatch):
    # No external Surfaces in tests (ADR-0004): the endpoint must degrade
    # gracefully to library-only rows.
    monkeypatch.setattr(adapters, "build_surfaces", dict)
    monkeypatch.setattr(sync_status_router, "build_surfaces", dict)
    app = FastAPI()
    app.include_router(sync_status_router.router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_status_shape(client, make_track):
    make_track(title="Solo")
    resp = client.get("/api/sync/status/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["surfaces_available"] == []
    row = body["rows"][0]
    assert row["title"] == "Solo"
    assert row["presence"]["library"] is True
    assert row["presence"]["engine"] is False
    # no surfaces available -> unknown is not missing (in-sync rollup)
    assert row["status"] == "in-sync"
    assert body["counts"]["in-sync"] == 1
    assert row["unprocessed"] is True
