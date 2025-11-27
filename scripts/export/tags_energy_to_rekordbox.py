#!/usr/bin/env python3
"""
Synchronize manadj tags to Rekordbox MyTag.

manadj is the source of truth - this script ensures Rekordbox MyTag structure
matches manadj, and overwrites Rekordbox track tag assignments with manadj tags.

Usage:
    python scripts/sync_tags_to_rekordbox.py                    # Dry-run
    python scripts/sync_tags_to_rekordbox.py --apply            # Apply changes
    python scripts/sync_tags_to_rekordbox.py --rekordbox-db /path
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.utils import get_rekordbox_pid

from backend.database import SessionLocal
from rekordbox.mappings import build_energy_color_map
from rekordbox.tag_sync import RekordboxTagSyncer


def print_mytag_structure(syncer: RekordboxTagSyncer):
    """Print current Rekordbox MyTag structure."""
    print("📋 Current Rekordbox MyTag Structure:")
    structure = syncer.get_mytag_structure_preview()

    if structure:
        for cat_name, cat_id, cat_seq, tags in structure:
            print(f"  Category: {cat_name} (ID={cat_id}, Seq={cat_seq})")
            for tag_name, tag_id, tag_seq in tags:
                print(f"    - {tag_name} (ID={tag_id}, Seq={tag_seq})")
    else:
        print("  (No categories found)")
    print()


def print_color_mapping(energy_to_color_id: dict[int, str]):
    """Print energy to color mapping."""
    print("🎨 Building energy to color mapping...")

    if energy_to_color_id:
        print("  Energy to Color Mapping:")
        for energy in sorted(energy_to_color_id.keys()):
            color_id = energy_to_color_id[energy]
            print(f"    Energy {energy} → ColorID {color_id}")

    missing = set(range(1, 6)) - set(energy_to_color_id.keys())
    if missing:
        print(f"  ⚠️  Missing color mappings for energy levels: {missing}")
    print()


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

        if args.rekordbox_db:
            rb_db = Rekordbox6Database(db_dir=args.rekordbox_db)
        else:
            rb_db = Rekordbox6Database()

        manadj_db = SessionLocal()

        print(f"Rekordbox database: {rb_db.db_directory}")
        print()
    except Exception as e:
        print(f"❌ Failed to connect to databases: {e}")
        return 1

    try:
        # Initialize syncer
        syncer = RekordboxTagSyncer(rb_db, manadj_db)

        # Preview existing structure
        print_mytag_structure(syncer)

        # Build energy to color mapping
        energy_to_color_id = build_energy_color_map(rb_db.session)
        print_color_mapping(energy_to_color_id)

        # Phase 1: Sync tag structure
        print("📊 Phase 1: Syncing tag structure...")
        rb_category_map, rb_tag_map, structure_stats = syncer.sync_tag_structure(
            dry_run=not args.apply
        )

        print(f"  manadj categories: {structure_stats.manadj_categories}")
        print(f"  manadj tags: {structure_stats.manadj_tags}")
        print(f"  Rekordbox categories created: {structure_stats.rb_categories_created}")
        print(f"  Rekordbox categories existing: {structure_stats.rb_categories_existing}")
        print(f"  Rekordbox tags created: {structure_stats.rb_tags_created}")
        print(f"  Rekordbox tags existing: {structure_stats.rb_tags_existing}")
        print()

        # Phase 2: Sync track tags and colors
        print("📊 Phase 2: Syncing track tags and colors...")
        track_stats = syncer.sync_track_tags_and_colors(
            rb_tag_map,
            energy_to_color_id,
            dry_run=not args.apply
        )

        print(f"  Tracks processed: {track_stats.tracks_processed}")
        print(f"  Tracks updated: {track_stats.tracks_updated}")
        print(f"  Tracks colored: {track_stats.tracks_colored}")
        if track_stats.tracks_color_cleared > 0:
            print(f"  Tracks color cleared: {track_stats.tracks_color_cleared}")
        print(f"  Tracks unmatched: {track_stats.tracks_unmatched}")
        if track_stats.tracks_warned > 0:
            print(f"  ⚠️  Tracks tagged in RB but not manadj: {track_stats.tracks_warned}")
        print()

        # Commit
        if args.apply:
            rb_db.commit(autoinc=True)
            print("✅ Changes committed to Rekordbox database")

        # Summary
        print("=" * 70)
        print("📊 Summary:")
        if args.apply:
            print(f"  Categories synced: {structure_stats.rb_categories_created + structure_stats.rb_categories_existing}")
            print(f"  Tags synced: {structure_stats.rb_tags_created + structure_stats.rb_tags_existing}")
            print(f"  Track assignments updated: {track_stats.tracks_updated}")
        else:
            print(f"  Would create {structure_stats.rb_categories_created} categories")
            print(f"  Would create {structure_stats.rb_tags_created} tags")
            print(f"  Would update {track_stats.tracks_updated} track assignments")
            print()
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
