"""Router smoke tests: status + shape only (ADR-0002).

The acquisition router is mounted on a fresh FastAPI app so the test import
chain stays clear of the analysis stack.
"""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.acquisition.router import (
    get_soulseek_supplier,
    get_source,
    require_soundcloud_downloads,
    router,
)
from backend.acquisition.source import SourceItemData
from backend.acquisition.supplier import SupplierSearchResult
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

CANNED_RESULT = SupplierSearchResult(
    download_token="tok1",
    filename="@@peer\\Music\\Hoax - Wake Up.flac",
    format="flac",
    bitrate_kbps=None,
    size_bytes=30_000_000,
    duration_ms=274_000,
    queue_length=0,
)


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    """App with the Soulseek Supplier absent (unconfigured)."""
    app = FastAPI()
    app.include_router(router, prefix="/api/acquisition")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_source] = lambda: FakeSource([CANNED_ITEM])
    app.dependency_overrides[require_soundcloud_downloads] = lambda: None
    app.dependency_overrides[get_soulseek_supplier] = lambda: None
    with TestClient(app) as c:
        yield c


@pytest.fixture
def soulseek_client(db_session: Session) -> Iterator[TestClient]:
    """App with a fake Soulseek Supplier configured."""
    app = FastAPI()
    app.include_router(router, prefix="/api/acquisition")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_source] = lambda: FakeSource([CANNED_ITEM])
    app.dependency_overrides[require_soundcloud_downloads] = lambda: None
    app.dependency_overrides[get_soulseek_supplier] = lambda: FakeSource(
        [], search_results=[CANNED_RESULT]
    )
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


def test_suppliers_endpoint_smoke(client: TestClient, soulseek_client: TestClient) -> None:
    """Soulseek is absent when unconfigured, present (kind=search) when
    configured — the frontend hides/shows the picker on this."""
    resp = client.get("/api/acquisition/suppliers")
    assert resp.status_code == 200
    assert all(s["id"] != "soulseek" for s in resp.json())

    resp = soulseek_client.get("/api/acquisition/suppliers")
    assert resp.status_code == 200
    soulseek = [s for s in resp.json() if s["id"] == "soulseek"]
    assert soulseek == [{"id": "soulseek", "kind": "search"}]


def test_soulseek_routes_404_when_unconfigured(client: TestClient) -> None:
    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]

    resp = client.post(f"/api/acquisition/items/{item['id']}/soulseek/search", json={})
    assert resp.status_code == 404

    resp = client.post(
        f"/api/acquisition/items/{item['id']}/soulseek/pick",
        json=CANNED_RESULT.__dict__,
    )
    assert resp.status_code == 404


