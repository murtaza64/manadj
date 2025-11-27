"""Write manadj tags to Engine DJ as playlist hierarchy."""

from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from enginedj.connection import EngineDJDatabase
from enginedj.models.track import Track as EDJTrack
from enginedj.models.information import Information as EDJInformation
from backend.models import Track as ManAdjTrack
from backend.crud import get_tag_categories, get_tags_by_category
from enginedj.sync import index_engine_tracks, match_track
from enginedj.playlist import (
    get_tracks_by_tag,
    find_playlist_by_title_and_parent,
    create_or_update_playlist
)
from .models import TagSyncStats


class EngineTagWriter:
    """Write manadj tags to Engine DJ as playlist hierarchy.

    Creates/updates 3-level hierarchy:
    "manadj Tags" > Category > Tag (with tracks)
    """

    def __init__(self, manadj_session: Session, engine_db: EngineDJDatabase):
        self.manadj_session = manadj_session
        self.engine_db = engine_db

    def sync_tag_structure(
        self,
        dry_run: bool = True,
        fresh: bool = False
    ) -> TagSyncStats:
        """Sync manadj tags to Engine DJ playlists.

        Args:
            dry_run: Preview without writing
            fresh: Delete existing "manadj Tags" and recreate

        Returns:
            Statistics about the sync operation
        """
        stats = TagSyncStats()

        # Track matching indices (cached)
        edj_tracks_by_path = {}
        edj_tracks_by_filename = {}

        # Get all categories
        categories = get_tag_categories(self.manadj_session)
        if not categories:
            return stats

        # Open Engine DJ session
        session_context = (
            self.engine_db.session_m_write() if not dry_run
            else self.engine_db.session_m()
        )

        with session_context as edj_session:
            # Initialize track matching
            edj_tracks = edj_session.query(EDJTrack).all()
            edj_tracks_by_path, edj_tracks_by_filename = \
                index_engine_tracks(edj_tracks)

            # Get database UUID
            info = edj_session.query(EDJInformation).first()
            db_uuid = info.uuid if info else ""

            # Find or create root playlist
            root_id = self._find_or_create_root(
                edj_session, db_uuid, dry_run, fresh, stats
            )

            # Sync each category
            for category in categories:
                self._sync_category(
                    edj_session,
                    category,
                    root_id or 0,
                    db_uuid,
                    dry_run,
                    edj_tracks_by_path,
                    edj_tracks_by_filename,
                    stats
                )

        return stats

    def _find_or_create_root(
        self,
        edj_session,
        db_uuid: str,
        dry_run: bool,
        fresh: bool,
        stats: TagSyncStats
    ) -> int | None:
        """Find or create root "manadj Tags" playlist.

        Returns:
            Playlist ID or None if dry_run
        """
        if dry_run:
            # Check if exists for reporting
            existing = find_playlist_by_title_and_parent(
                edj_session, "manadj Tags", 0
            )
            return None

        # Check if fresh mode - delete existing
        if fresh:
            existing = find_playlist_by_title_and_parent(
                edj_session, "manadj Tags", 0
            )
            if existing:
                # Delete will cascade to children via Engine DJ constraints
                edj_session.delete(existing)
                edj_session.flush()

        # Find or create
        playlist, created = create_or_update_playlist(
            edj_session,
            title="manadj Tags",
            parent_id=0,
            edj_tracks=[],  # Root has no tracks
            db_uuid=db_uuid
        )

        if created:
            stats.categories_created += 1

        return playlist.id

    def _sync_category(
        self,
        edj_session,
        category,
        root_id: int,
        db_uuid: str,
        dry_run: bool,
        edj_tracks_by_path: dict,
        edj_tracks_by_filename: dict,
        stats: TagSyncStats
    ):
        """Sync a single tag category to Engine DJ."""
        # Get all tags in this category
        tags = get_tags_by_category(self.manadj_session, category.id)

        if not tags:
            return

        # Find or create category playlist
        if not dry_run:
            category_playlist, cat_created = create_or_update_playlist(
                edj_session,
                title=category.name,
                parent_id=root_id,
                edj_tracks=[],  # Category playlist has no tracks
                db_uuid=db_uuid
            )

            if cat_created:
                stats.categories_created += 1
            else:
                stats.categories_updated += 1

            category_id = category_playlist.id
        else:
            category_id = None

        # Sync each tag in this category
        for tag in tags:
            self._sync_tag(
                edj_session,
                tag,
                category_id,
                db_uuid,
                dry_run,
                edj_tracks_by_path,
                edj_tracks_by_filename,
                stats
            )

    def _sync_tag(
        self,
        edj_session,
        tag,
        category_playlist_id: int | None,
        db_uuid: str,
        dry_run: bool,
        edj_tracks_by_path: dict,
        edj_tracks_by_filename: dict,
        stats: TagSyncStats
    ):
        """Sync a single tag to Engine DJ."""
        # Get tracks with this tag
        manadj_tracks = get_tracks_by_tag(self.manadj_session, tag.id)

        if not manadj_tracks:
            return

        # Match tracks to Engine DJ
        matched_edj_tracks = []
        unmatched = []

        for track in manadj_tracks:
            edj_track = match_track(
                track,
                edj_tracks_by_path,
                edj_tracks_by_filename
            )
            if edj_track:
                matched_edj_tracks.append(edj_track)
            else:
                unmatched.append(track)

        stats.tracks_matched += len(matched_edj_tracks)
        stats.tracks_unmatched += len(unmatched)

        # Create/update playlist
        if not dry_run and category_playlist_id and matched_edj_tracks:
            tag_playlist, tag_created = create_or_update_playlist(
                edj_session,
                title=tag.name,
                parent_id=category_playlist_id,
                edj_tracks=matched_edj_tracks,
                db_uuid=db_uuid
            )

            if tag_created:
                stats.tags_created += 1
            else:
                stats.tags_updated += 1
