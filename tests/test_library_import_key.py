"""Disk Import of key-tagged files (library-import 01).

Key crosses the file-metadata seam as an Engine DJ key ID (an int —
FileMetadata.key), and Track.key stores that same ID. The candidate model
typed it as str, so ONE key-tagged file 500'd the whole candidates listing.
Module-interface tests per ADR-0002: real DB, real tagged files, no mocks.
"""

import shutil
from pathlib import Path

from backend.library.import_manager import LibraryImportManager
from backend.models import Track
from backend.track_metadata.file_metadata import write_file_metadata

GMAJ_ENGINE_ID = 23


def make_importer(db, tmp_path: Path, fixture: Path, name: str, key: int | None):
    tracks_dir = tmp_path / "tracks"
    tracks_dir.mkdir(exist_ok=True)
    dest = tracks_dir / name
    shutil.copy(fixture, dest)
    if key is not None:
        write_file_metadata(dest, title="Keyed", artist="Someone", key=key)
    return LibraryImportManager(db, str(tracks_dir))


def test_key_tagged_file_is_listed_with_engine_key_id(db_session, tmp_path, audio_file):
    importer = make_importer(
        db_session, tmp_path, audio_file("mp3"), "keyed.mp3", GMAJ_ENGINE_ID
    )
    candidates = importer.get_import_candidates().candidates
    assert [c.filename for c in candidates] == ["keyed.mp3"]
    assert candidates[0].key == GMAJ_ENGINE_ID


def test_key_tagged_file_imports_key_onto_the_track(db_session, tmp_path, audio_file):
    importer = make_importer(
        db_session, tmp_path, audio_file("mp3"), "keyed.mp3", GMAJ_ENGINE_ID
    )
    result = importer.import_tracks()
    assert result.errors == 0, result.error_messages
    track = db_session.query(Track).filter(Track.title == "Keyed").one()
    assert track.key == GMAJ_ENGINE_ID


def test_untagged_file_still_imports_keyless(db_session, tmp_path, audio_file):
    importer = make_importer(db_session, tmp_path, audio_file("mp3"), "bare.mp3", None)
    candidates = importer.get_import_candidates().candidates
    assert candidates[0].key is None
