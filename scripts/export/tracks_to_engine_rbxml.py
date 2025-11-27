#!/usr/bin/env python3
"""
Export tracks from manadj to Rekordbox XML for Engine DJ import.

Finds tracks that exist in manadj but not in Engine DJ, and exports them
to a Rekordbox XML file that can be manually imported into Engine DJ.

Usage:
    python scripts/export_to_rekordbox_xml.py                              # Dry-run
    python scripts/export_to_rekordbox_xml.py --apply                     # Generate XML
    python scripts/export_to_rekordbox_xml.py --apply --output custom.xml
    python scripts/export_to_rekordbox_xml.py --apply --playlist-name "Custom"
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from enginedj.connection import EngineDJDatabase
from backend.database import SessionLocal
from enginedj.sync import find_missing_tracks_in_enginedj
from rekordbox.xml import create_rekordbox_xml_from_tracks
from backend.sync_common.formats import format_track_preview


def main():
    parser = argparse.ArgumentParser(
        description='Export tracks from manadj to Rekordbox XML for Engine DJ import'
    )
    parser.add_argument(
        '--engine-db',
        type=Path,
        default=Path(__file__).parent.parent / "data" / "Engine Library" / "Database2",
        help='Path to Engine DJ Database2 directory (default: data/Engine Library/Database2)'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=Path("manadj_to_engine.xml"),
        help='Output XML file path (default: manadj_to_engine.xml)'
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Generate the XML file (default is dry-run mode)'
    )
    parser.add_argument(
        '--playlist-name',
        type=str,
        help='Custom playlist name (default: "manadj - Needs Analysis [date]")'
    )

    args = parser.parse_args()

    # Validate paths
    if not args.engine_db.exists():
        print(f"❌ Engine DJ database not found: {args.engine_db}")
        print(f"   Please specify correct path with --engine-db")
        return 1

    # Check if output file exists
    if args.apply and args.output.exists():
        print(f"⚠️  Output file already exists: {args.output}")
        response = input("   Overwrite? (y/N): ")
        if response.lower() != 'y':
            print("   Aborted.")
            return 0

    # Print header
    print("🎵 Rekordbox XML Export")
    print("=" * 70)
    print(f"Mode: {'APPLY CHANGES' if args.apply else 'DRY RUN (use --apply to generate XML file)'}")
    print(f"Engine DJ database: {args.engine_db}")
    print(f"Output file: {args.output}")
    print()

    # Connect to databases
    try:
        edj_db = EngineDJDatabase(args.engine_db)
        manadj_db = SessionLocal()
    except Exception as e:
        print(f"❌ Failed to connect to databases: {e}")
        return 1

    try:
        # Find tracks in manadj but NOT in Engine DJ
        print("📊 Analyzing libraries...")
        with edj_db.session_m() as edj_session:
            missing_tracks, stats = find_missing_tracks_in_enginedj(
                manadj_db, edj_session, validate_paths=True
            )

        print(f"  manadj tracks: {stats['manadj_tracks']}")
        print(f"  Engine DJ tracks: {stats['enginedj_tracks']}")
        print()
        print(f"  Tracks to export: {stats['missing_count']}")
        if stats['skipped_file_not_found'] > 0:
            print(f"  ⚠️  Skipped (file not found): {stats['skipped_file_not_found']}")
        print()

        # Show preview of tracks to export
        if missing_tracks:
            print(f"📋 Preview: Tracks to export (showing first 10):")
            for i, track in enumerate(missing_tracks[:10], 1):
                print(f"  {i}. {format_track_preview(track)}")
            if len(missing_tracks) > 10:
                print(f"  ... and {len(missing_tracks) - 10} more")
            print()

        # Export to XML
        if missing_tracks:
            # Generate playlist name
            playlist_name = args.playlist_name or f"manadj - Needs Analysis [{datetime.now().strftime('%Y-%m-%d')}]"

            if args.apply:
                print(f"✅ Generating Rekordbox XML...")
                exported = create_rekordbox_xml_from_tracks(
                    missing_tracks,
                    args.output,
                    playlist_name,
                    validate_paths=True
                )

                print(f"   Exported: {exported} tracks")
                print(f"   Created playlist: \"{playlist_name}\"")
                print(f"   Saved to: {args.output}")
                print()
                print("📋 Next steps:")
                print("   1. Open Engine DJ")
                print("   2. Import XML file via File > Import > Rekordbox XML")
                print("   3. The tracks will appear in the playlist")
            else:
                print(f"✅ Would export {len(missing_tracks)} tracks")
                print(f"   Would create playlist: \"{playlist_name}\"")
                print(f"   Would save to: {args.output}")
        else:
            print("✅ No tracks to export - all manadj tracks are already in Engine DJ!")

        # Summary
        print()
        print("=" * 70)
        print("📊 Summary:")
        if args.apply and missing_tracks:
            print(f"  Exported: {len(missing_tracks)} tracks")
            print(f"  XML file: {args.output}")
        elif args.apply:
            print(f"  No tracks exported")
        else:
            print(f"  Would export: {stats['missing_count']} tracks")
            print(f"  Output file: {args.output}")
            print()
            print("Use --apply to generate the XML file.")

        print()
        return 0

    except Exception as e:
        print(f"❌ Error during export: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        manadj_db.close()


if __name__ == '__main__':
    sys.exit(main())
