"""Export key → Rekordbox (rekordbox-perf-export/01).

Router seam: the exporter dependency is faked (ADR 0002/0004 posture —
no real pyrekordbox DB in tests). Writer plumbing (snapshot-once) gets
unit tests against tmp dirs.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Track
from rekordbox.perf_export import (
    RekordboxRunningError,
    TrackNotInRekordboxError,
    snapshot_library,
)


class FakeExporter:
    def __init__(self, result: str = "Am", error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[tuple[str, int]] = []

    def export_key(self, filename: str, engine_key_id: int) -> str:
        self.calls.append((filename, engine_key_id))
        if self.error is not None:
            raise self.error
        return self.result


@pytest.fixture
def make_client(db: Session):
    from backend.routers import sync_export

    def _make(exporter: FakeExporter) -> TestClient:
        app = FastAPI()
        app.include_router(sync_export.router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[sync_export.get_rekordbox_perf_exporter] = (
            lambda: exporter
        )
        return TestClient(app)

    return _make


@pytest.fixture
def track(db: Session) -> Track:
    t = Track(filename="/music/take-it-in.flac", title="Take It In", key=7)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def test_exports_library_key(make_client, track):
    exporter = FakeExporter(result="Am")
    res = make_client(exporter).post(
        "/api/sync/export/key/rekordbox", json={"track_id": track.id}
    )
    assert res.status_code == 200
    assert res.json() == {"exported": True, "key": "Am"}
    assert exporter.calls == [("/music/take-it-in.flac", 7)]


def test_unknown_track_404(make_client):
    exporter = FakeExporter()
    res = make_client(exporter).post(
        "/api/sync/export/key/rekordbox", json={"track_id": 999}
    )
    assert res.status_code == 404
    assert exporter.calls == []


def test_keyless_library_track_409(make_client, db):
    t = Track(filename="/music/keyless.flac", title="Keyless", key=None)
    db.add(t)
    db.commit()
    db.refresh(t)
    exporter = FakeExporter()
    res = make_client(exporter).post(
        "/api/sync/export/key/rekordbox", json={"track_id": t.id}
    )
    assert res.status_code == 409
    assert exporter.calls == []  # never touches Rekordbox


def test_track_not_in_rekordbox_404(make_client, track):
    exporter = FakeExporter(error=TrackNotInRekordboxError("no matches"))
    res = make_client(exporter).post(
        "/api/sync/export/key/rekordbox", json={"track_id": track.id}
    )
    assert res.status_code == 404


def test_rekordbox_running_409(make_client, track):
    exporter = FakeExporter(error=RekordboxRunningError("Rekordbox is running"))
    res = make_client(exporter).post(
        "/api/sync/export/key/rekordbox", json={"track_id": track.id}
    )
    assert res.status_code == 409


def test_dependency_rejects_while_rekordbox_running(db, track, monkeypatch, tmp_path):
    """The real dependency guards before any DB is opened."""
    from backend.routers import sync_export

    class FakeDbCfg:
        rekordbox_path = str(tmp_path)

    class FakeCfg:
        database = FakeDbCfg()

    monkeypatch.setattr("backend.config.get_config", lambda: FakeCfg())
    monkeypatch.setattr(
        "rekordbox.perf_export.ensure_rekordbox_closed",
        lambda: (_ for _ in ()).throw(RekordboxRunningError("Rekordbox is running")),
    )
    app = FastAPI()
    app.include_router(sync_export.router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    res = TestClient(app).post(
        "/api/sync/export/key/rekordbox", json={"track_id": track.id}
    )
    assert res.status_code == 409
    assert "running" in res.json()["detail"].lower()


# -- snapshot plumbing -------------------------------------------------------


def test_snapshot_library_once_per_run(tmp_path, monkeypatch):
    import rekordbox.perf_export as pe

    monkeypatch.setattr(pe, "_snapshotted", set())
    lib = tmp_path / "rekordbox"
    lib.mkdir()
    (lib / "master.db").write_text("db")
    (lib / "share").mkdir()
    (lib / "share" / "anlz.DAT").write_text("anlz")

    first = snapshot_library(lib)
    assert first is not None
    assert (first / "master.db").read_text() == "db"
    assert (first / "share" / "anlz.DAT").read_text() == "anlz"

    assert snapshot_library(lib) is None  # same run: no re-snapshot
    snaps = list((tmp_path / "rekordbox-snapshots").iterdir())
    assert len(snaps) == 1
