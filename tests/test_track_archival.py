"""Track archival tests (ADR-0002: real in-memory SQLite, no mocks).

Archived (CONTEXT.md): a curation verdict — out of the active Library.
Covers: archive/unarchive round-trip, playlist removal + compaction,
exclusion from default listing/search/unprocessed, the Archived listing,
and non-restoration of playlist membership.
"""

from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import crud
from backend.database import get_db
from backend.routers.playlists import router as playlists_router
from backend.routers.tracks import router as tracks_router


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(tracks_router, prefix="/api/tracks")
    app.include_router(playlists_router, prefix="/api/playlists")
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c


def _playlist_track_ids(client: TestClient, playlist_id: int) -> list[int]:
    return [t["id"] for t in client.get(f"/api/playlists/{playlist_id}").json()["tracks"]]


def _listed_ids(client: TestClient, **params) -> list[int]:
    resp = client.get("/api/tracks/", params=params)
    assert resp.status_code == 200
    return [t["id"] for t in resp.json()["items"]]


def test_archive_unarchive_roundtrip(client, make_track) -> None:
    t = make_track()
    resp = client.post(f"/api/tracks/{t.id}/archive")
    assert resp.status_code == 200
    body = resp.json()
    assert body["archived_at"] is not None
    assert body["removed_from_playlists"] == 0

    assert _listed_ids(client) == []
    assert _listed_ids(client, archived=True) == [t.id]

    resp = client.post(f"/api/tracks/{t.id}/unarchive")
    assert resp.status_code == 200
    assert resp.json()["archived_at"] is None
    assert _listed_ids(client) == [t.id]
    assert _listed_ids(client, archived=True) == []


def test_archive_missing_track_404s(client) -> None:
    assert client.post("/api/tracks/999/archive").status_code == 404
    assert client.post("/api/tracks/999/unarchive").status_code == 404


def test_archive_is_idempotent(client, make_track) -> None:
    t = make_track()
    first = client.post(f"/api/tracks/{t.id}/archive").json()["archived_at"]
    second = client.post(f"/api/tracks/{t.id}/archive")
    assert second.status_code == 200
    assert second.json()["archived_at"] == first


def test_archive_removes_from_all_playlists_and_compacts(client, make_track) -> None:
    t1, t2, t3 = make_track(), make_track(), make_track()
    pl_a = client.post("/api/playlists/", json={"name": "A"}).json()["id"]
    pl_b = client.post("/api/playlists/", json={"name": "B"}).json()["id"]
    for pl in (pl_a, pl_b):
        for t in (t1, t2, t3):
            client.post(f"/api/playlists/{pl}/tracks", json={"track_id": t.id})

    resp = client.post(f"/api/tracks/{t2.id}/archive")
    assert resp.json()["removed_from_playlists"] == 2

    for pl in (pl_a, pl_b):
        assert _playlist_track_ids(client, pl) == [t1.id, t3.id]
        # positions compacted: positioned insert lands between the survivors
        t4 = make_track()
        client.post(f"/api/playlists/{pl}/tracks", json={"track_id": t4.id, "position": 1})
        assert _playlist_track_ids(client, pl) == [t1.id, t4.id, t3.id]
        client.delete(f"/api/playlists/{pl}/tracks/{t4.id}")


def test_unarchive_does_not_restore_playlist_membership(client, make_track) -> None:
    t = make_track()
    pl = client.post("/api/playlists/", json={"name": "Set"}).json()["id"]
    client.post(f"/api/playlists/{pl}/tracks", json={"track_id": t.id})

    client.post(f"/api/tracks/{t.id}/archive")
    client.post(f"/api/tracks/{t.id}/unarchive")
    assert _playlist_track_ids(client, pl) == []
    assert _listed_ids(client) == [t.id]


def test_track_playlists_endpoint(client, make_track) -> None:
    t = make_track()
    pl_a = client.post("/api/playlists/", json={"name": "A"}).json()["id"]
    client.post("/api/playlists/", json={"name": "B"})
    client.post(f"/api/playlists/{pl_a}/tracks", json={"track_id": t.id})

    resp = client.get(f"/api/tracks/{t.id}/playlists")
    assert resp.status_code == 200
    assert [p["name"] for p in resp.json()] == ["A"]


def test_archived_excluded_from_search_and_unprocessed(db_session, make_track) -> None:
    """Module-interface check on the single listing chokepoint."""
    active = make_track(title="Wake Up")
    archived = make_track(title="Wake Up Too", archived_at=datetime.now())

    items, total, library_total = crud.get_tracks(db_session, search="wake up")
    assert [t.id for t in items] == [active.id]

    # both tracks are unprocessed (no tags/energy); archived stays out
    items, _, _ = crud.get_tracks(db_session, unprocessed=True)
    assert [t.id for t in items] == [active.id]

    # the archived listing ignores curation filters' default exclusion
    items, _, _ = crud.get_tracks(db_session, archived=True)
    assert [t.id for t in items] == [archived.id]

    # library_total counts the ACTIVE library only
    assert library_total == 1


def test_scan_does_not_repropose_archived_file(db_session, make_track, audio_file, tmp_path) -> None:
    """An archived Track's file resolves as already-in-db at Scan time."""
    from backend.library.import_manager import LibraryImportManager

    known = audio_file(name="known.mp3")
    make_track(filename=str(known), archived_at=datetime.now())
    audio_file(name="new.mp3")

    manager = LibraryImportManager(db_session, library_path=str(tmp_path))
    result = manager.get_import_candidates()
    names = [c.filename for c in result.candidates]
    assert any("new.mp3" in n for n in names)
    assert not any("known.mp3" in n for n in names)
