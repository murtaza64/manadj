"""Tags router: Tag Category create/delete (ADR-0002: real in-memory SQLite)."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import models
from backend.database import get_db
from backend.routers.tags import router


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(router, prefix="/api/tags")
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c


def test_create_category_trims_and_rejects_duplicates(client) -> None:
    resp = client.post("/api/tags/categories", json={"name": "  Mood ", "display_order": 3})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Mood"
    assert resp.json()["display_order"] == 3

    assert client.post("/api/tags/categories", json={"name": "mood"}).status_code == 409
    assert client.post("/api/tags/categories", json={"name": "   "}).status_code == 422


def test_delete_category_cascades_tags_and_track_tags(client, db_session, make_track) -> None:
    keep = client.post("/api/tags/categories", json={"name": "Keep"}).json()
    gone = client.post("/api/tags/categories", json={"name": "Gone"}).json()
    kept_tag = client.post("/api/tags/", json={"name": "k", "category_id": keep["id"]}).json()
    gone_tag = client.post("/api/tags/", json={"name": "g", "category_id": gone["id"]}).json()
    track = make_track()
    db_session.add_all([
        models.TrackTag(track_id=track.id, tag_id=kept_tag["id"]),
        models.TrackTag(track_id=track.id, tag_id=gone_tag["id"]),
    ])
    db_session.commit()

    assert client.delete(f"/api/tags/categories/{gone['id']}").status_code == 204

    assert [c["name"] for c in client.get("/api/tags/categories").json()] == ["Keep"]
    assert [t["id"] for t in client.get("/api/tags/").json()] == [kept_tag["id"]]
    assert [tt.tag_id for tt in db_session.query(models.TrackTag).all()] == [kept_tag["id"]]


def test_delete_missing_category_404(client) -> None:
    assert client.delete("/api/tags/categories/999").status_code == 404
