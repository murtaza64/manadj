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


def test_match_endpoints_smoke(client: TestClient, db_session: Session) -> None:
    """Proposal accept/reject and manual link endpoints: status + shape only."""
    from backend.models import Track

    track = Track(filename="/tracks/Hoax - Wake Up.mp3", title="Wake Up", artist="Hoax")
    db_session.add(track)
    db_session.commit()

    client.post("/api/acquisition/refresh")
    items = client.get("/api/acquisition/items").json()
    item = items[0]
    assert "correspondence" in item

    resp = client.post(f"/api/acquisition/items/{item['id']}/link", json={"track_id": track.id})
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "fulfilled"
    assert body["correspondence"]["track_id"] == track.id
    assert body["correspondence"]["status"] == "confirmed"

    resp = client.post(f"/api/acquisition/items/{item['id']}/accept-match")
    assert resp.status_code == 404  # nothing proposed

    resp = client.post(
        "/api/acquisition/link-by-url",
        json={"url": "https://soundcloud.com/nobody/nothing", "track_id": track.id},
    )
    assert resp.status_code == 404


def test_queue_endpoint_smoke(client: TestClient) -> None:
    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]

    resp = client.post(f"/api/acquisition/items/{item['id']}/queue")
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "queued"
    assert body["download"]["task_state"] == "pending"

    # queueing a fulfilled/ignored item is a conflict
    client.patch(f"/api/acquisition/items/{item['id']}/classification", json={"classification": "other"})
    resp = client.post(f"/api/acquisition/items/{item['id']}/queue")
    assert resp.status_code == 200  # still queued -> idempotent


def test_bulk_ignore_restore_endpoints_smoke(client: TestClient) -> None:
    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]

    resp = client.post("/api/acquisition/items/queue-bulk", json={"item_ids": [item["id"], 99999]})
    assert resp.status_code == 200
    assert resp.json() == {"queued": 1, "skipped": 1}

    # queued with a live (pending) task -> cannot ignore
    resp = client.post(f"/api/acquisition/items/{item['id']}/ignore")
    assert resp.status_code == 409

    resp = client.post(f"/api/acquisition/items/{item['id']}/restore")
    assert resp.status_code == 409


def test_link_with_audio_from_smoke(client: TestClient, db_session: Session) -> None:
    from backend.models import Track

    track = Track(filename="/tracks/x.mp3", title="X", artist="Y")
    db_session.add(track)
    db_session.commit()
    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]

    resp = client.post(
        f"/api/acquisition/items/{item['id']}/link",
        json={"track_id": track.id, "audio_from": "https://www.beatport.com/track/x/1"},
    )
    assert resp.status_code == 200
    prov = resp.json()["provenance"]
    assert prov["label"] == "beatport"
    assert prov["asserted"] is True
    assert prov["acquired_at"] is not None


def test_set_provenance_endpoint_smoke(client: TestClient, db_session: Session) -> None:
    from backend.models import Track

    track = Track(filename="/tracks/y.mp3", title="Y", artist="Z")
    db_session.add(track)
    db_session.commit()
    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]

    # not fulfilled yet -> 404
    resp = client.post(f"/api/acquisition/items/{item['id']}/provenance", json={"audio_from": "cd-rip"})
    assert resp.status_code == 404

    client.post(f"/api/acquisition/items/{item['id']}/link", json={"track_id": track.id})
    resp = client.post(f"/api/acquisition/items/{item['id']}/provenance", json={"audio_from": "cd-rip"})
    assert resp.status_code == 200
    assert resp.json()["provenance"]["label"] == "cd-rip"
