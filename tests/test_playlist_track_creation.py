"""Playlist export through the real sync seam; downstream writes use decoys."""

from types import SimpleNamespace

import pytest

from backend.models import Playlist, PlaylistTrack
from backend.playlists.sync_manager import PlaylistSyncManager


class FakeRekordbox:
    def __init__(self, events):
        self.session = self
        self.events = events
        self.rows = []
        self.pending = None
        self.fail = set()

    def query(self, model):
        return SimpleNamespace(all=lambda: [])

    def get_content(self):
        return self.rows

    def add_content(self, path, **kwargs):
        self.events.append("add:" + path.name)
        self.pending = SimpleNamespace(ID=str(len(self.rows) + 1), FolderPath=str(path))
        if path.name in self.fail:
            raise RuntimeError("decoy insert failed")
        return self.pending

    def commit(self, **kwargs):
        if self.pending is not None:
            if getattr(self, "fail_commit", False):
                self.fail_commit = False
                raise RuntimeError("decoy commit failed")
            self.rows.append(self.pending)
            self.pending = None

    def rollback(self):
        self.events.append("rollback")
        self.pending = None


@pytest.fixture
def export(db, make_track, audio_file, tmp_path, monkeypatch):
    import backend.config
    import rekordbox.perf_export as safety
    import rekordbox.playlist as membership

    events = []
    rb = FakeRekordbox(events)
    monkeypatch.setattr(safety, "ensure_rekordbox_closed", lambda: events.append("closed"))
    monkeypatch.setattr(safety, "snapshot_library", lambda path: events.append("snapshot"))
    monkeypatch.setattr(backend.config, "get_config", lambda: SimpleNamespace(
        database=SimpleNamespace(rekordbox_path=tmp_path)))
    orders = []

    def replace(**kwargs):
        events.append("membership")
        orders.append([row.FolderPath for row in kwargs["rb_tracks"]])
        return SimpleNamespace(ID="playlist"), len(orders) == 1

    monkeypatch.setattr(membership, "create_or_update_playlist", replace)

    def setup(names):
        playlist = Playlist(name="Export")
        db.add(playlist)
        db.flush()
        paths = []
        for position, name in enumerate(names):
            path = audio_file(name=name)
            track = make_track(filename=str(path))
            db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=position))
            paths.append(path)
        db.commit()
        return PlaylistSyncManager(db, rb_db=rb), paths

    return setup, rb, events, orders


def test_missing_tracks_created_in_play_order_and_idempotent(export):
    setup, rb, events, orders = export
    manager, paths = setup(["first.mp3", "second.mp3"])
    result = manager.sync_playlist_to_target("Export", "manadj", "rekordbox")
    assert result.success, result.error
    assert result.tracks_added == ["first.mp3", "second.mp3"]
    assert orders == [[str(p) for p in paths]]
    assert events[:2] == ["closed", "snapshot"]
    again = manager.sync_playlist_to_target("Export", "manadj", "rekordbox")
    assert again.success
    assert again.tracks_added == []
    assert len(rb.rows) == 2
    assert events[-3:] == ["closed", "snapshot", "membership"]


def test_existing_and_created_tracks_keep_interleaved_order(export):
    setup, rb, events, orders = export
    manager, paths = setup(["new-first.mp3", "existing.mp3", "new-last.mp3"])
    rb.rows.append(SimpleNamespace(ID="existing", FolderPath=str(paths[1])))
    result = manager.sync_playlist_to_target("Export", "manadj", "rekordbox")
    assert result.success, result.error
    assert result.tracks_added == ["new-first.mp3", "new-last.mp3"]
    assert orders == [[str(path) for path in paths]]
    assert len(rb.rows) == 3


@pytest.mark.parametrize("ignore", [False, True])
def test_insert_failure_rolls_back_and_next_track_still_created(export, ignore):
    setup, rb, events, orders = export
    manager, paths = setup(["broken.mp3", "good.mp3"])
    rb.fail.add("broken.mp3")
    result = manager.sync_playlist_to_target(
        "Export", "manadj", "rekordbox", ignore_missing_tracks=ignore
    )
    assert result.success is ignore
    assert result.tracks_added == ["good.mp3"]
    assert result.tracks_unmatched == ["broken.mp3"]
    assert "decoy insert failed" in result.track_errors["broken.mp3"]
    assert events.index("rollback") < events.index("add:good.mp3")
    assert [r.FolderPath for r in rb.rows] == [str(paths[1])]
    assert orders == ([[str(paths[1])]] if ignore else [])


def test_dry_run_plans_without_guards_snapshots_or_writes(export):
    setup, rb, events, orders = export
    manager, _ = setup(["planned.mp3"])
    result = manager.sync_playlist_to_target("Export", "manadj", "rekordbox", dry_run=True)
    assert result.success
    assert result.tracks_to_add == ["planned.mp3"]
    assert result.tracks_added == []
    assert result.tracks_synced == 1
    assert result.track_errors == {}
    assert events == []
    assert rb.rows == orders == []


