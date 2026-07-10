"""Metric-ladder persistence at the router seam (ADR 0029, metric-ladder 02).

Real in-memory SQLite via the migration path (conftest). Minimal app with
just the metric-ladders + tracks routers. Covers: the deviation-only
posture (default GET persists nothing; writing the default state clears
the row), full-state PUT round-trip with server-side normalization, and
validation. Downbeat resolution is client-side and deliberately absent
here (frontend/src/meter/ladder.test.ts owns it).
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import crud
from backend.database import get_db
from backend.models import MetricLadder
from backend.routers import metric_ladders, tracks


@pytest.fixture
def client(db_session: Session) -> TestClient:
    app = FastAPI()
    app.include_router(tracks.router, prefix="/api/tracks")
    app.include_router(metric_ladders.router, prefix="/api/metric-ladders")
    app.dependency_overrides[get_db] = lambda: db_session
    return TestClient(app)


def row_count(db: Session) -> int:
    return db.query(MetricLadder).count()


# -- deviation-only posture ---------------------------------------------------


def test_default_get_persists_nothing(client, db_session, make_track):
    track = make_track()
    resp = client.get(f"/api/metric-ladders/{track.id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["persisted"] is False
    assert body["arities"] == [2, 2, 2, 2]
    assert body["reset_marks"] == []
    assert row_count(db_session) == 0  # reads never create rows


def test_unknown_track_404s(client):
    assert client.get("/api/metric-ladders/999").status_code == 404
    assert client.put("/api/metric-ladders/999", json={"reset_marks": [1.0]}).status_code == 404


def test_put_default_state_clears_the_row(client, db_session, make_track):
    track = make_track()
    client.put(f"/api/metric-ladders/{track.id}", json={"reset_marks": [12.5]})
    assert row_count(db_session) == 1
    resp = client.put(f"/api/metric-ladders/{track.id}", json={"reset_marks": []})
    assert resp.status_code == 200, resp.text
    assert resp.json()["persisted"] is False
    assert row_count(db_session) == 0  # back to default = no row


# -- round-trip ---------------------------------------------------------------


def test_put_get_round_trip_sorts_and_dedupes(client, make_track):
    track = make_track()
    resp = client.put(
        f"/api/metric-ladders/{track.id}",
        json={"reset_marks": [30.0, 12.5, 30.0]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["persisted"] is True
    assert body["reset_marks"] == [12.5, 30.0]

    again = client.get(f"/api/metric-ladders/{track.id}").json()
    assert again["reset_marks"] == [12.5, 30.0]
    assert again["arities"] == [2, 2, 2, 2]
    assert again["persisted"] is True


def test_delete_returns_effective_default(client, db_session, make_track):
    track = make_track()
    client.put(f"/api/metric-ladders/{track.id}", json={"reset_marks": [5.0]})
    resp = client.delete(f"/api/metric-ladders/{track.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["persisted"] is False
    assert row_count(db_session) == 0


def test_marks_put_preserves_stored_arities(client, db_session, make_track):
    """Marks are the only editable surface (ADR 0029): a row hand-seeded
    with non-duple arities keeps them across mark writes."""
    track = make_track()
    crud.upsert_metric_ladder(db_session, track.id, [5.0], arities=[2, 2, 3])
    resp = client.put(f"/api/metric-ladders/{track.id}", json={"reset_marks": [5.0, 9.0]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["arities"] == [2, 2, 3]
    assert body["reset_marks"] == [5.0, 9.0]


def test_grid_replacement_leaves_stored_marks_untouched(client, db_session, make_track):
    """Marks are a pure read-time projection (ADR 0029): replacing the
    Beatgrid wholesale never rewrites or invalidates the stored seconds."""
    track = make_track()
    crud.update_beatgrid_tempo_changes(
        db_session,
        track.id,
        [{"start_time": 0.0, "bpm": 128.0, "time_signature_num": 4,
          "time_signature_den": 4, "bar_position": 1}],
    )
    client.put(f"/api/metric-ladders/{track.id}", json={"reset_marks": [30.0, 60.0]})

    # Full replacement: new tempo, new phase — a different lattice entirely.
    crud.update_beatgrid_tempo_changes(
        db_session,
        track.id,
        [{"start_time": 0.25, "bpm": 174.0, "time_signature_num": 4,
          "time_signature_den": 4, "bar_position": 1}],
        origin="imported",
    )
    body = client.get(f"/api/metric-ladders/{track.id}").json()
    assert body["reset_marks"] == [30.0, 60.0]
    assert body["persisted"] is True


# -- validation ---------------------------------------------------------------


def test_rejects_negative_marks(client, make_track):
    track = make_track()
    url = f"/api/metric-ladders/{track.id}"
    assert client.put(url, json={"reset_marks": [-1.0]}).status_code == 400
