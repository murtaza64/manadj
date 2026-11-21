"""Remote mirror preview router tests (real in-memory SQLite, no mocks).

The endpoint is the read-only first rung of the remote-library plan: it must
report an accurate upload plan and provably change nothing - no writes to the
DB, no writes to the audio files, no network.
"""

import hashlib
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.config import get_config
from backend.database import get_db
from backend.models import Track
from backend.routers import remote_mirror
from backend.routers.remote_mirror import router


def _config_with_root(root: str | None):
    from types import SimpleNamespace

    return SimpleNamespace(library=SimpleNamespace(tracks_directory=root))


@pytest.fixture
def root(tmp_path: Path) -> Path:
    d = tmp_path / "library"
    d.mkdir()
    return d


@pytest.fixture
def client(db_session: Session, root: Path) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(router, prefix="/api/remote-mirror")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_config] = lambda: _config_with_root(str(root))
    with TestClient(app) as c:
        yield c


def _audio(root: Path, name: str, payload: bytes) -> Path:
    p = root / name
    p.write_bytes(payload)
    return p


def test_preview_plans_uploads_and_mutates_nothing(client, db_session, make_track, root):
    f1 = _audio(root, "a.mp3", b"alpha-audio")
    f2 = _audio(root, "b.mp3", b"beta-audio-2")
    make_track(filename=str(f1))
    make_track(filename=str(f2))
    before = db_session.execute(select(func.count()).select_from(Track)).scalar_one()

    resp = client.get("/api/remote-mirror/preview")
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "ok"
    assert body["tracks"] == 2
    assert body["files"] == 2
    assert body["upload_bytes"] == len(b"alpha-audio") + len(b"beta-audio-2")
    assert body["unchanged"] == 0 and body["changed"] == 0  # no remote index yet
    assert body["missing_total"] == 0 and body["collision_total"] == 0
    assert body["roots"] == [str(root)]
    assert body["duration_ms"] >= 0

    after = db_session.execute(select(func.count()).select_from(Track)).scalar_one()
    assert after == before
    # Files untouched: contents still hash to themselves.
    assert hashlib.sha256(f1.read_bytes()).hexdigest() == hashlib.sha256(b"alpha-audio").hexdigest()


def test_preview_reports_missing_and_outside_root(client, make_track, root, tmp_path):
    present = _audio(root, "ok.mp3", b"ok")
    make_track(filename=str(present))
    gone = make_track(filename=str(root / "deleted.mp3"))
    outside_file = _audio(tmp_path, "elsewhere.mp3", b"outside")
    outside = make_track(filename=str(outside_file))

    body = client.get("/api/remote-mirror/preview").json()
    assert body["status"] == "ok"
    assert body["files"] == 1
    assert body["tracks"] == 3
    assert body["missing_total"] == 2
    reasons = {m["track_id"]: m["reason"] for m in body["missing"]}
    assert "missing" in reasons[gone.id]
    assert "outside" in reasons[outside.id]


def test_preview_reports_case_collision(client, make_track, root):
    _audio(root, "Song.mp3", b"one")
    _audio(root, "song.mp3", b"two")
    make_track(filename=str(root / "Song.mp3"))
    make_track(filename=str(root / "song.mp3"))

    body = client.get("/api/remote-mirror/preview").json()
    assert body["collision_total"] == 1
    assert body["files"] == 1  # the first spelling keeps its key
    assert body["missing_total"] == 1


def test_preview_without_tracks_root(db_session: Session):
    app = FastAPI()
    app.include_router(router, prefix="/api/remote-mirror")
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_config] = lambda: _config_with_root(None)
    with TestClient(app) as c:
        body = c.get("/api/remote-mirror/preview").json()
    assert body["status"] == "no_tracks_root"
    assert body["tracks"] == 0


def test_concurrent_scan_is_refused(client, make_track, root):
    """Single-flight: while one scan holds the lock, another gets a 409
    instead of doubling disk load on the library."""
    f = _audio(root, "a.mp3", b"data")
    make_track(filename=str(f))

    assert remote_mirror._scan_lock.acquire(blocking=False)
    try:
        resp = client.get("/api/remote-mirror/preview")
        assert resp.status_code == 409
        assert "already running" in resp.json()["detail"]
    finally:
        remote_mirror._scan_lock.release()

    resp = client.get("/api/remote-mirror/preview")
    assert resp.status_code == 200


def test_db_transaction_is_released_before_hashing(client, db_session, make_track, root, monkeypatch):
    """The read transaction must not span the whole-library hash: by the time
    the planner runs, the session has been rolled back."""
    f = _audio(root, "a.mp3", b"data")
    make_track(filename=str(f))

    seen = {}

    real = remote_mirror.build_plan

    def spy(snapshot, roots, **kwargs):
        seen["in_transaction"] = db_session.in_transaction()
        return real(snapshot, roots, **kwargs)

    monkeypatch.setattr(remote_mirror, "build_plan", spy)
    resp = client.get("/api/remote-mirror/preview")
    assert resp.status_code == 200
    assert seen["in_transaction"] is False
