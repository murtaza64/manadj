"""Router smoke tests: status + shape only (ADR-0002).

The acquisition router is mounted on a fresh FastAPI app so the test import
chain stays clear of the analysis stack.
"""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.acquisition.router import get_source, router
from backend.acquisition.source import SourceItemData
from backend.database import get_db

from .conftest import FakeSource

CANNED_ITEM = SourceItemData(
    external_id="111",
    title="Hoax - Wake Up",
    uploader="hoaxdnb",
    duration_ms=274431,
    permalink_url="https://soundcloud.com/hoaxdnb/wake-up",
    liked_at="2026-07-02T22:20:00Z",
)


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(router, prefix="/api/acquisition")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_source] = lambda: FakeSource([CANNED_ITEM])
    with TestClient(app) as c:
        yield c


def test_refresh_endpoint_smoke(client: TestClient) -> None:
    resp = client.post("/api/acquisition/refresh")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"added", "total_remote", "total_local"}


def test_list_items_endpoint_smoke(client: TestClient) -> None:
    client.post("/api/acquisition/refresh")
    resp = client.get("/api/acquisition/items")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert {"id", "external_id", "title", "uploader", "duration_ms", "permalink_url", "state", "classification", "liked_at"} <= set(items[0])


def test_override_classification_endpoint_smoke(client: TestClient) -> None:
    client.post("/api/acquisition/refresh")
    item_id = client.get("/api/acquisition/items").json()[0]["id"]

    resp = client.patch(f"/api/acquisition/items/{item_id}/classification", json={"classification": "mix"})
    assert resp.status_code == 200
    assert resp.json()["classification"] == "mix"

    resp = client.patch(f"/api/acquisition/items/{item_id}/classification", json={"classification": "banger"})
    assert resp.status_code == 422