@pytest.mark.parametrize("dry_run", [False, True])
@pytest.mark.parametrize("kind", ["missing", "directory", "unreadable"])
def test_invalid_audio_reported_and_blocks_membership(export, monkeypatch, dry_run, kind):
    from pathlib import Path

    setup, rb, events, orders = export
    manager, paths = setup(["invalid.mp3"])
    path = paths[0]
    if kind in ("missing", "directory"):
        path.unlink()  # Only a temp copy of the silence fixture.
        if kind == "directory":
            path.mkdir()
    else:
        original = Path.open

        def unreadable(self, *args, **kwargs):
            if self == path:
                raise PermissionError("decoy permission denied")
            return original(self, *args, **kwargs)

        monkeypatch.setattr(Path, "open", unreadable)
    result = manager.sync_playlist_to_target("Export", "manadj", "rekordbox", dry_run=dry_run)
    assert not result.success
    assert result.tracks_unmatched == ["invalid.mp3"]
    assert "invalid.mp3" in result.track_errors
    assert events == []
    assert orders == rb.rows == []


def test_same_basename_failure_does_not_hide_good_reference(export, db, make_track, tmp_path):
    setup, rb, events, orders = export
    manager, paths = setup(["same.mp3"])
    bad = tmp_path / "absent" / "same.mp3"
    track = make_track(filename=str(bad))
    playlist = db.query(Playlist).filter_by(name="Export").one()
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=-1))
    db.commit()
    preview = manager.sync_playlist_to_target(
        "Export", "manadj", "rekordbox", ignore_missing_tracks=True, dry_run=True
    )
    assert preview.tracks_to_add == ["same.mp3"]
    assert preview.tracks_synced == 1
    assert preview.tracks_unmatched == ["same.mp3"]
    assert events == []
    result = manager.sync_playlist_to_target(
        "Export", "manadj", "rekordbox", ignore_missing_tracks=True
    )
    assert result.success
    assert result.tracks_added == ["same.mp3"]
    assert result.tracks_unmatched == ["same.mp3"]
    assert orders == [[str(paths[0])]]


def test_safety_failure_prevents_all_writes(export, monkeypatch):
    import rekordbox.perf_export as safety

    setup, rb, events, orders = export
    manager, _ = setup(["guarded.mp3"])

    def refuse():
        raise RuntimeError("decoy app running")

    monkeypatch.setattr(safety, "ensure_rekordbox_closed", refuse)
    result = manager.sync_playlist_to_target("Export", "manadj", "rekordbox")
    assert not result.success
    assert "decoy app running" in result.error
    assert not rb.rows and not orders
    assert "snapshot" not in events


def test_commit_failure_rolls_back_before_next_track(export):
    setup, rb, events, orders = export
    manager, paths = setup(["commit-fails.mp3", "survives.mp3"])
    rb.fail_commit = True
    result = manager.sync_playlist_to_target(
        "Export", "manadj", "rekordbox", ignore_missing_tracks=True
    )
    assert result.success
    assert result.tracks_added == ["survives.mp3"]
    assert result.tracks_unmatched == ["commit-fails.mp3"]
    assert "decoy commit failed" in result.track_errors["commit-fails.mp3"]
    assert events.index("rollback") < events.index("add:survives.mp3")
    assert orders == [[str(paths[1])]]


def test_snapshot_failure_prevents_creation_and_membership(export, monkeypatch):
    import rekordbox.perf_export as safety

    setup, rb, events, orders = export
    manager, _ = setup(["snapshot-fails.mp3"])

    def refuse(path):
        raise OSError("decoy snapshot failed")

    monkeypatch.setattr(safety, "snapshot_library", refuse)
    result = manager.sync_playlist_to_target("Export", "manadj", "rekordbox")
    assert not result.success
    assert "decoy snapshot failed" in result.error
    assert not rb.rows and not orders
    assert not any(event.startswith("add:") for event in events)


def test_result_collection_defaults_are_independent():
    from backend.playlists.models import SyncResult

    first = SyncResult("engine", True, False, 0, [])
    second = SyncResult("engine", True, False, 0, [])
    first.tracks_added.append("one.mp3")
    first.tracks_to_add.append("two.mp3")
    first.track_errors["bad.mp3"] = "failed"
    assert second.tracks_added == second.tracks_to_add == []
    assert second.track_errors == {}


