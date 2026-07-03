"""Write manadj tags to Engine DJ as flat playlist structure."""

from sqlalchemy.orm import Session

from enginedj.connection import EngineDJDatabase
from enginedj.models.track import Track as EDJTrack
from enginedj.models.information import Information as EDJInformation
from backend.crud import get_tag_categories, get_tags_by_category
from backend.sync_common.matching import TrackIndex
from enginedj.sync import edj_path
from enginedj.playlist import (
    get_tracks_by_tag,
    find_playlist_by_title_and_parent,
    create_or_update_playlist
)
from .models import TagSyncStats


class EngineTagWriter:
    """Write manadj tags to Engine DJ as flat playlist structure.

    Creates/updates flat structure:
    "manaDJ Tags" > Tag1, Tag2, Tag3, ... (all tags directly under root)
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
            fresh: Delete existing "manaDJ Tags" and recreate

        Returns:
            Statistics about the sync operation
        """
        stats = TagSyncStats()

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
            edj_index = TrackIndex.build(edj_tracks, edj_path)

            # Get database UUID
            info = edj_session.query(EDJInformation).first()
            db_uuid = info.uuid if info else ""

            # Find or create root playlist
            root_id = self._find_or_create_root(
                edj_session, db_uuid, dry_run, fresh, stats
            )

            # Collect all tags from all categories
            all_tags = []
            for category in categories:
                tags = get_tags_by_category(self.manadj_session, category.id)
                all_tags.extend(tags)

            # Sort alphabetically by name
            all_tags.sort(key=lambda t: t.name.lower())

            # Sync all tags directly under root
            for tag in all_tags:
                self._sync_tag(
                    edj_session,
                    tag,
                    root_id,
                    db_uuid,
                    dry_run,
                    edj_index,
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
        """Find or create root "manaDJ Tags" playlist.

        Returns:
            Playlist ID or None if dry_run
        """
        if dry_run:
            return None

        # Check if fresh mode - delete existing
        if fresh:
            existing = find_playlist_by_title_and_parent(
                edj_session, "manaDJ Tags", 0
            )
            if existing:
                # Delete will cascade to children via Engine DJ constraints
                edj_session.delete(existing)
                edj_session.flush()

        # Find or create
        playlist, created = create_or_update_playlist(
            edj_session,
            title="manaDJ Tags",
            parent_id=0,
            edj_tracks=[],  # Root has no tracks
            db_uuid=db_uuid
        )

        return playlist.id

    def _sync_tag(
        self,
        edj_session,
        tag,
        root_id: int | None,
        db_uuid: str,
        dry_run: bool,
        edj_index: TrackIndex,
        stats: TagSyncStats
    ):
        """Sync a single tag to Engine DJ directly under root."""
        # Get tracks with this tag
        manadj_tracks = get_tracks_by_tag(self.manadj_session, tag.id)

        if not manadj_tracks:
            return

        # Match tracks to Engine DJ
        matched_edj_tracks = []
        unmatched = []

        for track in manadj_tracks:
            edj_track = edj_index.match(track.filename)
            if edj_track:
                matched_edj_tracks.append(edj_track)
            else:
                unmatched.append(track)

        stats.tracks_matched += len(matched_edj_tracks)
        stats.tracks_unmatched += len(unmatched)

        # Create/update playlist directly under root
        if not dry_run and root_id and matched_edj_tracks:
            tag_playlist, tag_created = create_or_update_playlist(
                edj_session,
                title=tag.name,
                parent_id=root_id,
                edj_tracks=matched_edj_tracks,
                db_uuid=db_uuid
            )

            if tag_created:
                stats.tags_created += 1
            else:
                stats.tags_updated += 1
