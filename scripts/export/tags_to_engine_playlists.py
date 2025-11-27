#!/usr/bin/env python3
"""
Sync manadj tags to Engine DJ playlists.

Creates a 3-level nested playlist structure:
- Root: "manadj Tags"
- Level 2: Tag categories (Genre, Vibe, Energy, etc.)
- Level 3: Individual tags with tracks

Usage:
    python scripts/sync_tags_to_engine.py                    # Dry-run
    python scripts/sync_tags_to_engine.py --apply            # Apply changes
    python scripts/sync_tags_to_engine.py --apply --fresh    # Delete and recreate
"""

import argparse
import sys
from pathlib import Path
from dataclasses import dataclass, field

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from enginedj.connection import EngineDJDatabase
from enginedj.models.track import Track as EDJTrack
from enginedj.models.information import Information as EDJInformation

from backend.database import SessionLocal
from backend.models import Track as ManAdjTrack, Tag, TagCategory
from backend.crud import get_tag_categories, get_tags_by_category
from enginedj.sync import (
    index_engine_tracks,
    match_track,
)
from enginedj.playlist import (
    get_tracks_by_tag,
    find_playlist_by_title_and_parent,
    create_or_update_playlist
)


@dataclass
class SyncStats:
    """Statistics for tag sync operation."""
    categories_processed: int = 0
    tags_processed: int = 0
    playlists_created: int = 0
    playlists_updated: int = 0
    tracks_matched: int = 0
    tracks_unmatched: int = 0
    unmatched_by_tag: dict[str, list[str]] = field(default_factory=dict)


