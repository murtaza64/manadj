"""Write manadj tags to Rekordbox MyTag."""

from sqlalchemy.orm import Session
from pyrekordbox.db6 import Rekordbox6Database

from rekordbox.tag_sync import RekordboxTagSyncer, TagSyncStats as RBTagSyncStats
from .models import TagSyncStats


class RekordboxTagWriter:
    """Write manadj tags to Rekordbox MyTag.

    Thin wrapper around existing RekordboxTagSyncer.
    """

    def __init__(self, manadj_session: Session, rb_db: Rekordbox6Database):
        self.manadj_session = manadj_session
        self.rb_db = rb_db
        self._syncer = RekordboxTagSyncer(rb_db, manadj_session)

    def sync_tag_structure(
        self,
        dry_run: bool = True,
        include_energy: bool = True
    ) -> TagSyncStats:
        """Sync manadj tags and track assignments to Rekordbox.

        Two-phase sync:
        1. Category/tag structure (DjmdMyTag records)
        2. Track assignments (DjmdSongMyTag records) + colors

        Args:
            dry_run: Preview without writing
            include_energy: Map energy values to MyTag + colors

        Returns:
            Statistics about the sync operation
        """
        # Phase 1: Sync structure
        rb_category_map, rb_tag_map, structure_stats = \
            self._syncer.sync_tag_structure(dry_run=dry_run)

        # Phase 2: Sync track assignments and colors
        if include_energy:
            from rekordbox.mappings import build_energy_color_map
            energy_to_color_id = build_energy_color_map(self.rb_db.session)
        else:
            energy_to_color_id = {}

        track_stats = self._syncer.sync_track_tags_and_colors(
            rb_tag_map,
            energy_to_color_id,
            dry_run=dry_run
        )

        # Merge stats into unified format
        combined_stats = TagSyncStats()

        # Structure stats
        combined_stats.manadj_categories_loaded = structure_stats.manadj_categories
        combined_stats.manadj_tags_loaded = structure_stats.manadj_tags
        combined_stats.categories_created = structure_stats.rb_categories_created
        combined_stats.categories_updated = structure_stats.rb_categories_existing
        combined_stats.tags_created = structure_stats.rb_tags_created
        combined_stats.tags_updated = structure_stats.rb_tags_existing

        # Track stats
        combined_stats.tracks_matched = track_stats.tracks_processed - track_stats.tracks_unmatched
        combined_stats.tracks_unmatched = track_stats.tracks_unmatched
        combined_stats.tracks_updated = track_stats.tracks_updated
        combined_stats.tracks_colored = track_stats.tracks_colored

        return combined_stats
