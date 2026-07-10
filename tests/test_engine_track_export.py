"""Tests for direct Engine track export (enginedj/track_export.py +
backend.tracks.executor.export_tracks_to_engine).

Per ADR 0004: schema-real in-memory SQLite from the enginedj package's
own models. Note the real m.db has triggers (fix_origin, auto
PerformanceData) that create_all does not reproduce — insert_track
performs the same ritual explicitly, and these tests assert it.

The Engine-closed guard and Database2 snapshot live in the router
dependency, not the executor, so no process/filesystem mocking here.
"""

from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.tracks.executor import export_tracks_to_engine
from enginedj.base import Base as EngineBase
from enginedj.models.album_art import AlbumArt
from enginedj.models.information import Information
from enginedj.models.performance_data import PerformanceData
from enginedj.models.track import Track as EDJTrack
from enginedj.track_export import (
    EngineTrackSpec,
    get_or_create_empty_album_art,
    insert_track,
)

DB_UUID = "11111111-2222-3333-4444-555555555555"


class InMemoryEngineDB:
    """EngineDJDatabase stand-in: same session surface + create_playlist,
    over a schema-real in-memory database."""

    def __init__(self, library_root: Path) -> None:
        self.database_path = library_root / "Database2"
        self.engine = create_engine(
            "sqlite://",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        EngineBase.metadata.create_all(self.engine)
        self._sessions = sessionmaker(bind=self.engine)
        with self.session_m_write() as s:
            s.add(Information(uuid=DB_UUID, schemaVersionMajor=3,
                              schemaVersionMinor=0, schemaVersionPatch=1))

    @contextmanager
    def session_m(self):
        session = self._sessions()
        try:
            yield session
        finally:
            session.close()

    @contextmanager
    def session_m_write(self):
        session = self._sessions()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # real EngineDJDatabase.create_playlist, minimally: recorded for
    # assertion instead of re-testing the linked-list writer here
    def create_playlist(self, title, tracks, parent_id=0):
        self.created_playlists = getattr(self, "created_playlists", [])
        self.created_playlists.append((title, [t.id for t in tracks]))


@pytest.fixture
def library(tmp_path):
    """A fake Engine Library dir + a Tracks dir beside it (the real
    layout: path column is relative to the library root)."""
    root = tmp_path / "Engine Library"
    (root / "Database2").mkdir(parents=True)
    tracks = tmp_path / "Tracks"
    tracks.mkdir()
    return root, tracks


def make_file(tracks_dir: Path, name: str) -> Path:
    p = tracks_dir / name
    p.write_bytes(b"\x00" * 128)
    return p


class TestInsertTrack:
    def test_minimal_insert_full_ritual(self, library):
        root, tracks = library
        edb = InMemoryEngineDB(root)
        audio = make_file(tracks, "song.mp3")

        with edb.session_m_write() as s:
            tid = insert_track(
                s,
                EngineTrackSpec(abs_path=audio, title="Song", artist="A",
                                length_secs=200, bitrate_kbps=320),
                library_root=root,
            )

        with edb.session_m() as s:
            t = s.get(EDJTrack, tid)
            assert t.path == "../Tracks/song.mp3"
            assert t.filename == "song.mp3"
            assert t.fileType == "mp3"
            assert t.fileBytes == 128
            assert t.title == "Song" and t.artist == "A"
            assert t.length == 200 and t.bitrate == 320
            assert t.isAnalyzed is False and t.isAvailable is True
            assert t.isMetadataImported is True
            assert t.rating == 0
            # rendering gate: albumArtId must resolve
            art = s.get(AlbumArt, t.albumArtId)
            assert art is not None and art.hash == "" and art.albumArt is None
            # origin ritual (explicit; real DB does it via trigger)
            assert t.originTrackId == tid
            assert t.originDatabaseUuid == DB_UUID
            # PerformanceData row exists (explicit; real DB via trigger)
            assert s.get(PerformanceData, tid) is not None
            # analysis fields deliberately absent: Engine fills them
            assert t.bpm is None and t.bpmAnalyzed is None and t.key is None

    def test_artless_tracks_share_one_empty_art_row(self, library):
        root, tracks = library
        edb = InMemoryEngineDB(root)
        a = make_file(tracks, "a.mp3")
        b = make_file(tracks, "b.flac")

        with edb.session_m_write() as s:
            t1 = insert_track(s, EngineTrackSpec(abs_path=a, title="a"), root)
            t2 = insert_track(s, EngineTrackSpec(abs_path=b, title="b"), root)

        with edb.session_m() as s:
            r1 = s.get(EDJTrack, t1)
            r2 = s.get(EDJTrack, t2)
            assert r1.albumArtId == r2.albumArtId
            assert s.query(AlbumArt).count() == 1
            assert r2.fileType == "flac"

    def test_get_or_create_is_idempotent(self, library):
        root, _ = library
        edb = InMemoryEngineDB(root)
        with edb.session_m_write() as s:
            first = get_or_create_empty_album_art(s)
            second = get_or_create_empty_album_art(s)
            assert first == second


class TestExportTracksToEngine:
    def test_exports_missing_and_creates_playlist(self, db, make_track, library):
        root, tracks = library
        edb = InMemoryEngineDB(root)
        f1 = make_file(tracks, "one.mp3")
        f2 = make_file(tracks, "two.mp3")
        make_track(filename=str(f1), title="One", artist="X")
        make_track(filename=str(f2), title="Two", artist="Y")

        result = export_tracks_to_engine(db, edb)

        assert result.exported_to_target == 2
        assert result.playlist_created is True
        with edb.session_m() as s:
            paths = {t.path for t in s.query(EDJTrack).all()}
            assert paths == {"../Tracks/one.mp3", "../Tracks/two.mp3"}
        (title, ids), = edb.created_playlists
        assert result.playlist_name == title
        assert len(ids) == 2

    def test_idempotent_rerun_exports_nothing(self, db, make_track, library):
        root, tracks = library
        edb = InMemoryEngineDB(root)
        f1 = make_file(tracks, "one.mp3")
        make_track(filename=str(f1), title="One")

        first = export_tracks_to_engine(db, edb)
        second = export_tracks_to_engine(db, edb)

        assert first.exported_to_target == 1
        assert second.exported_to_target == 0
        assert second.playlist_created is False
        assert second.playlist_name is None
        with edb.session_m() as s:
            assert s.query(EDJTrack).count() == 1

    def test_missing_file_skipped(self, db, make_track, library):
        root, tracks = library
        edb = InMemoryEngineDB(root)
        make_track(filename=str(tracks / "ghost.mp3"), title="Ghost")

        result = export_tracks_to_engine(db, edb)

        assert result.exported_to_target == 0
        assert result.skipped_file_not_found == 1

    def test_archived_tracks_not_exported(self, db, make_track, library):
        root, tracks = library
        edb = InMemoryEngineDB(root)
        f1 = make_file(tracks, "one.mp3")
        t = make_track(filename=str(f1), title="One")
        t.archived_at = __import__("datetime").datetime.now()
        db.commit()

        result = export_tracks_to_engine(db, edb)

        assert result.exported_to_target == 0
