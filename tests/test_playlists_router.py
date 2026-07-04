"""Playlists router tests (ADR-0002: real in-memory SQLite, no mocks).

Covers the playlist entry-identity contract: an entry is identified by
(playlist, track) — duplicate adds are idempotent no-ops, remove/reorder
key on track_id, and reorders must be a full permutation of the playlist.
"""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.routers.playlists import router


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(router, prefix="/api/playlists")
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c


@pytest.fixture
def playlist_id(client: TestClient) -> int:
    resp = client.post("/api/playlists/", json={"name": "Set A"})
    assert resp.status_code == 201
    return resp.json()["id"]


def _track_ids_in_order(client: TestClient, playlist_id: int) -> list[int]:
    resp = client.get(f"/api/playlists/{playlist_id}")
    assert resp.status_code == 200
    return [t["id"] for t in resp.json()["tracks"]]


def _add(client: TestClient, playlist_id: int, track_id: int, position: int | None = None):
    body: dict = {"track_id": track_id}
    if position is not None:
        body["position"] = position
    return client.post(f"/api/playlists/{playlist_id}/tracks", json=body)


def test_add_appends_and_returns_playlist(client, playlist_id, make_track) -> None:
    t1, t2 = make_track(), make_track()
    resp = _add(client, playlist_id, t1.id)
    assert resp.status_code == 200
    body = resp.json()
    assert body["skipped"] is False
    assert [t["id"] for t in body["playlist"]["tracks"]] == [t1.id]

    _add(client, playlist_id, t2.id)
    assert _track_ids_in_order(client, playlist_id) == [t1.id, t2.id]


def test_add_at_position_shifts_rest(client, playlist_id, make_track) -> None:
    t1, t2, t3 = make_track(), make_track(), make_track()
    _add(client, playlist_id, t1.id)
    _add(client, playlist_id, t2.id)
    resp = _add(client, playlist_id, t3.id, position=1)
    assert resp.status_code == 200
    assert _track_ids_in_order(client, playlist_id) == [t1.id, t3.id, t2.id]


def test_duplicate_add_is_noop_with_skipped_indicator(client, playlist_id, make_track) -> None:
    t1 = make_track()
    _add(client, playlist_id, t1.id)
    resp = _add(client, playlist_id, t1.id)
    assert resp.status_code == 200
    body = resp.json()
    assert body["skipped"] is True
    assert [t["id"] for t in body["playlist"]["tracks"]] == [t1.id]

    # positioned duplicate is also a no-op — no shifting happened
    t2 = make_track()
    _add(client, playlist_id, t2.id)
    resp = _add(client, playlist_id, t1.id, position=1)
    assert resp.json()["skipped"] is True
    assert _track_ids_in_order(client, playlist_id) == [t1.id, t2.id]


def test_remove_keys_on_track_id_and_compacts(client, playlist_id, make_track) -> None:
    t1, t2, t3 = make_track(), make_track(), make_track()
    for t in (t1, t2, t3):
        _add(client, playlist_id, t.id)

    resp = client.delete(f"/api/playlists/{playlist_id}/tracks/{t2.id}")
    assert resp.status_code == 200
    assert _track_ids_in_order(client, playlist_id) == [t1.id, t3.id]

    # positions compacted: re-adding at position 1 lands between the two
    t4 = make_track()
    _add(client, playlist_id, t4.id, position=1)
    assert _track_ids_in_order(client, playlist_id) == [t1.id, t4.id, t3.id]


def test_remove_absent_track_404s(client, playlist_id, make_track) -> None:
    t1 = make_track()
    resp = client.delete(f"/api/playlists/{playlist_id}/tracks/{t1.id}")
    assert resp.status_code == 404


def test_reorder_full_permutation(client, playlist_id, make_track) -> None:
    t1, t2, t3 = make_track(), make_track(), make_track()
    for t in (t1, t2, t3):
        _add(client, playlist_id, t.id)

    resp = client.post(
        f"/api/playlists/{playlist_id}/reorder-tracks",
        json={
            "track_positions": [
                {"track_id": t3.id, "position": 0},
                {"track_id": t1.id, "position": 1},
                {"track_id": t2.id, "position": 2},
            ]
        },
    )
    assert resp.status_code == 200
    assert _track_ids_in_order(client, playlist_id) == [t3.id, t1.id, t2.id]


def test_reorder_rejects_partial_or_invalid_payloads(client, playlist_id, make_track) -> None:
    t1, t2 = make_track(), make_track()
    _add(client, playlist_id, t1.id)
    _add(client, playlist_id, t2.id)

    # missing a track
    resp = client.post(
        f"/api/playlists/{playlist_id}/reorder-tracks",
        json={"track_positions": [{"track_id": t1.id, "position": 0}]},
    )
    assert resp.status_code == 400

    # positions not 0..n-1
    resp = client.post(
        f"/api/playlists/{playlist_id}/reorder-tracks",
        json={
            "track_positions": [
                {"track_id": t1.id, "position": 0},
                {"track_id": t2.id, "position": 5},
            ]
        },
    )
    assert resp.status_code == 400

    # foreign track
    t3 = make_track()
    resp = client.post(
        f"/api/playlists/{playlist_id}/reorder-tracks",
        json={
            "track_positions": [
                {"track_id": t1.id, "position": 0},
                {"track_id": t3.id, "position": 1},
            ]
        },
    )
    assert resp.status_code == 400

    # untyped garbage
    resp = client.post(
        f"/api/playlists/{playlist_id}/reorder-tracks",
        json={"track_positions": [{"id": 1, "position": 0}]},
    )
    assert resp.status_code == 422

    # order unchanged throughout
    assert _track_ids_in_order(client, playlist_id) == [t1.id, t2.id]


def test_schema_forbids_duplicate_entries(db_session: Session, playlist_id, make_track) -> None:
    """The unique constraint holds even below the API."""
    from sqlalchemy.exc import IntegrityError

    from backend.models import PlaylistTrack

    t1 = make_track()
    db_session.add(PlaylistTrack(playlist_id=playlist_id, track_id=t1.id, position=0))
    db_session.commit()
    db_session.add(PlaylistTrack(playlist_id=playlist_id, track_id=t1.id, position=1))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_reorder_playlists_typed(client) -> None:
    ids = [
        client.post("/api/playlists/", json={"name": n}).json()["id"]
        for n in ("A", "B", "C")
    ]
    resp = client.post(
        "/api/playlists/reorder",
        json=[
            {"id": ids[2], "display_order": 0},
            {"id": ids[0], "display_order": 1},
            {"id": ids[1], "display_order": 2},
        ],
    )
    assert resp.status_code == 200
    listing = client.get("/api/playlists/").json()
    assert [p["id"] for p in listing] == [ids[2], ids[0], ids[1]]

    resp = client.post("/api/playlists/reorder", json=[{"nope": 1}])
    assert resp.status_code == 422
