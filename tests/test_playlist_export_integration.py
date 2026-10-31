"""Full Export seams against decoy Engine and real pyrekordbox SQLAlchemy DBs.

Only performance/tag exporters and process/snapshot boundaries are substituted.
Track creation, matching, playlist membership, writers and runners stay real.
"""

from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.orm import Session

from backend.models import Playlist, PlaylistTrack, Track
from backend.playlist_full_export import (
    EnginePlaylistWriter,
    PlaylistExportTargetRunner,
    PlaylistFullExportService,
    RekordboxPlaylistWriter,
    preview_playlist_full_export,
)
from backend.playlists.sync_manager import PlaylistSyncManager


@pytest.fixture
def destinations(tmp_path, monkeypatch):
    import backend.config
    import enginedj.track_export as engine_export
    import rekordbox.connection
    import rekordbox.perf_export as rb_export
    import pyrekordbox.db6.database as rb_api
    from enginedj.base import Base as EngineBase
    from enginedj.connection import EngineDJDatabase
    from enginedj.models.information import Information
    from pyrekordbox import Rekordbox6Database
    from pyrekordbox.db6 import tables

    engine_path = tmp_path / "Engine Library" / "Database2"
    rb_path = tmp_path / "Rekordbox"
    engine_path.mkdir(parents=True)
    rb_path.mkdir()
    seed_engine = create_engine(f"sqlite:///{engine_path / 'm.db'}")
    # External schemas, never the app schema or a developer library.
    EngineBase.metadata.create_all(seed_engine)
    with Session(seed_engine) as session:
        session.add(Information(uuid="decoy-engine", schemaVersionMajor=3,
                                schemaVersionMinor=0, schemaVersionPatch=1))
        session.commit()
    seed_engine.dispose()
    seed_rb = create_engine(f"sqlite:///{rb_path / 'master.db'}")
    # pyrekordbox annotates optional external fields as non-Optional while
    # giving them default=None. Its API omits these fields on add_content;
    # the real Rekordbox schema accepts NULL. Relax the copied test DDL only.
    rb_schema = MetaData()
    for table in tables.Base.metadata.sorted_tables:
        copied = table.to_metadata(rb_schema)
        for column in copied.columns:
            if not column.primary_key and column.default is None:
                column.nullable = True
    rb_schema.create_all(seed_rb)
    with Session(seed_rb) as session:
        session.add_all([
            tables.AgentRegistry(registry_id="localUpdateCount", int_1=0,
                                 date_1=datetime.now(), date_2=datetime.now()),
            tables.DjmdDevice.create(ID="device", MasterDBID="decoy-master", Name="Decoy"),
            tables.DjmdMenuItems.create(ID="track", Name="TRACK", rb_local_usn=1),
        ])
        session.commit()
    seed_rb.dispose()
    # Do not let pyrekordbox discover or open host configuration or libraries.
    monkeypatch.setattr(rb_api, "get_config", lambda *args: {})
    monkeypatch.setattr(rb_api, "get_rekordbox_pid", lambda: 0)
    rb = Rekordbox6Database(rb_path / "master.db", unlock=False)
    engine = EngineDJDatabase(engine_path)
    config = SimpleNamespace(database=SimpleNamespace(
        engine_dj_path=str(engine_path), rekordbox_path=str(rb_path)
    ))
    monkeypatch.setattr(backend.config, "get_config", lambda: config)
    monkeypatch.setattr(rekordbox.connection, "get_rekordbox_db", lambda: rb)
    events = []
    monkeypatch.setattr(engine_export, "ensure_engine_closed", lambda: events.append("engine:closed"))
    monkeypatch.setattr(engine_export, "snapshot_database", lambda path: events.append(("engine:snapshot", path)))
    monkeypatch.setattr(rb_export, "ensure_rekordbox_closed", lambda: events.append("rekordbox:closed"))
    monkeypatch.setattr(rb_export, "snapshot_library", lambda path: events.append(("rekordbox:snapshot", path)))

    def log_write(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().split()[0].upper() in {"INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP"}:
            events.append("sql:write")

    event.listen(engine.m_engine_write, "before_cursor_execute", log_write)
    event.listen(rb.engine, "before_cursor_execute", log_write)
    try:
        yield SimpleNamespace(engine=engine, rb=rb, events=events, config=config)
    finally:
        rb.close()
        rb.engine.dispose()
        engine.m_engine.dispose()
        engine.m_engine_write.dispose()


@pytest.fixture
def playlist_members(db, make_track, audio_file):
    def create(names, missing=()):
        playlist = Playlist(name="Export")
        db.add(playlist)
        db.flush()
        tracks = []
        for position, name in enumerate(names):
            path = audio_file(name=name)
            if position in missing:
                path.unlink()  # Only temp copies of the silence fixture.
            track = make_track(filename=str(path), title=f"Track {position}")
            db.add(PlaylistTrack(playlist_id=playlist.id, track_id=track.id, position=position))
            tracks.append(track)
        db.commit()
        return playlist, tracks

    return create


@pytest.fixture
def performance_stubs(monkeypatch, destinations, db):
    import enginedj.perf_export
    import rekordbox.perf_export
    import rekordbox.mappings
    import rekordbox.tag_sync
    import backend.tags.engine_writer

    state = destinations

    def assert_present(target, filename):
        from backend.playlists.models import TrackReference

        manager = PlaylistSyncManager(db, engine_db=state.engine, rb_db=state.rb)
        assert manager.match_tracks_to_target(target, [TrackReference(filename, Path(filename).name)])[0]
        state.events.append((target + ":performance", filename))

    class EnginePerformance:
        def __init__(self, *args):
            pass

        def export_performance(self, filename, **kwargs):
            assert_present("engine", filename)
            return {"hotcues": "exported"}

    class RekordboxPerformance:
        def __init__(self, *args):
            pass

        def export_hotcues(self, filename, *args):
            assert_present("rekordbox", filename)

        def export_maincue(self, filename, *args):
            assert_present("rekordbox", filename)

    class EngineTags:
        def __init__(self, *args):
            pass

        def sync_scoped_tag_assignments(self, track_ids):
            from backend.playlists.models import TrackReference

            manager = PlaylistSyncManager(db, engine_db=state.engine)
            for track_id in track_ids:
                track = db.get(Track, track_id)
                if (Path(track.filename).is_file()
                        and track.filename not in getattr(state, "expected_engine_failures", set())):
                    assert manager.match_tracks_to_target(
                        "engine", [TrackReference(track.filename, Path(track.filename).name)]
                    )[0], "Tag assignments ran before track creation"
            state.events.append("engine:tags")

    class RekordboxTags:
        def __init__(self, *args):
            pass

        def sync_tag_structure(self, **kwargs):
            state.events.append("rekordbox:tag-structure")
            return {}, {}, {}

        def sync_track_tags_and_colors(self, *args, **kwargs):
            state.events.append("rekordbox:tags")

    monkeypatch.setattr(enginedj.perf_export, "EnginePerfExporter", EnginePerformance)
    monkeypatch.setattr(rekordbox.perf_export, "RekordboxPerfExporter", RekordboxPerformance)
    monkeypatch.setattr(backend.tags.engine_writer, "EngineTagWriter", EngineTags)
    monkeypatch.setattr(rekordbox.tag_sync, "RekordboxTagSyncer", RekordboxTags)
    monkeypatch.setattr(rekordbox.mappings, "build_energy_color_map", lambda session: {})


def _runner(db, destinations, target):
    writer = (
        EnginePlaylistWriter(db, destinations.engine, Path(destinations.config.database.engine_dj_path))
        if target == "engine" else
        RekordboxPlaylistWriter(db, destinations.rb, Path(destinations.config.database.rekordbox_path))
    )
    return PlaylistExportTargetRunner(writer)


def _seed_destination(destinations, target, paths, playlist_name=None):
    """Pre-existing library rows and optional membership, via supported APIs."""
    if target == "engine":
        from enginedj.models.track import Track as EngineTrack
        from enginedj.playlist import create_or_update_playlist
        from enginedj.track_export import EngineTrackSpec, insert_track

        with destinations.engine.session_m_write() as session:
            rows = [session.get(EngineTrack, insert_track(
                session, EngineTrackSpec(path, path.stem), destinations.engine.database_path.parent
            )) for path in paths]
            if playlist_name:
                create_or_update_playlist(session, playlist_name, 0, rows, "decoy-engine")
    else:
        rb = destinations.rb
        rows = [rb.add_content(path, Title=path.stem) for path in paths]
        if playlist_name:
            playlist = rb.create_playlist(playlist_name)
            for row in rows:
                rb.add_to_playlist(playlist, row)
        rb.commit(autoinc=True)


def _library_paths(destinations, target):
    if target == "engine":
        from enginedj.models.track import Track as EngineTrack

        with destinations.engine.session_m() as session:
            return sorted((destinations.engine.database_path.parent / row.path).resolve().as_posix()
                          for row in session.query(EngineTrack).all())
    return sorted(row.FolderPath for row in destinations.rb.get_content())


def _playlist_names(db, destinations, target):
    manager = PlaylistSyncManager(db, engine_db=destinations.engine, rb_db=destinations.rb)
    playlist = next(p for p in manager.load_all_playlists()[target] if p.name == "Export")
    return [ref.filename for ref in playlist.tracks]


@pytest.mark.parametrize("target", ["engine", "rekordbox"])
def test_metadata_failure_keeps_created_records_and_membership_receipt(
    db, playlist_members, destinations, performance_stubs, monkeypatch, target
):
    from backend.tags.engine_writer import EngineTagWriter
    from rekordbox.tag_sync import RekordboxTagSyncer

    def fail(*args, **kwargs):
        raise RuntimeError("decoy metadata failure")

    monkeypatch.setattr(EngineTagWriter, "sync_scoped_tag_assignments", fail)
    monkeypatch.setattr(RekordboxTagSyncer, "sync_tag_structure", fail)
    playlist, tracks = playlist_members(["new.mp3"])
    result = _runner(db, destinations, target).export(playlist, tracks)
    assert result["tracks_added"] == ["new.mp3"]
    assert result["playlist_created"] is True
    assert result["tracks"][0]["fields"]["playlist"] == "exported"
    assert result["tracks"][0]["fields"]["tags"] == "failed: decoy metadata failure"
    assert result["tracks_failed"] == 1
    assert len(_library_paths(destinations, target)) == 1
    assert _playlist_names(db, destinations, target) == ["new.mp3"]


@pytest.mark.parametrize("target", ["engine", "rekordbox"])
def test_membership_failure_preserves_committed_library_additions(
    db, playlist_members, destinations, performance_stubs, monkeypatch, target
):
    def fail(*args, **kwargs):
        raise RuntimeError("decoy membership failure")

    monkeypatch.setattr(PlaylistSyncManager, "_sync_to_" + target, fail)
    playlist, tracks = playlist_members(["new.mp3"])
    result = _runner(db, destinations, target).export(playlist, tracks)
    assert result["tracks_added"] == ["new.mp3"]
    assert result["tracks_failed"] == 1
    assert result["tracks"][0]["reason"] == "decoy membership failure"
    assert len(_library_paths(destinations, target)) == 1


@pytest.mark.parametrize("target", ["engine", "rekordbox"])
def test_full_writer_reports_missing_source_even_when_created_track_shares_basename(
    db, make_track, playlist_members, destinations, performance_stubs, tmp_path, target
):
    playlist, tracks = playlist_members(["same.mp3"])
    missing = make_track(filename=str(tmp_path / "absent" / "same.mp3"), title="Missing")
    db.add(PlaylistTrack(playlist_id=playlist.id, track_id=missing.id, position=-1))
    db.commit()
    result = _runner(db, destinations, target).export(playlist, [missing, *tracks])
    assert result["status"] == "partial"
    assert result["tracks_failed"] == 1
    assert result["tracks"][0]["track_id"] == missing.id
    assert result["tracks"][0]["status"] == "failed"
    assert "existing regular file" in result["tracks"][0]["reason"]
    assert missing.filename in result["tracks"][0]["reason"]
    assert result["tracks"][1]["status"] == "exported"


@pytest.mark.parametrize("target", ["engine", "rekordbox"])
def test_full_writer_mixed_records_keeps_order_and_repeated_export_has_no_duplicates(
    db, playlist_members, destinations, performance_stubs, audio_file, target
):
    playlist, tracks = playlist_members(["new-first.mp3", "existing.mp3", "new-last.mp3"])
    outside = audio_file(name="outside.mp3")
    _seed_destination(destinations, target, [Path(tracks[1].filename), outside], "Export")
    runner = _runner(db, destinations, target)
    destinations.events.clear()
    result = runner.export(playlist, tracks)
    assert result["status"] == "exported", result
    assert result["playlist_created"] is False
    assert result["tracks_added"] == ["new-first.mp3", "new-last.mp3"]
    assert [row["track_id"] for row in result["tracks"]] == [track.id for track in tracks]
    assert _playlist_names(db, destinations, target) == ["new-first.mp3", "existing.mp3", "new-last.mp3"]
    expected_paths = sorted([track.filename for track in tracks] + [str(outside)])
    assert _library_paths(destinations, target) == expected_paths
    snapshot = (target + ":snapshot", Path(getattr(destinations.config.database,
                                                 "engine_dj_path" if target == "engine" else "rekordbox_path")))
    assert destinations.events.index(target + ":closed") < destinations.events.index(snapshot)
    assert destinations.events.index(snapshot) < destinations.events.index("sql:write")
    assert any(isinstance(item, tuple) and item[0] == target + ":performance"
               for item in destinations.events)

    again = runner.export(playlist, tracks)
    assert again["status"] == "exported", again
    assert again["tracks_added"] == []
    assert _library_paths(destinations, target) == expected_paths
    assert _playlist_names(db, destinations, target) == ["new-first.mp3", "existing.mp3", "new-last.mp3"]


@pytest.mark.parametrize("target", ["engine", "rekordbox"])
def test_full_writer_missing_audio_is_partial_with_detailed_reason(
    db, playlist_members, destinations, performance_stubs, target
):
    playlist, tracks = playlist_members(["before.mp3", "missing.mp3", "after.mp3"], missing=[1])
    result = _runner(db, destinations, target).export(playlist, tracks)
    assert result["status"] == "partial", result
    assert result["tracks_added"] == ["before.mp3", "after.mp3"]
    assert result["tracks_exported"] == 2
    assert result["tracks_failed"] == 1
    failed = result["tracks"][1]
    assert failed["track_id"] == tracks[1].id
    assert "existing regular file" in failed["reason"]
    assert tracks[1].filename in failed["reason"]
    assert _playlist_names(db, destinations, target) == ["before.mp3", "after.mp3"]
    assert _library_paths(destinations, target) == sorted([tracks[0].filename, tracks[2].filename])


def test_configured_preview_plans_additions_errors_and_order_without_writes(
    db, playlist_members, destinations, performance_stubs, audio_file
):
    _, tracks = playlist_members(
        ["new-first.mp3", "existing.mp3", "missing.mp3", "new-last.mp3"], missing=[2]
    )
    outside = audio_file(name="outside.mp3")
    for target in ("engine", "rekordbox"):
        _seed_destination(destinations, target, [Path(tracks[1].filename), outside], "Export")
    destinations.events.clear()
    files = [destinations.engine.m_db_path,
             Path(destinations.config.database.rekordbox_path) / "master.db"]
    before = [path.read_bytes() for path in files]
    result = preview_playlist_full_export(db, "Export", ["engine", "rekordbox"])
    assert destinations.events == []
    assert [path.read_bytes() for path in files] == before
    assert len(result["previews"]) == 2
    for preview in result["previews"]:
        assert preview["available"], preview
        assert preview["playlist_exists"]
        assert preview["tracks_total"] == 4
        assert preview["tracks_matched"] == 3
        assert preview["tracks_to_create"] == ["new-first.mp3", "new-last.mp3"]
        assert preview["tracks_to_add"] == 2
        assert preview["tracks_to_remove"] == 1
        assert preview["unmatched"] == ["missing.mp3"]
        assert "existing regular file" in preview["track_errors"]["missing.mp3"]
        assert tracks[2].filename in preview["track_errors"]["missing.mp3"]
        assert _library_paths(destinations, preview["target"]) == sorted([tracks[1].filename, str(outside)])
        assert _playlist_names(db, destinations, preview["target"]) == ["existing.mp3", "outside.mp3"]


@pytest.mark.parametrize("failing_target", ["engine", "rekordbox"])
def test_service_isolates_real_writer_safety_failure_to_one_target(
    db, playlist_members, destinations, performance_stubs, monkeypatch, failing_target
):
    import enginedj.track_export
    import rekordbox.perf_export

    _, tracks = playlist_members(["new.mp3"])
    good_target = "rekordbox" if failing_target == "engine" else "engine"

    def refuse():
        raise RuntimeError("decoy target unavailable")

    if failing_target == "engine":
        monkeypatch.setattr(enginedj.track_export, "ensure_engine_closed", refuse)
    else:
        monkeypatch.setattr(rekordbox.perf_export, "ensure_rekordbox_closed", refuse)
    service = PlaylistFullExportService(db, {
        target: _runner(db, destinations, target) for target in ("engine", "rekordbox")
    })
    reports = service.export("Export", [failing_target, good_target])["results"]
    assert reports[0]["status"] == "failed"
    assert "decoy target unavailable" in reports[0]["error"]
    assert reports[1]["status"] == "exported", reports
    assert reports[1]["tracks_added"] == ["new.mp3"]
    assert _library_paths(destinations, failing_target) == []
    assert _library_paths(destinations, good_target) == [tracks[0].filename]


@pytest.mark.parametrize("target", ["engine", "rekordbox"])
def test_distinct_same_basename_tracks_keep_distinct_membership_on_repeat(
    db, playlist_members, destinations, performance_stubs, tmp_path, target
):
    (tmp_path / "first-dir").mkdir()
    (tmp_path / "second-dir").mkdir()
    playlist, tracks = playlist_members(["first-dir/same.mp3", "second-dir/same.mp3"])
    runner = _runner(db, destinations, target)
    first = runner.export(playlist, tracks)
    assert first["status"] == "exported", first
    assert first["tracks_added"] == ["same.mp3", "same.mp3"]
    manager = PlaylistSyncManager(db, engine_db=destinations.engine, rb_db=destinations.rb)

    def membership_ids():
        playlist_info = next(p for p in manager.load_all_playlists()[target] if p.name == "Export")
        return [ref.track_id for ref in playlist_info.tracks]

    original_ids = membership_ids()
    assert len(original_ids) == len(set(original_ids)) == 2
    again = runner.export(playlist, tracks)
    assert again["status"] == "exported", again
    assert again["tracks_added"] == []
    assert membership_ids() == original_ids
    assert _library_paths(destinations, target) == sorted(track.filename for track in tracks)


def test_engine_cross_drive_preview_agrees_with_real_creation_failure(
    db, playlist_members, destinations, performance_stubs, monkeypatch
):
    import enginedj.track_export as engine_export

    playlist, tracks = playlist_members(["other-drive.mp3", "same-drive.mp3"])
    real_relpath = engine_export.os.path.relpath

    def windows_cross_drive(path, start):
        if Path(path) == Path(tracks[0].filename):
            raise ValueError("path is on mount 'D:', start on mount 'C:'")
        return real_relpath(path, start)

    # Emulate Windows' filesystem boundary, not insert_track or its validation.
    monkeypatch.setattr(engine_export.os.path, "relpath", windows_cross_drive)
    destinations.expected_engine_failures = {tracks[0].filename}
    destinations.events.clear()
    preview = preview_playlist_full_export(db, "Export", ["engine"])["previews"][0]
    assert destinations.events == []
    assert _library_paths(destinations, "engine") == []
    actual = _runner(db, destinations, "engine").export(playlist, tracks)
    assert actual["status"] == "partial", actual
    assert actual["tracks_added"] == ["same-drive.mp3"]
    assert "not on the Engine Library drive" in actual["tracks"][0]["reason"]
    assert preview["available"], preview
    assert preview["tracks_to_create"] == ["same-drive.mp3"]
    assert preview["tracks_matched"] == 1
    assert preview["unmatched"] == ["other-drive.mp3"]
    assert "not on the Engine Library drive" in preview["track_errors"]["other-drive.mp3"]
