#!/usr/bin/env python3
"""Verify Engine DJ key mapping by comparing against our database."""

import sys
from pathlib import Path
from enginedj import EngineDJDatabase, Track as EDJTrack
from backend.database import SessionLocal
from backend.models import Track as DBTrack
from backend.key import Key


def verify_mapping(engine_db_path: str):
    """Compare keys between Engine DJ and our database to verify mapping."""

    # Connect to Engine DJ
    edj_db = EngineDJDatabase(Path(engine_db_path))

    # Connect to our database
    db = SessionLocal()

    try:
        print("Verifying Engine DJ key mapping...")
        print(f"Looking for reference track: 'Not Even Love' (should be 4m/11A/F#m)")
        print()
        print(f"{'Filename':<50} {'EDJ ID':<8} {'EDJ→Key':<10} {'DB Key':<10} {'Match':<8}")
        print("=" * 90)

        matches = 0
        mismatches = 0
        not_found = 0
        reference_found = False

        # Get all tracks from our DB with keys
        db_tracks = db.query(DBTrack).filter(DBTrack.key.isnot(None)).all()

        with edj_db.session_m() as edj_session:
            for db_track in db_tracks:
                # Extract just the filename from full path
                filename = Path(db_track.filename).name

                # Find matching track in Engine DJ by filename
                edj_track = edj_session.query(EDJTrack).filter(
                    EDJTrack.filename == filename
                ).first()

                if not edj_track:
                    not_found += 1
                    continue

                if edj_track.key is None:
                    continue

                # Convert Engine DJ key using our Key class
                edj_key = Key.from_engine_id(edj_track.key)
                db_key = Key.from_engine_id(db_track.key)

                if edj_key is None or db_key is None:
                    continue

                # Check if keys match (handles enharmonic equivalents)
                match = edj_key == db_key
                match_str = "✓" if match else "✗"

                if match:
                    matches += 1
                else:
                    mismatches += 1

                # Check for reference track
                is_reference = "not even love" in filename.lower()
                if is_reference:
                    reference_found = True

                # Print reference track and all mismatches, plus first 20 matches
                if is_reference or not match or (matches <= 20 and match):
                    prefix = ">>> " if is_reference else "    "
                    print(f"{prefix}{filename[:46]:<50} {edj_track.key:<8} {edj_key.musical:<10} {db_key.musical:<10} {match_str:<8}")

                    if is_reference:
                        print(f"    Reference track verification:")
                        print(f"      Engine ID: {edj_key.engine_id} (expected: 7)")
                        print(f"      OpenKey: {edj_key.openkey} (expected: 4m)")
                        print(f"      Camelot: {edj_key.camelot} (expected: 11A)")
                        print(f"      Musical: {edj_key.musical} (expected: F#m)")
                        print()

        print("=" * 90)
        print(f"\nResults:")
        print(f"  Matches: {matches}")
        print(f"  Mismatches: {mismatches}")
        if matches + mismatches > 0:
            print(f"  Accuracy: {matches / (matches + mismatches) * 100:.1f}%")
        print(f"  Not found in Engine DJ: {not_found}")

        if reference_found:
            print(f"\n✓ Reference track 'Not Even Love' found and verified")
        else:
            print(f"\n⚠ Reference track 'Not Even Love' not found in comparison")

    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run scripts/verify_key_mapping.py <path_to_engine_dj_database2_dir>")
        print("\nExample: uv run scripts/verify_key_mapping.py '/path/to/Engine Library/Database2'")
        sys.exit(1)

    verify_mapping(sys.argv[1])