def test_soulseek_search_endpoint_smoke(soulseek_client: TestClient) -> None:
    soulseek_client.post("/api/acquisition/refresh")
    item = soulseek_client.get("/api/acquisition/items").json()[0]
    # the item list carries the Cleanup-derived picker prefill
    assert item["search_query"] == "Hoax Wake Up"

    # empty query -> the Cleanup-derived default is searched and echoed
    resp = soulseek_client.post(
        f"/api/acquisition/items/{item['id']}/soulseek/search", json={}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["query"] == "Hoax Wake Up"
    assert len(body["results"]) == 1
    assert {
        "download_token", "filename", "format", "bitrate_kbps",
        "size_bytes", "duration_ms", "queue_length", "has_free_slot",
        "duration_delta_ms",
    } <= set(body["results"][0])
    # delta derived server-side against the item's duration (issue 04)
    assert body["results"][0]["duration_delta_ms"] == 274_000 - CANNED_ITEM.duration_ms

    # explicit query is used as-is
    resp = soulseek_client.post(
        f"/api/acquisition/items/{item['id']}/soulseek/search",
        json={"query": "hoax wake up flac"},
    )
    assert resp.status_code == 200
    assert resp.json()["query"] == "hoax wake up flac"


def test_soulseek_remembered_search_endpoint_smoke(soulseek_client: TestClient) -> None:
    """Every search is remembered per item and served back on GET (gh#216)."""
    soulseek_client.post("/api/acquisition/refresh")
    item = soulseek_client.get("/api/acquisition/items").json()[0]

    # never searched -> null
    resp = soulseek_client.get(f"/api/acquisition/items/{item['id']}/soulseek/search")
    assert resp.status_code == 200
    assert resp.json() is None

    searched = soulseek_client.post(
        f"/api/acquisition/items/{item['id']}/soulseek/search",
        json={"query": "hoax wake up"},
    ).json()
    assert searched["searched_at"] is not None

    resp = soulseek_client.get(f"/api/acquisition/items/{item['id']}/soulseek/search")
    assert resp.status_code == 200
    body = resp.json()
    assert body["query"] == "hoax wake up"
    assert body["results"] == searched["results"]
    assert body["searched_at"] == searched["searched_at"]


def test_soulseek_pick_endpoint_smoke(soulseek_client: TestClient) -> None:
    soulseek_client.post("/api/acquisition/refresh")
    item = soulseek_client.get("/api/acquisition/items").json()[0]

    resp = soulseek_client.post(
        f"/api/acquisition/items/{item['id']}/soulseek/pick",
        json=CANNED_RESULT.__dict__,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "queued"
    assert body["download"]["task_state"] == "pending"
    assert body["download"]["via"] == "soulseek"

    # a second pick while one is in flight is a conflict
    resp = soulseek_client.post(
        f"/api/acquisition/items/{item['id']}/soulseek/pick",
        json=CANNED_RESULT.__dict__,
    )
    assert resp.status_code == 409


def make_soulseek_app(db_session: Session, results: list[SupplierSearchResult]) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/acquisition")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_source] = lambda: FakeSource([CANNED_ITEM])
    app.dependency_overrides[require_soundcloud_downloads] = lambda: None
    app.dependency_overrides[get_soulseek_supplier] = lambda: FakeSource(
        [], search_results=results
    )
    return TestClient(app)


def test_soulseek_auto_endpoint_smoke(db_session: Session) -> None:
    """Hands-off download (gh#214): fresh search remembered, mp3 auto-picked,
    multi-candidate task queued."""
    mp3 = SupplierSearchResult(
        download_token="tok-mp3",
        filename="@@peer\\Music\\Hoax - Wake Up.mp3",
        format="mp3",
        bitrate_kbps=320,
        size_bytes=9_000_000,
        duration_ms=274_000,
        queue_length=0,
        username="peer",
    )
    with make_soulseek_app(db_session, [CANNED_RESULT, mp3]) as c:
        c.post("/api/acquisition/refresh")
        item = c.get("/api/acquisition/items").json()[0]

        resp = c.post(f"/api/acquisition/items/{item['id']}/soulseek/auto")
        assert resp.status_code == 200
        body = resp.json()
        assert body["state"] == "queued"
        assert body["download"]["via"] == "soulseek"
        assert body["download"]["attempt"] == 1
        assert body["download"]["attempts_total"] == 1  # the flac is not auto-pickable

        # the fresh search was remembered
        resp = c.get(f"/api/acquisition/items/{item['id']}/soulseek/search")
        assert resp.json() is not None and len(resp.json()["results"]) == 2

        # a second auto while one is in flight is a conflict
        resp = c.post(f"/api/acquisition/items/{item['id']}/soulseek/auto")
        assert resp.status_code == 409


def test_soulseek_auto_endpoint_409_when_nothing_pickable(db_session: Session) -> None:
    # the canned flac fails the mp3-only auto filter
    with make_soulseek_app(db_session, [CANNED_RESULT]) as c:
        c.post("/api/acquisition/refresh")
        item = c.get("/api/acquisition/items").json()[0]
        resp = c.post(f"/api/acquisition/items/{item['id']}/soulseek/auto")
        assert resp.status_code == 409
        assert "pick manually" in resp.json()["detail"]


def test_soulseek_global_search_and_adhoc_download_smoke(db_session: Session) -> None:
    """Standalone search + download (gh#217): no Source Item anywhere."""
    with make_soulseek_app(db_session, [CANNED_RESULT]) as c:
        resp = c.post("/api/acquisition/soulseek/search", json={"query": "hoax wake up"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["query"] == "hoax wake up"
        assert len(body["results"]) == 1
        # no item -> no duration to compare against
        assert body["results"][0]["duration_delta_ms"] is None

        resp = c.post(
            "/api/acquisition/soulseek/download",
            json={"result": body["results"][0], "artist": "Hoax", "title": "Wake Up"},
        )
        assert resp.status_code == 200
        dl = resp.json()
        assert dl["task_state"] == "pending"
        assert dl["artist"] == "Hoax" and dl["title"] == "Wake Up"

        # visible in the downloads list; double-request is a conflict
        listed = c.get("/api/acquisition/soulseek/downloads").json()
        assert [d["task_id"] for d in listed] == [dl["task_id"]]
        resp = c.post(
            "/api/acquisition/soulseek/download", json={"result": body["results"][0]}
        )
        assert resp.status_code == 409


def test_soulseek_global_routes_404_when_unconfigured(client: TestClient) -> None:
    assert (
        client.post("/api/acquisition/soulseek/search", json={"query": "x"}).status_code
        == 404
    )
    assert (
        client.post(
            "/api/acquisition/soulseek/download",
            json={"result": CANNED_RESULT.__dict__},
        ).status_code
        == 404
    )


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


# --- lifecycle on the wire, batch verbs, cancel (gh#342) ---------------------


def test_items_carry_stage_and_cancel_returns_to_new(client: TestClient) -> None:
    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]
    assert item["stage"] == "new"
    assert item["error_kind"] is None
    assert item["candidate_count"] is None

    queued = client.post(f"/api/acquisition/items/{item['id']}/queue").json()
    assert queued["stage"] == "queued"

    resp = client.post(f"/api/acquisition/items/{item['id']}/cancel")
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "new"
    assert body["stage"] == "new"
    assert body["download"] is None  # the pending task row is gone

    resp = client.post(f"/api/acquisition/items/{item['id']}/cancel")
    assert resp.status_code == 409  # nothing queued


def test_failed_download_is_stage_failed_with_error_kind(
    client: TestClient, db_session: Session
) -> None:
    from backend.tasks.models import Task

    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]
    client.post(f"/api/acquisition/items/{item['id']}/queue")
    task = db_session.query(Task).filter(Task.ref == f"source_item:{item['id']}").one()
    task.state = "failed"
    task.error = "ERROR: [soundcloud] 2389765131: This video is DRM protected"
    db_session.commit()

    body = client.get("/api/acquisition/items").json()[0]
    assert body["state"] == "queued"
    assert body["stage"] == "failed"
    assert body["error_kind"] == "drm"

    # a failed download can be cancelled too: it leaves the failed task
    # behind (history) but the item is new again
    resp = client.post(f"/api/acquisition/items/{item['id']}/cancel")
    assert resp.status_code == 200
    assert resp.json()["stage"] == "new"


def test_bulk_ignore_and_accept_endpoints_smoke(client: TestClient, db_session: Session) -> None:
    from backend.acquisition.models import SourceCorrespondence
    from backend.models import Track

    client.post("/api/acquisition/refresh")
    item = client.get("/api/acquisition/items").json()[0]

    resp = client.post("/api/acquisition/items/accept-match-bulk", json={"item_ids": [item["id"]]})
    assert resp.status_code == 200
    assert resp.json() == {"done": 0, "skipped": 1}  # nothing proposed

    track = Track(filename="/tracks/Hoax - Wake Up.mp3", title="Wake Up", artist="Hoax")
    db_session.add(track)
    db_session.commit()
    db_session.add(
        SourceCorrespondence(source_item_id=item["id"], track_id=track.id, status="proposed", score=0.8)
    )
    db_session.commit()
    resp = client.post("/api/acquisition/items/accept-match-bulk", json={"item_ids": [item["id"], 4242]})
    assert resp.json() == {"done": 1, "skipped": 1}
    assert client.get("/api/acquisition/items").json()[0]["stage"] == "fulfilled"

    resp = client.post("/api/acquisition/items/ignore-bulk", json={"item_ids": [item["id"]]})
    assert resp.status_code == 200
    assert resp.json() == {"done": 0, "skipped": 1}  # fulfilled items don't ignore


def test_soulseek_auto_bulk_reports_per_item(db_session: Session) -> None:
    """auto-bulk never aborts the batch: a 409 for one item is a reason."""
    app = FastAPI()
    app.include_router(router, prefix="/api/acquisition")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_source] = lambda: FakeSource([CANNED_ITEM])
    app.dependency_overrides[require_soundcloud_downloads] = lambda: None
    # flac only -> nothing auto-pickable (mp3 required)
    app.dependency_overrides[get_soulseek_supplier] = lambda: FakeSource(
        [], search_results=[CANNED_RESULT]
    )
    with TestClient(app) as c:
        c.post("/api/acquisition/refresh")
        item = c.get("/api/acquisition/items").json()[0]
        resp = c.post("/api/acquisition/items/soulseek/auto-bulk", json={"item_ids": [item["id"], 777]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["started"] == 0
        assert body["skipped"] == 2
        assert set(body["reasons"]) == {str(item["id"]), "777"}
        # the fresh search was remembered along the way
        assert c.get("/api/acquisition/items").json()[0]["candidate_count"] == 1


def test_queue_refused_without_soundcloud(db_session: Session) -> None:
    """No token => no download handler => queueing is a 409, not a stuck task."""
    app = FastAPI()
    app.include_router(router, prefix="/api/acquisition")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_source] = lambda: FakeSource([CANNED_ITEM])
    app.dependency_overrides[get_soulseek_supplier] = lambda: None
    with TestClient(app) as c:
        c.post("/api/acquisition/refresh")
        item = c.get("/api/acquisition/items").json()[0]
        resp = c.post(f"/api/acquisition/items/{item['id']}/queue")
        assert resp.status_code == 409 and "SoundCloud" in resp.json()["detail"]
        assert c.post("/api/acquisition/items/queue-bulk", json={"item_ids": [item["id"]]}).status_code == 409
        assert c.get("/api/acquisition/items").json()[0]["stage"] == "new"
