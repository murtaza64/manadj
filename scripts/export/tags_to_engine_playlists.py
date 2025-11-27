#!/usr/bin/env python3
"""
CLI wrapper for syncing manadj tags to Engine DJ playlists.

Creates a 3-level nested playlist structure:
- Root: "manadj Tags"
- Level 2: Tag categories (Genre, Vibe, Energy, etc.)
- Level 3: Individual tags with tracks

Usage:
    python scripts/export/tags_to_engine_playlists.py                    # Dry-run
    python scripts/export/tags_to_engine_playlists.py --apply            # Apply changes
    python scripts/export/tags_to_engine_playlists.py --apply --fresh    # Delete and recreate
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from enginedj.connection import EngineDJDatabase
from backend.database import SessionLocal
from backend.tags.sync_manager import TagSyncManager


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
        print("🎵 Syncing manadj tags to Engine DJ playlists")
        print("=" * 70)
        if not args.apply:
            print("DRY RUN MODE - No changes will be made")
        print()

        # Create manager and sync
        manager = TagSyncManager(manadj_db, engine_db=edj_db)
        stats = manager.sync_to_engine(
            dry_run=not args.apply,
            fresh=args.fresh
        )

        # Print report
        print("=" * 70)
        print("SYNC SUMMARY")
        print("=" * 70)
        print(f"Categories created: {stats.categories_created}")
        print(f"Categories updated: {stats.categories_updated}")
        print(f"Tags created: {stats.tags_created}")
        print(f"Tags updated: {stats.tags_updated}")
        print(f"Tracks matched: {stats.tracks_matched}")
        print(f"Tracks unmatched: {stats.tracks_unmatched}")
        print()

        if not args.apply:
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
