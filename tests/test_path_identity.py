"""#305: path identity across Rekordbox / Disk / Library spellings."""

import sys
import unicodedata
from pathlib import Path
from types import SimpleNamespace

from backend.library.import_manager import LibraryImportManager
from backend.models import Track
from backend.tracks.executor import (
    create_needs_analysis_playlist,
    export_tracks_to_rekordbox,
    import_tracks_from_rekordbox,
)
from rekordbox.sync import manadj_track_to_rekordbox_fields


class FakeRb:
    def __init__(self, contents=()):
        self.added: list[str] = []
        self.contents = list(contents)
        self.playlist: list = []

    def add_content(self, path, **kw):
        self.added.append(path)

    def commit(self, autoinc=False):
        pass

    def get_content(self):
        return self.contents

    def create_playlist(self, name):
        return name

    def add_to_playlist(self, playlist, content):
        self.playlist.append(content)


def test_rekordbox_writes_forward_slash_folder_paths(db, audio_file):
    path = audio_file()
    track = Track(filename=str(path), title="t")
    rb = FakeRb()
    assert export_tracks_to_rekordbox([track], rb, dry_run=False) == 1
    assert rb.added == [path.absolute().as_posix()]
    assert "\\" not in manadj_track_to_rekordbox_fields(track)["FolderPath"]


def test_rekordbox_import_stores_native_separators(db, audio_file):
    path = audio_file()
    row = SimpleNamespace(FolderPath=path.as_posix(), Title="t", BPM=None, KeyID=None)
    import_tracks_from_rekordbox([row], db, dry_run=False)
    assert db.query(Track).one().filename == str(Path(path.as_posix()))


def test_needs_analysis_playlist_matches_by_identity(db):
    native = "C:\\Music\\t.mp3" if sys.platform == "win32" else "/Music/t.mp3"
    rb_spelling = native.replace("\\", "/")
    content = SimpleNamespace(FolderPath=rb_spelling)
    rb = FakeRb([content, SimpleNamespace(FolderPath=None)])
    assert create_needs_analysis_playlist([Track(filename=native)], rb, "x", dry_run=False)
    assert rb.playlist == [content]


def test_disk_import_dedupes_nfd_spelling(db, audio_file, tmp_path):
    path = audio_file("mp3", "Anaïs.mp3")
    nfd = unicodedata.normalize("NFD", str(path.resolve()))
    db.add(Track(filename=nfd, title="t"))
    db.commit()
    manager = LibraryImportManager(db, str(tmp_path))
    assert manager.get_import_candidates().stats.already_in_db == 1