def test_membership_route_returns_creation_failure_receipt(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.playlists.models import SyncResult
    from backend.routers import sync_playlists as route

    receipt = SyncResult(
        "engine", False, False, 0, ["bad.mp3"], "Some tracks could not be created",
        tracks_added=["good.mp3"], track_errors={"bad.mp3": "decoy write failed"},
    )
    monkeypatch.setattr(route, "get_config", lambda: SimpleNamespace(
        database=SimpleNamespace(engine_dj_path=None, rekordbox_path=None)))
    monkeypatch.setattr(route, "require_export_enabled", lambda: None)
    monkeypatch.setattr(route.PlaylistSyncManager, "sync_playlist_to_target", lambda *a, **k: receipt)
    monkeypatch.setattr(route.PlaylistSyncManager, "sync_playlist_to_all", lambda *a, **k: [receipt])
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[route.get_db] = lambda: None
    client = TestClient(app)
    for target in ("engine", None):
        response = client.post("/sync/playlists/sync?playlist=Export", json={"source": "manadj", "target": target})
        assert response.status_code == 200
        data = response.json() if target else response.json()[0]
        assert data["success"] is False
        assert data["tracks_added"] == ["good.mp3"]
        assert data["track_errors"] == {"bad.mp3": "decoy write failed"}


def test_playlist_routes_refuse_export_before_connecting(monkeypatch):
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient

    from backend.routers import sync_export, sync_playlists

    def disabled():
        raise HTTPException(403, "export disabled")

    def no_connection(*args, **kwargs):
        pytest.fail("Export-disabled request must not connect or construct a writer")

    monkeypatch.setattr(sync_playlists, "get_config", lambda: SimpleNamespace(
        database=SimpleNamespace(engine_dj_path="decoy", rekordbox_path="decoy")))
    monkeypatch.setattr(sync_playlists, "require_export_enabled", disabled)
    monkeypatch.setattr(sync_playlists, "get_rekordbox_db", no_connection)
    app = FastAPI()
    app.include_router(sync_playlists.router)
    app.include_router(sync_export.router)
    app.dependency_overrides[sync_playlists.get_db] = lambda: None
    app.dependency_overrides[sync_export.require_export_enabled] = disabled
    app.dependency_overrides[sync_export.get_playlist_full_export_service] = no_connection
    client = TestClient(app)
    assert client.post("/sync/playlists/sync?playlist=Export", json={"source": "manadj"}).status_code == 403
    assert client.post("/sync/export/playlists/performance?playlist=Export", json={"targets": ["engine"]}).status_code == 403


def test_engine_creation_uses_supported_insert_and_library_root(
    db, make_track, audio_file, tmp_path, monkeypatch
):
    import enginedj.track_export as safety
    from enginedj.connection import EngineDJDatabase
    from tests.test_engine_track_export import InMemoryEngineDB

    engine = InMemoryEngineDB(tmp_path / "Engine Library")
    engine.get_playlist_hierarchy_name = (
        lambda playlist_id: EngineDJDatabase.get_playlist_hierarchy_name(engine, playlist_id)
    )
    events = []
    monkeypatch.setattr(safety, "ensure_engine_closed", lambda: events.append("closed"))
    monkeypatch.setattr(safety, "snapshot_database", lambda path: events.append(path))
    paths = [audio_file(name="one.mp3"), audio_file(name="two.mp3")]
    playlist = Playlist(name="Export")
    db.add(playlist)
    db.flush()
    for position, path in enumerate(paths):
        track = make_track(filename=str(path), title=f"Title {position}")
        db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=position))
    db.commit()
    manager = PlaylistSyncManager(db, engine_db=engine)
    try:
        preview = manager.sync_playlist_to_target("Export", "manadj", "engine", dry_run=True)
        assert preview.success
        assert preview.tracks_to_add == ["one.mp3", "two.mp3"]
        assert events == []
        result = manager.sync_playlist_to_target("Export", "manadj", "engine")
        assert result.success, result.error
        assert result.tracks_added == ["one.mp3", "two.mp3"]
        assert events == ["closed", engine.database_path]
        exported = manager.load_all_playlists()["engine"]
        assert len(exported) == 1
        assert [ref.filename for ref in exported[0].tracks] == ["one.mp3", "two.mp3"]
        assert [ref.title for ref in exported[0].tracks] == ["Title 0", "Title 1"]
        again = manager.sync_playlist_to_target("Export", "manadj", "engine")
        assert again.success, again.error
        assert again.tracks_added == []
        assert again.tracks_synced == 2
        assert events[-2:] == ["closed", engine.database_path]

        # Engine -> Rekordbox keeps the old missing-track policy: no creation.
        rb_events = []
        other = PlaylistSyncManager(db, engine_db=engine, rb_db=FakeRekordbox(rb_events))
        unchanged = other.sync_playlist_to_target("Export", "engine", "rekordbox")
        assert not unchanged.success
        assert unchanged.tracks_unmatched == ["one.mp3", "two.mp3"]
        assert unchanged.tracks_added == unchanged.tracks_to_add == []
        assert rb_events == []
    finally:
        engine.engine.dispose()
