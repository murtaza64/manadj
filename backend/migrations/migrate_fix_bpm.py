#!/usr/bin/env python3
"""
Migration: Fix BPM values that should be in centiBPM format.

Multiplies BPM values less than 500 by 100 to convert to centiBPM format.
This fixes tracks that were imported with regular BPM instead of centiBPM.

Usage:
    python backend/migrate_fix_bpm.py --dry-run
    python backend/migrate_fix_bpm.py --apply
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal, engine
from backend.models import Track


def fix_bpm_values(dry_run: bool = True) -> tuple[int, int]:
    """
    Fix BPM values by converting to centiBPM format.

    Args:
        dry_run: If True, don't actually update database

    Returns:
        Tuple of (tracks_found, tracks_updated)
    """
    db = SessionLocal()

    try:
        # Find tracks with BPM < 500 and BPM > 0 (likely in regular BPM format)
        # Skip BPM = 0 as that means no BPM data
        tracks = db.query(Track).filter(
            Track.bpm != None,
            Track.bpm > 0,
            Track.bpm < 500
        ).all()

        tracks_found = len(tracks)

        if dry_run:
            print(f"Found {tracks_found} tracks with BPM < 500:")
            for track in tracks[:10]:  # Show first 10
                title = track.title or Path(track.filename).stem
                artist = track.artist or "Unknown"
                print(f"  {title} - {artist}: BPM {track.bpm} → {track.bpm * 100}")

            if tracks_found > 10:
                print(f"  ... and {tracks_found - 10} more")

            return tracks_found, 0

        # Update tracks
        tracks_updated = 0
        for track in tracks:
            track.bpm = track.bpm * 100
            tracks_updated += 1

        db.commit()
        print(f"✅ Updated {tracks_updated} tracks")

        return tracks_found, tracks_updated

    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description='Fix BPM values in database (convert to centiBPM)'
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply changes (default is dry-run mode)'
    )

    args = parser.parse_args()

    print("🎵 BPM Migration")
    print("=" * 70)
    print(f"Mode: {'APPLY CHANGES' if args.apply else 'DRY RUN (use --apply to commit changes)'}")
    print()

    try:
        tracks_found, tracks_updated = fix_bpm_values(dry_run=not args.apply)

        print()
        print("=" * 70)
        print("📊 Summary:")
        if args.apply:
            print(f"  Tracks updated: {tracks_updated}")
        else:
            print(f"  Tracks that would be updated: {tracks_found}")
            print()
            print("Use --apply to execute the migration.")
        print()

        return 0

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
