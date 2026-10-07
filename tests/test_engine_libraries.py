"""#307: Engine per-drive libraries — discovery, routing, union reads."""

from pathlib import Path

import pytest

import enginedj.libraries as libs
from backend.sync_status.adapters import EngineSurfaceReader
from backend.tracks.executor import export_tracks_to_engine
from enginedj.models.track import Track as EDJTrack
from tests.test_engine_track_export import InMemoryEngineDB, make_file


def test_volume_of_per_os():
    assert libs.volume_of("D:\\Music\\a.mp3", "win32") == "d:"
    assert libs.volume_of("d:/Music/a.mp3", "win32") == "d:"
    assert libs.volume_of("/Volumes/USB/Music/a.mp3", "darwin") == "/Volumes/USB"
    assert libs.volume_of("/Users/dj/Music/a.mp3", "darwin") == "/"


def test_discover_drive_libraries_skips_main_and_bare_drives(tmp_path):
    main = tmp_path / "home" / "Music" / "Engine Library" / "Database2"
    main.mkdir(parents=True)
    (main / "m.db").write_bytes(b"decoy")
    usb = tmp_path / "USB"
    (usb / "Engine Library" / "Database2").mkdir(parents=True)
    (usb / "Engine Library" / "Database2" / "m.db").write_bytes(b"decoy")
    bare = tmp_path / "Bare"
    bare.mkdir()
    roots = [usb, bare, tmp_path / "home" / "Music"]
    # the main library also sits at a "drive root" here: deduped
    found = libs.discover_drive_libraries(main, roots=[*roots, main.parent.parent])
    assert found == [usb / "Engine Library" / "Database2"]


@pytest.fixture
def two_drives(tmp_path, monkeypatch):
    """Main library + Tracks on drive C, a per-drive library on drive D,
    and a bare drive E (no Engine Library)."""
    c, d, e = tmp_path / "C", tmp_path / "D", tmp_path / "E"
    for drive in (c, d, e):
        drive.mkdir()
    (c / "Engine Library" / "Database2").mkdir(parents=True)
    (d / "Engine Library" / "Database2").mkdir(parents=True)

    def fake_volume(path, platform=None):
        rel = Path(path).relative_to(tmp_path)
        return rel.parts[0]

    monkeypatch.setattr(libs, "volume_of", fake_volume)
    main = InMemoryEngineDB(c / "Engine Library")
    drive = InMemoryEngineDB(d / "Engine Library")
    (c / "Tracks").mkdir()
    return main, drive, c, d, e


def test_export_routes_tracks_to_their_drive_library(db, make_track, two_drives):
    main, drive, c, d, e = two_drives
    on_c = make_file(c / "Tracks", "c.mp3")
    on_d = make_file(d, "d.mp3")
    on_e = make_file(e, "e.mp3")
    for f in (on_c, on_d, on_e):
        make_track(filename=str(f), title=f.stem)

    result = export_tracks_to_engine(db, main, drive_dbs=[drive])

    assert result.exported_to_target == 2
    assert result.skipped_other_drive_paths == [str(on_e)]
    assert result.exported_by_library == {
        str(c / "Engine Library"): 1,
        str(d / "Engine Library"): 1,
    }
    with main.session_m() as s:
        assert [t.path for t in s.query(EDJTrack)] == ["../Tracks/c.mp3"]
    with drive.session_m() as s:
        assert [t.path for t in s.query(EDJTrack)] == ["../d.mp3"]
    assert main.created_playlists[0][0] == drive.created_playlists[0][0]

    # Present in any library = not missing: a rerun writes nothing.
    again = export_tracks_to_engine(db, main, drive_dbs=[drive])
    assert again.exported_to_target == 0


def test_surface_reader_unions_libraries(db, make_track, two_drives):
    main, drive, c, d, _ = two_drives
    make_track(filename=str(make_file(c / "Tracks", "c.mp3")), title="c")
    make_track(filename=str(make_file(d, "d.mp3")), title="d")
    export_tracks_to_engine(db, main, drive_dbs=[drive])

    refs = EngineSurfaceReader(main, [drive]).list_tracks()
    assert sorted(r.path for r in refs) == ["../Tracks/c.mp3", "../d.mp3"]
