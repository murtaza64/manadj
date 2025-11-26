#!/usr/bin/env python3
"""
Synchronize Rekordbox MyTag data to Engine DJ playlists.

Creates nested 3-level playlist structure:
- Root: "Rekordbox My Tag"
- Level 2: MyTag categories (Genre, Vibe, Energy, etc.)
- Level 3: Individual tags (Drum & Bass, Vocal, etc.)

Usage:
    python scripts/sync_rekordbox_mytags.py
    python scripts/sync_rekordbox_mytags.py --dry-run
    python scripts/sync_rekordbox_mytags.py --engine-db /path/to/Database2
"""

import argparse
from pathlib import Path
from sync import SyncEngine


def main():
    parser = argparse.ArgumentParser(
        description='Sync Rekordbox MyTags to Engine DJ playlists'
    )
    parser.add_argument(
        '--engine-db',
        type=Path,
        default=Path.cwd() / "Engine Library" / "Database2",
        help='Path to Engine DJ Database2 directory'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be done without making changes'
    )

    args = parser.parse_args()

    # Validate paths
    if not args.engine_db.exists():
        print(f"❌ Engine DJ database not found: {args.engine_db}")
        return 1

    print("🎵 Rekordbox MyTag → Engine DJ Playlist Sync")
    print("=" * 60)
    print(f"Engine DJ database: {args.engine_db}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print()

    # Run sync
    sync_engine = SyncEngine(args.engine_db)
    stats = sync_engine.sync(dry_run=args.dry_run, show_preview=True)

    # Print summary
    print()
    print("=" * 60)
    print("📊 Sync Summary:")
    print(f"  Rekordbox tracks with MyTags: {stats['total_rb_tracks']}")
    print(f"  Matched to Engine DJ: {stats['matched_tracks']}")
    print(f"  Unmatched: {stats['unmatched_tracks']}")
    print(f"  Playlists created: {stats['playlists_created']}")
    print(f"  Playlists updated: {stats['playlists_updated']}")
    print()

    return 0


if __name__ == '__main__':
    exit(main())
