#!/usr/bin/env python3
"""
CLI wrapper for syncing manadj tags to Rekordbox MyTag.

manadj is the source of truth - this script ensures Rekordbox MyTag structure
matches manadj, and overwrites Rekordbox track tag assignments with manadj tags.

Usage:
    python scripts/export/tags_energy_to_rekordbox.py                    # Dry-run
    python scripts/export/tags_energy_to_rekordbox.py --apply            # Apply changes
    python scripts/export/tags_energy_to_rekordbox.py --rekordbox-db /path
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from pyrekordbox.utils import get_rekordbox_pid

from backend.database import SessionLocal
from backend.tags.sync_manager import TagSyncManager
from rekordbox.connection import get_rekordbox_db


def main():
    parser = argparse.ArgumentParser(
        description='Sync manadj tags to Rekordbox MyTag'
    )
    parser.add_argument(
        '--rekordbox-db',
        type=Path,
        help='Path to Rekordbox database directory (default: auto-detect)'
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply changes (default is dry-run mode)'
    )

    args = parser.parse_args()

    # Print header
    print("🏷️  manadj → Rekordbox MyTag Sync")
    print("=" * 70)
    print(f"Mode: {'APPLY CHANGES' if args.apply else 'DRY RUN (use --apply to commit changes)'}")
    print()

    # Connect to databases
    try:
        if get_rekordbox_pid():
            print("❌ Rekordbox is running. Please close Rekordbox before syncing.")
            return 1

        rb_db = get_rekordbox_db(args.rekordbox_db)

        manadj_db = SessionLocal()

        print(f"Rekordbox database: {rb_db.db_directory}")
        print()
    except Exception as e:
        print(f"❌ Failed to connect to databases: {e}")
        return 1

    try:
        # Create manager and sync
        manager = TagSyncManager(manadj_db, rb_db=rb_db)
        stats = manager.sync_to_rekordbox(
            dry_run=not args.apply,
            include_energy=True
        )

        # Commit if applying
        if args.apply:
            rb_db.commit(autoinc=True)
            print("✅ Changes committed to Rekordbox database")
            print()

        # Print summary
        print("=" * 70)
        print("SYNC SUMMARY")
        print("=" * 70)
        print(f"manadj categories loaded: {stats.manadj_categories_loaded}")
        print(f"manadj tags loaded: {stats.manadj_tags_loaded}")
        print(f"Categories created: {stats.categories_created}")
        print(f"Categories updated: {stats.categories_updated}")
        print(f"Tags created: {stats.tags_created}")
        print(f"Tags updated: {stats.tags_updated}")
        print(f"Tracks updated: {stats.tracks_updated}")
        print(f"Tracks colored: {stats.tracks_colored}")
        print(f"Tracks unmatched: {stats.tracks_unmatched}")
        print()

        if not args.apply:
            print("Use --apply to execute these changes.")
            print()

        return 0

    except Exception as e:
        print(f"❌ Error during sync: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        manadj_db.close()
        rb_db.close()


if __name__ == '__main__':
    sys.exit(main())
