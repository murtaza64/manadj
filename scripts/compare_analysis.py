#!/usr/bin/env python3
"""
Compare analyzed BPM and key values with stored Track data.

Shows which tracks have analysis that matches or differs from their stored metadata.

Usage:
    uv run scripts/compare_analysis.py
    uv run scripts/compare_analysis.py --mismatches-only
    uv run scripts/compare_analysis.py --no-analysis-only
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal
from backend import crud
from backend.key import Key


def format_bpm_comparison(track_bpm, analyzed_bpm, recommended_bpms):
    """Format BPM comparison for display."""
    if track_bpm is None:
        return f"Track: (none) | Analyzed: {analyzed_bpm} | Alternatives: {recommended_bpms}"

    # Convert centiBPM to BPM if needed (Track.bpm is stored as int * 100)
    track_bpm_float = track_bpm / 100.0

    match = "✅" if int(track_bpm_float) == analyzed_bpm else "❌"
    return f"{match} Track: {track_bpm_float:.1f} | Analyzed: {analyzed_bpm} | Alternatives: {recommended_bpms}"


def format_key_comparison(track_key, analyzed_key, analyzed_formats):
    """Format key comparison for display."""
    if track_key is None:
        return f"Track: (none) | Analyzed: {analyzed_key} ({analyzed_formats['camelot']})"

    # Convert track_key (Engine DJ ID) to musical notation
    track_key_obj = Key.from_engine_id(track_key)
    track_key_str = track_key_obj.musical if track_key_obj else f"ID:{track_key}"

    analyzed_engine_id = analyzed_formats.get('engine_id')
    match = "✅" if track_key == analyzed_engine_id else "❌"

    return f"{match} Track: {track_key_str} | Analyzed: {analyzed_key} ({analyzed_formats['camelot']})"


def main():
    parser = argparse.ArgumentParser(description="Compare analyzed values with stored Track data")
    parser.add_argument("--mismatches-only", action="store_true", help="Only show tracks with mismatched values")
    parser.add_argument("--no-analysis-only", action="store_true", help="Only show tracks without analysis")
    args = parser.parse_args()

    db = SessionLocal()

    try:
        # Get all tracks
        tracks = db.query(crud.models.Track).all()
        total_tracks = len(tracks)

        print(f"Comparing {total_tracks} tracks\n")
        print("=" * 80)

        stats = {
            'bpm_matches': 0,
            'bpm_mismatches': 0,
            'bpm_no_track_value': 0,
            'bpm_no_analysis': 0,
            'key_matches': 0,
            'key_mismatches': 0,
            'key_no_track_value': 0,
            'key_no_analysis': 0,
        }

        for track in tracks:
            track_title = f"{track.artist} - {track.title}" if track.artist and track.title else track.filename

            # Get analyses
            bpm_analysis = crud.get_bpm_analysis(db, track.id)
            key_analysis = crud.get_key_analysis(db, track.id)

            # Check if we should skip this track
            if args.no_analysis_only and (bpm_analysis or key_analysis):
                continue

            has_mismatch = False

            # Compare BPM
            bpm_info = None
            if bpm_analysis:
                recommended_bpm = bpm_analysis.recommended_bpm
                import json
                recommended_bpms = json.loads(bpm_analysis.recommended_bpms_json)

                if track.bpm is None:
                    bpm_info = format_bpm_comparison(None, recommended_bpm, recommended_bpms)
                    stats['bpm_no_track_value'] += 1
                else:
                    track_bpm_float = track.bpm / 100.0
                    if int(track_bpm_float) == recommended_bpm:
                        stats['bpm_matches'] += 1
                    else:
                        stats['bpm_mismatches'] += 1
                        has_mismatch = True
                    bpm_info = format_bpm_comparison(track.bpm, recommended_bpm, recommended_bpms)
            else:
                stats['bpm_no_analysis'] += 1
                bpm_info = "⚠️  No BPM analysis found"

            # Compare Key
            key_info = None
            if key_analysis:
                analyzed_key = key_analysis.key
                analyzed_formats = {
                    'musical': key_analysis.musical,
                    'camelot': key_analysis.camelot,
                    'engine_id': key_analysis.engine_id
                }

                if track.key is None:
                    key_info = format_key_comparison(None, analyzed_key, analyzed_formats)
                    stats['key_no_track_value'] += 1
                else:
                    if track.key == analyzed_formats.get('engine_id'):
                        stats['key_matches'] += 1
                    else:
                        stats['key_mismatches'] += 1
                        has_mismatch = True
                    key_info = format_key_comparison(track.key, analyzed_key, analyzed_formats)
            else:
                stats['key_no_analysis'] += 1
                key_info = "⚠️  No key analysis found"

            # Skip if only showing mismatches and there are none
            if args.mismatches_only and not has_mismatch:
                continue

            # Print track info
            print(f"\n{track_title}")
            print(f"  BPM: {bpm_info}")
            print(f"  Key: {key_info}")

        # Print summary
        print("\n" + "=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print(f"Total tracks: {total_tracks}\n")

        print("BPM Analysis:")
        print(f"  ✅ Matches:              {stats['bpm_matches']}")
        print(f"  ❌ Mismatches:           {stats['bpm_mismatches']}")
        print(f"  ⚠️  No track value:       {stats['bpm_no_track_value']}")
        print(f"  ⚠️  No analysis:          {stats['bpm_no_analysis']}")

        print("\nKey Analysis:")
        print(f"  ✅ Matches:              {stats['key_matches']}")
        print(f"  ❌ Mismatches:           {stats['key_mismatches']}")
        print(f"  ⚠️  No track value:       {stats['key_no_track_value']}")
        print(f"  ⚠️  No analysis:          {stats['key_no_analysis']}")

        # Calculate accuracy if we have data
        if stats['bpm_matches'] + stats['bpm_mismatches'] > 0:
            bpm_accuracy = stats['bpm_matches'] / (stats['bpm_matches'] + stats['bpm_mismatches']) * 100
            print(f"\nBPM Accuracy: {bpm_accuracy:.1f}% (where both exist)")

        if stats['key_matches'] + stats['key_mismatches'] > 0:
            key_accuracy = stats['key_matches'] / (stats['key_matches'] + stats['key_mismatches']) * 100
            print(f"Key Accuracy: {key_accuracy:.1f}% (where both exist)")

    finally:
        db.close()

    return 0


if __name__ == "__main__":
    exit(main())
