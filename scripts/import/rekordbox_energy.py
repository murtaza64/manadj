#!/usr/bin/env python3
"""
Import energy levels from Rekordbox track colors.

Maps track colors to energy levels:
- Yellow (ColorID=4) → Energy 1
- Orange (ColorID=3) → Energy 3
- Red (ColorID=2) → Energy 5
- Other colors → Ignored

Only updates tracks that currently have NULL energy values.

Usage:
    uv run scripts/import_energy_from_rekordbox_color.py
    uv run scripts/import_energy_from_rekordbox_color.py --dry-run
"""

import argparse
from pathlib import Path
from sqlalchemy.orm import Session
from rekordbox import RekordboxReader
from backend.database import SessionLocal
from backend.models import Track


# Color ID to energy level mapping
COLOR_TO_ENERGY = {
    "4": 1,  # Yellow → Low energy
    "3": 3,  # Orange → Medium energy
    "2": 5,  # Red → High energy
}


def import_energy_from_colors(dry_run: bool = False) -> dict:
    """
    Import energy levels from Rekordbox track colors.

    Args:
        dry_run: If True, show what would be done without making changes

    Returns:
        Statistics dictionary with import results
    """
    stats = {
        "total_rb_tracks": 0,
        "tracks_with_mapped_colors": 0,
        "tracks_with_unmapped_colors": 0,
        "db_tracks_found": 0,
        "db_tracks_not_found": 0,
        "tracks_updated": 0,
        "tracks_skipped_has_energy": 0,
    }

    print("Reading Rekordbox database...")
    reader = RekordboxReader()
    rb_tracks = reader.get_tracks_with_colors()
    stats["total_rb_tracks"] = len(rb_tracks)

    print(f"Found {len(rb_tracks)} tracks with colors in Rekordbox")

    # Open database session
    db = SessionLocal()

    try:
        for rb_track in rb_tracks:
            # Skip tracks without file paths
            if not rb_track.file_path:
                stats["db_tracks_not_found"] += 1
                continue

            filename = str(rb_track.file_path)
            color_id = rb_track.color_id

            # Check if color maps to energy
            if color_id not in COLOR_TO_ENERGY:
                stats["tracks_with_unmapped_colors"] += 1
                continue

            stats["tracks_with_mapped_colors"] += 1
            energy_value = COLOR_TO_ENERGY[color_id]

            # Find track in database by filename
            db_track = db.query(Track).filter(Track.filename == filename).first()

            if not db_track:
                stats["db_tracks_not_found"] += 1
                if not dry_run:
                    print(f"  Not found in DB: {filename}")
                continue

            stats["db_tracks_found"] += 1

            # Check if track already has energy value
            if db_track.energy is not None:
                stats["tracks_skipped_has_energy"] += 1
                if not dry_run:
                    print(f"  Skipping (already has energy={db_track.energy}): {filename}")
                continue

            # Update energy value
            if dry_run:
                print(f"  [DRY RUN] Would set energy={energy_value} (color={color_id}): {filename}")
            else:
                db_track.energy = energy_value
                print(f"  Setting energy={energy_value} (color={color_id}): {filename}")

            stats["tracks_updated"] += 1

        # Commit changes if not dry run
        if not dry_run:
            db.commit()
            print("\nChanges committed to database")
        else:
            print("\n[DRY RUN] No changes made to database")

    except Exception as e:
        print(f"\nError: {e}")
        db.rollback()
        raise
    finally:
        db.close()

    return stats


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Import energy levels from Rekordbox track colors"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes"
    )

    args = parser.parse_args()

    print("=" * 70)
    print("Import Energy Levels from Rekordbox Track Colors")
    print("=" * 70)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("\nColor Mapping:")
    print("  Yellow (4) → Energy 1 (Low)")
    print("  Orange (3) → Energy 3 (Medium)")
    print("  Red (2) → Energy 5 (High)")
    print()

    # Run import
    stats = import_energy_from_colors(dry_run=args.dry_run)

    # Print summary
    print()
    print("=" * 70)
    print("Import Summary:")
    print(f"  Rekordbox tracks with colors: {stats['total_rb_tracks']}")
    print(f"    - With mapped colors (Y/O/R): {stats['tracks_with_mapped_colors']}")
    print(f"    - With unmapped colors: {stats['tracks_with_unmapped_colors']}")
    print()
    print(f"  Database matching:")
    print(f"    - Found in DB: {stats['db_tracks_found']}")
    print(f"    - Not found in DB: {stats['db_tracks_not_found']}")
    print()
    print(f"  Updates:")
    print(f"    - Tracks updated: {stats['tracks_updated']}")
    print(f"    - Tracks skipped (already has energy): {stats['tracks_skipped_has_energy']}")
    print("=" * 70)

    return 0


if __name__ == "__main__":
    exit(main())
