#!/usr/bin/env python3
"""
Populate BPM and key analysis for all tracks in the database.

Usage:
    uv run scripts/populate_analysis.py
    uv run scripts/populate_analysis.py --bpm-only
    uv run scripts/populate_analysis.py --key-only
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal
from backend import crud
from backend.analysis import analyze_bpm, analyze_key


def populate_bpm_analysis(db, track_id: int, track_title: str):
    """Run BPM analysis for a track and save to database."""
    try:
        track = crud.get_track(db, track_id)
        audio_path = Path(track.filename)

        if not audio_path.exists():
            print(f"  ❌ Audio file not found: {track.filename}")
            return False

        print(f"  🎵 Analyzing BPM...")
        result = analyze_bpm(str(audio_path))

        crud.create_or_update_bpm_analysis(
            db=db,
            track_id=track_id,
            estimates=result['estimates'],
            recommended_bpms=result['recommended_bpms'],
            recommended_bpm=result['recommended_bpm'],
            duration=result['metadata']['duration']
        )

        print(f"  ✅ BPM: {result['recommended_bpm']} (alternatives: {result['recommended_bpms'][1:]})")
        return True

    except Exception as e:
        print(f"  ❌ BPM analysis failed: {str(e)}")
        return False


def populate_key_analysis(db, track_id: int, track_title: str):
    """Run key analysis for a track and save to database."""
    try:
        track = crud.get_track(db, track_id)
        audio_path = Path(track.filename)

        if not audio_path.exists():
            print(f"  ❌ Audio file not found: {track.filename}")
            return False

        print(f"  🎹 Analyzing key...")
        result = analyze_key(str(audio_path))

        crud.create_or_update_key_analysis(
            db=db,
            track_id=track_id,
            key=result['key'],
            formats=result['formats'],
            confidence=result['confidence'],
            scale=result['metadata']['scale']
        )

        print(f"  ✅ Key: {result['key']} ({result['formats']['camelot']}, confidence: {result['confidence']:.2%})")
        return True

    except Exception as e:
        print(f"  ❌ Key analysis failed: {str(e)}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Populate analysis for all tracks")
    parser.add_argument("--bpm-only", action="store_true", help="Only analyze BPM")
    parser.add_argument("--key-only", action="store_true", help="Only analyze key")
    parser.add_argument("--skip-existing", action="store_true", help="Skip tracks that already have analysis")
    args = parser.parse_args()

    # Default to both if neither specified
    analyze_bpm_flag = not args.key_only
    analyze_key_flag = not args.bpm_only

    db = SessionLocal()

    try:
        # Get all tracks
        tracks = db.query(crud.models.Track).all()
        total_tracks = len(tracks)

        print(f"Found {total_tracks} tracks in database\n")

        bpm_success = 0
        bpm_skipped = 0
        key_success = 0
        key_skipped = 0

        for i, track in enumerate(tracks, 1):
            track_title = f"{track.artist} - {track.title}" if track.artist and track.title else track.filename
            print(f"[{i}/{total_tracks}] {track_title}")

            # Check if analysis already exists
            if args.skip_existing:
                if analyze_bpm_flag:
                    existing_bpm = crud.get_bpm_analysis(db, track.id)
                    if existing_bpm:
                        print(f"  ⏭️  BPM analysis already exists (skipping)")
                        bpm_skipped += 1
                        analyze_bpm_flag = False

                if analyze_key_flag:
                    existing_key = crud.get_key_analysis(db, track.id)
                    if existing_key:
                        print(f"  ⏭️  Key analysis already exists (skipping)")
                        key_skipped += 1
                        analyze_key_flag = False

            # Run analyses
            if analyze_bpm_flag:
                if populate_bpm_analysis(db, track.id, track_title):
                    bpm_success += 1

            if analyze_key_flag:
                if populate_key_analysis(db, track.id, track_title):
                    key_success += 1

            print()

        # Print summary
        print("=" * 60)
        print("SUMMARY")
        print("=" * 60)
        if not args.key_only:
            print(f"BPM Analysis: {bpm_success}/{total_tracks} successful")
            if bpm_skipped:
                print(f"  ({bpm_skipped} skipped - already analyzed)")
        if not args.bpm_only:
            print(f"Key Analysis: {key_success}/{total_tracks} successful")
            if key_skipped:
                print(f"  ({key_skipped} skipped - already analyzed)")

    finally:
        db.close()

    return 0


if __name__ == "__main__":
    exit(main())