class TagToPlaylistSyncer:
    """Syncs manadj tags to Engine DJ playlists."""

    def __init__(
        self,
        manadj_session,
        edj_db: EngineDJDatabase,
        dry_run: bool = True,
        fresh: bool = False
    ):
        self.manadj_session = manadj_session
        self.edj_db = edj_db
        self.dry_run = dry_run
        self.fresh = fresh
        self.stats = SyncStats()

        # Track matching indices (cached)
        self.edj_tracks_by_path = {}
        self.edj_tracks_by_filename = {}

    def _init_track_indices(self, edj_session):
        """Initialize Engine DJ track lookup indices."""
        edj_tracks = edj_session.query(EDJTrack).all()
        self.edj_tracks_by_path, self.edj_tracks_by_filename = \
            index_engine_tracks(edj_tracks)

    def _match_tracks(
        self,
        manadj_tracks: list[ManAdjTrack]
    ) -> tuple[list[EDJTrack], list[ManAdjTrack]]:
        """
        Match manadj tracks to Engine DJ tracks.

        Returns:
            Tuple of (matched EDJ tracks, unmatched manadj tracks)
        """
        matched = []
        unmatched = []

        for track in manadj_tracks:
            edj_track = match_track(
                track,
                self.edj_tracks_by_path,
                self.edj_tracks_by_filename
            )
            if edj_track:
                matched.append(edj_track)
            else:
                unmatched.append(track)

        return matched, unmatched

    def _find_or_create_root(self, edj_session, db_uuid: str) -> int | None:
        """
        Find or create root "manadj Tags" playlist.

        Returns:
            Playlist ID or None if dry_run
        """
        if self.dry_run:
            # Check if exists for reporting
            existing = find_playlist_by_title_and_parent(
                edj_session, "manadj Tags", 0
            )
            if existing:
                print("  Root playlist 'manadj Tags' already exists")
            else:
                print("  Would create root playlist 'manadj Tags'")
            return None

        # Check if fresh mode - delete existing
        if self.fresh:
            existing = find_playlist_by_title_and_parent(
                edj_session, "manadj Tags", 0
            )
            if existing:
                print("  Deleting existing 'manadj Tags' hierarchy...")
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
            self.stats.playlists_created += 1
            print("  Created root playlist 'manadj Tags'")
        else:
            print("  Using existing root playlist 'manadj Tags'")

        return playlist.id

    def _sync_category(
        self,
        edj_session,
        category: TagCategory,
        root_id: int,
        db_uuid: str
    ):
        """Sync a single tag category to Engine DJ."""
        print(f"  Category: {category.name}")

        # Get all tags in this category
        tags = get_tags_by_category(self.manadj_session, category.id)

        if not tags:
            print(f"    (No tags in category)")
            return

        # Find or create category playlist
        if not self.dry_run:
            category_playlist, cat_created = create_or_update_playlist(
                edj_session,
                title=category.name,
                parent_id=root_id,
                edj_tracks=[],  # Category playlist has no tracks
                db_uuid=db_uuid
            )

            if cat_created:
                self.stats.playlists_created += 1
            else:
                self.stats.playlists_updated += 1

            category_id = category_playlist.id
        else:
            # Dry-run: check if exists
            existing = find_playlist_by_title_and_parent(
                edj_session, category.name, root_id or 0
            )
            if existing:
                print(f"    Category playlist exists, would update")
            else:
                print(f"    Would create category playlist")
            category_id = None

        # Sync each tag in this category
        for tag in tags:
            self._sync_tag(edj_session, tag, category, category_id, db_uuid)

        self.stats.categories_processed += 1

    def _sync_tag(
        self,
        edj_session,
        tag: Tag,
        category: TagCategory,
        category_playlist_id: int | None,
        db_uuid: str
    ):
        """Sync a single tag to Engine DJ."""
        # Get tracks with this tag
        manadj_tracks = get_tracks_by_tag(self.manadj_session, tag.id)

        if not manadj_tracks:
            print(f"    {tag.name}: (no tracks, skipping)")
            return

        # Match tracks to Engine DJ
        matched_edj_tracks, unmatched = self._match_tracks(manadj_tracks)

        self.stats.tracks_matched += len(matched_edj_tracks)
        self.stats.tracks_unmatched += len(unmatched)

        # Track unmatched for reporting
        if unmatched:
            tag_path = f"{category.name} > {tag.name}"
            self.stats.unmatched_by_tag[tag_path] = [
                Path(t.filename).name for t in unmatched
            ]

        print(f"    {tag.name}: {len(matched_edj_tracks)} matched, "
              f"{len(unmatched)} unmatched")

        # Create/update playlist
        if not self.dry_run and category_playlist_id and matched_edj_tracks:
            tag_playlist, tag_created = create_or_update_playlist(
                edj_session,
                title=tag.name,
                parent_id=category_playlist_id,
                edj_tracks=matched_edj_tracks,
                db_uuid=db_uuid
            )

            if tag_created:
                self.stats.playlists_created += 1
            else:
                self.stats.playlists_updated += 1
        elif self.dry_run and matched_edj_tracks:
            # Check if exists in dry-run
            if category_playlist_id is None:
                # Can't check without parent ID
                print(f"      Would create/update tag playlist")
            else:
                existing = find_playlist_by_title_and_parent(
                    edj_session, tag.name, category_playlist_id
                )
                if existing:
                    print(f"      Tag playlist exists, would update")
                else:
                    print(f"      Would create tag playlist")

        self.stats.tags_processed += 1

    def sync(self):
        """Main sync operation."""
        print("🎵 Syncing manadj tags to Engine DJ playlists")
        print("=" * 70)
        print()

        # Get all categories
        categories = get_tag_categories(self.manadj_session)

        if not categories:
            print("No tag categories found in manadj")
            return

        print(f"Found {len(categories)} tag categories")
        print()

        # Open Engine DJ session
        session_context = (
            self.edj_db.session_m_write() if not self.dry_run
            else self.edj_db.session_m()
        )

        with session_context as edj_session:
            # Initialize track matching
            print("Indexing Engine DJ tracks...")
            self._init_track_indices(edj_session)
            print(f"  {len(self.edj_tracks_by_path)} tracks indexed")
            print()

            # Get database UUID
            info = edj_session.query(EDJInformation).first()
            db_uuid = info.uuid if info else ""

            # Find or create root playlist
            print("Root playlist:")
            root_id = self._find_or_create_root(edj_session, db_uuid)
            print()

            if self.dry_run:
                print("DRY RUN MODE - No changes will be made")
                print()

            # Sync each category
            for category in categories:
                self._sync_category(edj_session, category, root_id or 0, db_uuid)
                print()

    def print_report(self):
        """Print summary report."""
        print("=" * 70)
        print("SYNC SUMMARY")
        print("=" * 70)
        print(f"Categories processed: {self.stats.categories_processed}")
        print(f"Tags processed: {self.stats.tags_processed}")
        print(f"Playlists created: {self.stats.playlists_created}")
        print(f"Playlists updated: {self.stats.playlists_updated}")
        print(f"Tracks matched: {self.stats.tracks_matched}")
        print(f"Tracks unmatched: {self.stats.tracks_unmatched}")
        print()

        # Show unmatched tracks by tag
        if self.stats.unmatched_by_tag:
            print("UNMATCHED TRACKS BY TAG")
            print("-" * 70)
            for tag_path, filenames in self.stats.unmatched_by_tag.items():
                print(f"{tag_path}:")
                for filename in filenames[:5]:  # Show first 5
                    print(f"  - {filename}")
                if len(filenames) > 5:
                    print(f"  ... and {len(filenames) - 5} more")
                print()


def main():
    parser = argparse.ArgumentParser(
        description='Sync manadj tags to Engine DJ playlists'
    )
    parser.add_argument(
        '--engine-db',
        type=Path,
        default=Path(__file__).parent.parent / "data" / "Engine Library" / "Database2",
        help='Path to Engine DJ Database2 directory (default: data/Engine Library/Database2)'
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply changes (default is dry-run mode)'
    )
    parser.add_argument(
        '--fresh',
        action='store_true',
        help='Delete existing "manadj Tags" hierarchy and recreate'
    )

    args = parser.parse_args()

    # Validate Engine DJ database
    if not args.engine_db.exists():
        print(f"❌ Engine DJ database not found: {args.engine_db}")
        print(f"   Please specify correct path with --engine-db")
        return 1

    # Connect to databases
    try:
        edj_db = EngineDJDatabase(args.engine_db)
        manadj_db = SessionLocal()
    except Exception as e:
        print(f"❌ Failed to connect to databases: {e}")
        return 1

    try:
        # Run sync
        syncer = TagToPlaylistSyncer(
            manadj_db,
            edj_db,
            dry_run=not args.apply,
            fresh=args.fresh
        )
        syncer.sync()
        syncer.print_report()

        if not args.apply:
            print()
            print("Use --apply to execute these changes.")

        return 0

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        manadj_db.close()


if __name__ == '__main__':
    sys.exit(main())
