"""Production SurfaceReaders for the sync_status aggregator.

Each adapter normalizes its Surface's values to the interface conventions
(key = canonical Engine DJ ID, bpm = float BPM) so notation differences can
never appear as divergences.
"""

import logging
from pathlib import Path

from backend.key import Key
from backend.library.scanner import scan_directory
from backend.track_metadata import FileMetadataError, read_file_metadata

from .aggregator import SurfaceReader
from .models import SurfaceTrackRef, TrackFields

logger = logging.getLogger(__name__)


class DiskSurfaceReader:
    """The tracks directory: every audio file, with its file-tag metadata."""

    fields = frozenset({"title", "artist", "key", "bpm"})

    def __init__(self, tracks_directory: str) -> None:
        self._dir = tracks_directory

    def list_tracks(self) -> list[SurfaceTrackRef]:
        refs = []
        for file_path in scan_directory(Path(self._dir)):
            try:
                meta = read_file_metadata(file_path)
            except FileMetadataError as e:
                logger.warning("sync_status: unreadable file skipped: %s", e)
                meta = None
            refs.append(
                SurfaceTrackRef(
                    path=str(file_path),
                    fields=TrackFields(
                        title=meta.title if meta else None,
                        artist=meta.artist if meta else None,
                        key=meta.key if meta else None,
                        bpm=meta.bpm if meta else None,
                    ),
                )
            )
        return refs


class EngineSurfaceReader:
    """Engine DJ: Track rows plus Tag assignments encoded as the
    "manaDJ Tags" playlist tree, plus Hot Cues decoded from the
    PerformanceData blobs."""

    fields = frozenset({"title", "artist", "key", "bpm", "tags", "hotcues"})

    def __init__(self, engine_db) -> None:  # EngineDJDatabase
        self._db = engine_db

    def list_tracks(self) -> list[SurfaceTrackRef]:
        from sqlalchemy.orm import joinedload

        from backend.sync_performance import hotcues_from_performance_blobs
        from enginedj.models.playlist import Playlist
        from enginedj.models.playlist_entity import PlaylistEntity
        from enginedj.models.track import Track as EDJTrack

        with self._db.session_m() as session:
            tags_by_track: dict[int, list[str]] = {}
            root = (
                session.query(Playlist)
                .filter(Playlist.title.in_(["manaDJ Tags", "ManaDJ Tags"]))
                .first()
            )
            if root is not None:
                for tag_pl in session.query(Playlist).filter_by(parentListId=root.id):
                    for entity in session.query(PlaylistEntity).filter_by(listId=tag_pl.id):
                        tags_by_track.setdefault(entity.trackId, []).append(tag_pl.title or "")

            refs = []
            tracks = (
                session.query(EDJTrack)
                .options(joinedload(EDJTrack.performance_data))
                .all()
            )
            for t in tracks:
                bpm = t.bpmAnalyzed if t.bpmAnalyzed is not None else (
                    float(t.bpm) if t.bpm is not None else None
                )
                perf = t.performance_data
                refs.append(
                    SurfaceTrackRef(
                        path=t.path,
                        fields=TrackFields(
                            title=t.title,
                            artist=t.artist,
                            key=t.key,  # already the canonical 0-23 ID
                            bpm=bpm,
                            tags=sorted(tags_by_track.get(t.id, [])),
                            hotcues=hotcues_from_performance_blobs(
                                perf.beatData if perf else None,
                                perf.quickCues if perf else None,
                            ),
                        ),
                    )
                )
            return refs


class RekordboxSurfaceReader:
    """Rekordbox: DjmdContent rows plus MyTag assignments and color-encoded
    energy."""

    fields = frozenset({"title", "artist", "key", "energy", "tags"})

    def __init__(self, rb_db) -> None:  # Rekordbox6Database
        self._db = rb_db

    def list_tracks(self) -> list[SurfaceTrackRef]:
        from pyrekordbox.db6.tables import DjmdMyTag, DjmdSongMyTag

        from rekordbox.mappings import build_energy_color_map

        session = self._db.session
        color_to_energy = {
            color_id: energy
            for energy, color_id in build_energy_color_map(session).items()
        }

        # MyTags under the "Energy" category encode the energy field
        # (rekordbox/tag_sync.py), not Tag assignments — exclude them.
        all_mytags = session.query(DjmdMyTag).all()
        energy_category_ids = {row.ID for row in all_mytags if row.Name == "Energy"}
        mytag_names = {
            row.ID: row.Name
            for row in all_mytags
            if row.ParentID not in energy_category_ids and row.ID not in energy_category_ids
        }
        tags_by_content: dict[str, list[str]] = {}
        for song_tag in session.query(DjmdSongMyTag).all():
            name = mytag_names.get(song_tag.MyTagID)
            if name:
                tags_by_content.setdefault(song_tag.ContentID, []).append(name)

        refs = []
        for c in self._db.get_content():
            key_obj = Key.from_musical(_rb_key_name(c))
            refs.append(
                SurfaceTrackRef(
                    path=c.FolderPath,
                    fields=TrackFields(
                        title=c.Title,
                        artist=_rb_artist_name(c),
                        key=key_obj.engine_id if key_obj else None,
                        energy=color_to_energy.get(c.ColorID),
                        tags=sorted(tags_by_content.get(c.ID, [])),
                    ),
                )
            )
        return refs


def _rb_related(content, relation: str, attr: str) -> str | None:
    """Safely walk a DjmdContent relationship that may be unset or broken."""
    try:
        related = getattr(content, relation)
        return getattr(related, attr) if related else None
    except Exception:
        return None


def _rb_artist_name(content) -> str | None:
    return _rb_related(content, "Artist", "Name")


def _rb_key_name(content) -> str | None:
    return _rb_related(content, "Key", "ScaleName")


def build_surfaces() -> dict[str, SurfaceReader]:
    """Construct whatever SurfaceReaders the current config allows.
    A Surface that can't be reached is simply absent from the result."""
    from backend.config import get_config

    surfaces: dict[str, SurfaceReader] = {}
    config = get_config()

    if config.library.tracks_directory:
        surfaces["disk"] = DiskSurfaceReader(config.library.tracks_directory)

    try:
        if config.database.engine_dj_path:
            from enginedj.connection import EngineDJDatabase

            surfaces["engine"] = EngineSurfaceReader(
                EngineDJDatabase(Path(config.database.engine_dj_path))
            )
    except Exception as e:
        logger.warning("sync_status: Engine DJ surface unavailable: %s", e)

    try:
        if config.database.rekordbox_path:
            from rekordbox.connection import get_rekordbox_db

            surfaces["rekordbox"] = RekordboxSurfaceReader(get_rekordbox_db())
    except Exception as e:
        logger.warning("sync_status: Rekordbox surface unavailable: %s", e)

    return surfaces
