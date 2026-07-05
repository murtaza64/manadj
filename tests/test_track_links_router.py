"""Track-links router seam (linked-pairs PRD, issue 01).

Linked is a stored, symmetric assertion on an unordered pair of distinct
Tracks. The router normalizes pair order (low < high), so PUT a/b and
PUT b/a address the same fact. Real in-memory SQLite via the migration
path (conftest), fake nothing — the router IS the seam under test.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import TrackLink
from backend.routers import track_links


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(track_links.router, prefix="/api/track-links")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def put_pair(client: TestClient, a: int, b: int, linked: bool) -> dict:
    resp = client.put(f"/api/track-links/pair/{a}/{b}", json={"linked": linked})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_link_and_list(client, make_track):
    a, b = make_track(), make_track()
    assert put_pair(client, a.id, b.id, True) == {"linked": True}

    listed = client.get("/api/track-links").json()
    assert len(listed) == 1
    assert listed[0]["low_track_id"] == min(a.id, b.id)
    assert listed[0]["high_track_id"] == max(a.id, b.id)


def test_pair_order_is_normalized(client, make_track):
    a, b = make_track(), make_track()
    put_pair(client, b.id, a.id, True)  # reversed order on write…
    listed = client.get("/api/track-links").json()
    assert (listed[0]["low_track_id"], listed[0]["high_track_id"]) == (
        min(a.id, b.id),
        max(a.id, b.id),
    )

    put_pair(client, a.id, b.id, False)  # …and the other order clears the same fact
    assert client.get("/api/track-links").json() == []


def test_link_is_idempotent(client, make_track, db_session):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, True)
    row_id = db_session.query(TrackLink).one().id

    assert put_pair(client, a.id, b.id, True) == {"linked": True}
    row = db_session.query(TrackLink).one()
    assert row.id == row_id  # no churn: the existing row is kept


def test_unlink_is_idempotent(client, make_track, db_session):
    a, b = make_track(), make_track()
    assert put_pair(client, a.id, b.id, False) == {"linked": False}
    assert db_session.query(TrackLink).count() == 0


def test_pairs_are_isolated(client, make_track):
    a, b, c = make_track(), make_track(), make_track()
    put_pair(client, a.id, b.id, True)
    put_pair(client, b.id, c.id, True)

    put_pair(client, a.id, b.id, False)
    listed = client.get("/api/track-links").json()
    assert [(r["low_track_id"], r["high_track_id"]) for r in listed] == [
        (min(b.id, c.id), max(b.id, c.id))
    ]


def test_self_pair_400(client, make_track):
    a = make_track()
    resp = client.put(f"/api/track-links/pair/{a.id}/{a.id}", json={"linked": True})
    assert resp.status_code == 400


def test_unknown_track_404(client, make_track):
    a = make_track()
    resp = client.put(f"/api/track-links/pair/{a.id}/99999", json={"linked": True})
    assert resp.status_code == 404


def test_track_delete_cascades_links(client, make_track, db_session):
    a, b = make_track(), make_track()
    put_pair(client, a.id, b.id, True)

    # No track-delete feature exists yet; exercise the ORM cascade directly
    # (same policy as the transitions suite).
    db_session.delete(db_session.merge(a))
    db_session.commit()
    assert db_session.query(TrackLink).count() == 0
