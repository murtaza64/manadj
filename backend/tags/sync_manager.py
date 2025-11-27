"""Tag sync manager - orchestration class."""

from sqlalchemy.orm import Session

from .models import TagStructure, UnifiedTagView, TagSyncStats
from .comparison import match_tags_by_name
from .manadj_reader import ManAdjTagReader


class TagSyncManager:
    """Orchestrates tag structure loading, comparison, and syncing.

    Handles optional Engine DJ and Rekordbox databases with graceful degradation.
    """

    def __init__(
        self,
        manadj_session: Session,
        engine_db=None,
        rb_db=None
    ):
        """Initialize with database connections.

        Args:
            manadj_session: Required manadj SQLAlchemy session
            engine_db: Optional EngineDJDatabase instance
            rb_db: Optional Rekordbox6Database instance
        """
        # Always create manadj reader
        self.manadj_reader = ManAdjTagReader(manadj_session)
        self.manadj_session = manadj_session

        # Conditionally create Engine DJ reader/writer
        self.engine_reader = None
        self.engine_writer = None
        if engine_db:
            from enginedj.tag_reader import EngineTagReader
            from .engine_writer import EngineTagWriter
            self.engine_reader = EngineTagReader(engine_db)
            self.engine_writer = EngineTagWriter(manadj_session, engine_db)

        # Conditionally create Rekordbox reader/writer
        self.rb_reader = None
        self.rb_writer = None
        if rb_db:
            from rekordbox.tag_reader import RekordboxTagReader
            from .rekordbox_writer import RekordboxTagWriter
            self.rb_reader = RekordboxTagReader(rb_db)
            self.rb_writer = RekordboxTagWriter(manadj_session, rb_db)

    def load_all_tag_structures(self) -> dict[str, TagStructure | None]:
        """Load tag structures from all available sources.

        Returns:
            Dictionary with keys 'manadj', 'engine', 'rekordbox' and
            TagStructure values (or None if not available)
        """
        result = {'manadj': None, 'engine': None, 'rekordbox': None}

        # Always load manadj
        result['manadj'] = self.manadj_reader.get_tag_structure()

        # Load Engine DJ if available
        if self.engine_reader:
            result['engine'] = self.engine_reader.get_tag_structure()

        # Load Rekordbox if available
        if self.rb_reader:
            result['rekordbox'] = self.rb_reader.get_tag_structure()

        return result

    def get_unified_view(self) -> list[UnifiedTagView]:
        """Get unified view of all tags for API response.

        Matches tags by (category_name, tag_name) across sources.

        Returns:
            List of UnifiedTagView objects for UI display
        """
        # Load all tag structures
        structures = self.load_all_tag_structures()

        # Match by name
        matched = match_tags_by_name(structures)

        # Convert to UnifiedTagView objects
        result = []
        for (category_name, tag_name), sources in matched.items():
            # Check if synced (tag exists in all non-None sources)
            synced = self._check_if_synced(sources)

            unified = UnifiedTagView(
                category_name=category_name,
                tag_name=tag_name,
                manadj=sources.get('manadj'),
                engine=sources.get('engine'),
                rekordbox=sources.get('rekordbox'),
                synced=synced
            )
            result.append(unified)

        return result

    def _check_if_synced(self, sources: dict[str, any]) -> bool:
        """Check if tag is synced across available sources.

        manadj is the source of truth. A tag is synced if:
        - It exists in manadj (required)
        - ALL other configured sources (Engine DJ, Rekordbox) exist AND have exact same track count

        Args:
            sources: Dictionary with 'manadj', 'engine', 'rekordbox' keys

        Returns:
            True if tag exists in manadj and ALL configured sources have matching track counts
        """
        manadj_tag = sources.get('manadj')
        if not manadj_tag:
            # No manadj tag means not synced (manadj is source of truth)
            return False

        # Check Engine DJ - must exist if configured
        if self.engine_reader:
            engine_tag = sources.get('engine')
            if engine_tag is None:
                # Engine DJ configured but tag doesn't exist there
                return False
            if engine_tag.track_count != manadj_tag.track_count:
                return False

        # Check Rekordbox - must exist if configured
        if self.rb_reader:
            rb_tag = sources.get('rekordbox')
            if rb_tag is None:
                # Rekordbox configured but tag doesn't exist there
                return False
            if rb_tag.track_count != manadj_tag.track_count:
                return False

        return True

    def get_stats(self) -> TagSyncStats:
        """Get loading and comparison statistics.

        Returns:
            TagSyncStats with counts from all sources
        """
        # Load all tag structures
        structures = self.load_all_tag_structures()

        # Match by name
        matched = match_tags_by_name(structures)

        # Calculate stats
        stats = TagSyncStats()

        # Loading stats
        if structures['manadj']:
            stats.manadj_categories_loaded = len(structures['manadj'].categories)
            stats.manadj_tags_loaded = structures['manadj'].total_tags

        if structures['engine']:
            stats.engine_playlists_scanned = len(structures['engine'].categories)
            stats.engine_tags_found = structures['engine'].total_tags

        if structures['rekordbox']:
            stats.rekordbox_categories_loaded = len(structures['rekordbox'].categories)
            stats.rekordbox_tags_loaded = structures['rekordbox'].total_tags

        # Matching stats
        stats.tags_matched = len(matched)

        # Count unique tags per source (exists in only one source)
        for (cat_name, tag_name), sources in matched.items():
            has_manadj = sources.get('manadj') is not None
            has_engine = sources.get('engine') is not None
            has_rekordbox = sources.get('rekordbox') is not None

            if has_manadj and not has_engine and not has_rekordbox:
                stats.tags_unique_manadj += 1
            elif has_engine and not has_manadj and not has_rekordbox:
                stats.tags_unique_engine += 1
            elif has_rekordbox and not has_manadj and not has_engine:
                stats.tags_unique_rekordbox += 1

        return stats

    # WRITE OPERATIONS

    def sync_to_engine(
        self,
        dry_run: bool = True,
        fresh: bool = False
    ) -> TagSyncStats:
        """Sync manadj tags to Engine DJ.

        Args:
            dry_run: Preview without writing
            fresh: Delete existing and recreate

        Returns:
            Statistics about the sync operation

        Raises:
            ValueError: If Engine DJ not configured
        """
        if not self.engine_writer:
            raise ValueError("Engine DJ not configured")
        return self.engine_writer.sync_tag_structure(dry_run, fresh)

    def sync_to_rekordbox(
        self,
        dry_run: bool = True,
        include_energy: bool = True
    ) -> TagSyncStats:
        """Sync manadj tags to Rekordbox.

        Args:
            dry_run: Preview without writing
            include_energy: Include energy tag/color mapping

        Returns:
            Statistics about the sync operation

        Raises:
            ValueError: If Rekordbox not configured
        """
        if not self.rb_writer:
            raise ValueError("Rekordbox not configured")
        return self.rb_writer.sync_tag_structure(dry_run, include_energy)
