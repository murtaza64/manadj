#!/usr/bin/env python3
"""
Bidirectional track sync between manadj and Rekordbox.

Syncs tracks in both directions:
- Exports new tracks from manadj to Rekordbox (creates "Needs Analysis" playlist)
- Imports new tracks from Rekordbox to manadj

Usage:
    python scripts/sync_tracks_rekordbox.py                    # Dry-run
    python scripts/sync_tracks_rekordbox.py --apply            # Apply changes
    python scripts/sync_tracks_rekordbox.py --apply --skip-import
    python scripts/sync_tracks_rekordbox.py --apply --skip-export
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal
from backend.models import Track as ManAdjTrack
from rekordbox.connection import get_rekordbox_db
from rekordbox.sync import (
    find_missing_tracks_in_rekordbox,
    find_missing_tracks_in_manadj_from_rekordbox,
)
from backend.sync_common.formats import format_track_preview
from backend.key import Key


@dataclass
class SyncStats:
    """Statistics for sync operation."""
    manadj_tracks: int = 0
    rekordbox_tracks: int = 0
    missing_in_rekordbox: int = 0
    missing_in_manadj: int = 0
    exported_to_rekordbox: int = 0
    imported_to_manadj: int = 0
    skipped_file_not_found: int = 0
    playlist_created: bool = False


def export_tracks_to_rekordbox(
    tracks: list[ManAdjTrack],
    rb_db: Rekordbox6Database,
    dry_run: bool = True
) -> int:
    """
    Export tracks from manadj to Rekordbox.

    Uses pyrekordbox's add_content() method with MINIMAL fields.
    Only sets path and title - avoids foreign key complexity.

    Args:
        tracks: List of manadj tracks to export
        rb_db: Rekordbox6Database instance
        dry_run: If True, don't actually write to database

    Returns:
        Number of tracks exported
    """
    if dry_run:
        return 0

    exported = 0
    for track in tracks:
        file_path = Path(track.filename)
        if not file_path.exists():
            continue

        # Get minimal fields (path + title only)
        title = track.title or file_path.stem

        # Add to Rekordbox - minimal API call
        # Per pyrekordbox docs: only path is required, title is optional
        rb_db.add_content(
            str(file_path.absolute()),
            Title=title
        )
        exported += 1

    if exported > 0:
        rb_db.commit(autoinc=True)  # Commit with USN auto-increment

    return exported


def create_needs_analysis_playlist(
    tracks: list[ManAdjTrack],
    rb_db: Rekordbox6Database,
    playlist_name: str | None = None,
    dry_run: bool = True
) -> bool:
    """
    Create "Needs Analysis" playlist in Rekordbox with newly imported tracks.

    Args:
        tracks: List of tracks to add to playlist
        rb_db: Rekordbox6Database instance
        playlist_name: Custom playlist name (default: "manadj - Needs Analysis [date]")
        dry_run: If True, don't actually create playlist

    Returns:
        True if playlist was created, False otherwise
    """
    if dry_run or len(tracks) == 0:
        return False

    # Generate playlist name
    if not playlist_name:
        date_str = datetime.now().strftime("%Y-%m-%d")
        playlist_name = f"manadj - Needs Analysis [{date_str}]"

    # Create playlist using high-level API
    playlist = rb_db.create_playlist(name=playlist_name)

    # Find Rekordbox content IDs for tracks
    rb_contents = list(rb_db.get_content())
    track_paths = {t.filename for t in tracks}

    for rb_content in rb_contents:
        if rb_content.FolderPath in track_paths:
            rb_db.add_to_playlist(playlist, rb_content)

    rb_db.commit(autoinc=True)
    return True


def import_tracks_from_rekordbox(
    rb_tracks: list,
    manadj_session,
    dry_run: bool = True
) -> int:
    """
    Import tracks from Rekordbox to manadj.

    Args:
        rb_tracks: List of Rekordbox DjmdContent tracks to import
        manadj_session: manadj database session
        dry_run: If True, don't actually write to database

    Returns:
        Number of tracks imported
    """
    if dry_run:
        return 0

    imported = 0
    for rb_track in rb_tracks:
        if not rb_track.FolderPath:
            continue

        # Convert Rekordbox BPM to centiBPM (both use centiBPM format)
        bpm = None
        if rb_track.BPM:
            bpm = rb_track.BPM

        # Convert Rekordbox key to Engine DJ format
        # Note: This is simplified - proper key mapping would require
        # querying DjmdKey table and mapping via Mixxx IDs
        key = None
        if rb_track.KeyID:
            try:
                key_obj = Key.from_mixxx_id(rb_track.KeyID)
                key = key_obj.engine_id if key_obj else None
            except:
                pass  # Skip if key conversion fails

        # Get artist name (DjmdContent.Artist is relationship, not string)
        artist = None
        if hasattr(rb_track, 'Artist') and rb_track.Artist:
            artist = rb_track.Artist.Name if hasattr(rb_track.Artist, 'Name') else None

        # Create manadj track
        manadj_track = ManAdjTrack(
            filename=rb_track.FolderPath,
            title=rb_track.Title,
            artist=artist,
            bpm=bpm,
            key=key,
            energy=None,  # User will set manually
        )

        manadj_session.add(manadj_track)
        imported += 1

    if imported > 0:
        manadj_session.commit()

    return imported


def main():
    parser = argparse.ArgumentParser(
        description='Bidirectional track sync between manadj and Rekordbox'
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
    parser.add_argument(
        '--skip-export',
        action='store_true',
        help='Skip exporting tracks from manadj to Rekordbox'
    )
    parser.add_argument(
        '--skip-import',
        action='store_true',
        help='Skip importing tracks from Rekordbox to manadj'
    )
    parser.add_argument(
        '--playlist-name',
        type=str,
        help='Custom playlist name (default: "manadj - Needs Analysis [date]")'
    )

    args = parser.parse_args()

    # Print header
    print("🎵 Rekordbox Track Sync")
    print("=" * 70)
    print(f"Mode: {'APPLY CHANGES' if args.apply else 'DRY RUN (use --apply to commit changes)'}")
    print()

    # Connect to databases
    try:
        # Check if Rekordbox is running (pyrekordbox will handle this too)
        from pyrekordbox.utils import get_rekordbox_pid
        if get_rekordbox_pid():
            print("❌ Rekordbox is running. Please close Rekordbox before syncing.")
            return 1

        # Open Rekordbox database (auto-detects location)
        rb_db = get_rekordbox_db(args.rekordbox_db)
        manadj_db = SessionLocal()

        print(f"Rekordbox database: {rb_db.db_directory}")
        print()
    except Exception as e:
        print(f"❌ Failed to connect to databases: {e}")
        return 1

    try:
        # Phase 1: Find tracks in manadj but NOT in Rekordbox
        print("📊 Analyzing libraries...")
        missing_in_rb = []
        stats = SyncStats()

        if not args.skip_export:
            missing_in_rb, stats_dict = find_missing_tracks_in_rekordbox(
                manadj_db, rb_db, validate_paths=True
            )
            # Convert dict stats to SyncStats
            stats.manadj_tracks = stats_dict['manadj_tracks']
            stats.rekordbox_tracks = stats_dict['rekordbox_tracks']
            stats.missing_in_rekordbox = stats_dict['missing_count']
            stats.skipped_file_not_found = stats_dict['skipped_file_not_found']

            print(f"  manadj tracks: {stats.manadj_tracks}")
            print(f"  Rekordbox tracks: {stats.rekordbox_tracks}")
            print()
            print(f"  Tracks in manadj but NOT in Rekordbox: {stats.missing_in_rekordbox}")
            if stats.skipped_file_not_found > 0:
                print(f"  ⚠️  Skipped (file not found): {stats.skipped_file_not_found}")
        else:
            print("  ⏭️  Skipping export phase (--skip-export)")
        print()

        # Phase 2: Find tracks in Rekordbox but NOT in manadj
        missing_in_manadj = []
        if not args.skip_import:
            missing_in_manadj, import_stats_dict = find_missing_tracks_in_manadj_from_rekordbox(
                manadj_db, rb_db
            )
            print(f"  Tracks in Rekordbox but NOT in manadj: {import_stats_dict['missing_count']}")
        else:
            print("  ⏭️  Skipping import phase (--skip-import)")
        print()

        # Show preview of tracks to export
        if missing_in_rb and not args.skip_export:
            print(f"📋 Preview: Tracks to add to Rekordbox (showing first 10):")
            for i, track in enumerate(missing_in_rb[:10], 1):
                print(f"  {i}. {format_track_preview(track)}")
            if len(missing_in_rb) > 10:
                print(f"  ... and {len(missing_in_rb) - 10} more")
            print()

        # Show preview of tracks to import
        if missing_in_manadj and not args.skip_import:
            print(f"📋 Preview: Tracks to import to manadj (showing first 10):")
            for i, track in enumerate(missing_in_manadj[:10], 1):
                # Format Rekordbox track preview
                title = track.Title or Path(track.FolderPath or "").stem
                # Handle Artist as relationship object or string
                artist = "Unknown"
                if hasattr(track, 'Artist') and track.Artist:
                    artist = track.Artist.Name if hasattr(track.Artist, 'Name') else str(track.Artist)
                bpm_str = f"{track.BPM / 100:.1f} BPM" if track.BPM else "? BPM"
                print(f"  {i}. {title} - {artist} ({bpm_str}) [{track.FolderPath}]")
            if len(missing_in_manadj) > 10:
                print(f"  ... and {len(missing_in_manadj) - 10} more")
            print()

        # Phase 3: Export tracks to Rekordbox
        if missing_in_rb and not args.skip_export:
            if args.apply:
                print(f"✅ Exporting {len(missing_in_rb)} tracks to Rekordbox...")
                exported = export_tracks_to_rekordbox(missing_in_rb, rb_db, dry_run=False)
                stats.exported_to_rekordbox = exported

                # Create playlist
                playlist_created = create_needs_analysis_playlist(
                    missing_in_rb, rb_db, args.playlist_name, dry_run=False
                )
                stats.playlist_created = playlist_created

                print(f"   Exported: {stats.exported_to_rekordbox} tracks")
                if stats.playlist_created:
                    playlist_name = args.playlist_name or f"manadj - Needs Analysis [{datetime.now().strftime('%Y-%m-%d')}]"
                    print(f"   Created playlist: \"{playlist_name}\"")
            else:
                print(f"✅ Would export {len(missing_in_rb)} tracks to Rekordbox")
                playlist_name = args.playlist_name or f"manadj - Needs Analysis [{datetime.now().strftime('%Y-%m-%d')}]"
                print(f"   Would create playlist: \"{playlist_name}\"")

        # Phase 4: Import tracks from Rekordbox
        if missing_in_manadj and not args.skip_import:
            if args.apply:
                print(f"✅ Importing {len(missing_in_manadj)} tracks to manadj...")
                imported = import_tracks_from_rekordbox(missing_in_manadj, manadj_db, dry_run=False)
                stats.imported_to_manadj = imported
                print(f"   Imported: {stats.imported_to_manadj} tracks")
            else:
                print(f"✅ Would import {len(missing_in_manadj)} tracks to manadj")

        # Summary
        print()
        print("=" * 70)
        print("📊 Summary:")
        if args.apply:
            if not args.skip_export:
                print(f"  Exported to Rekordbox: {stats.exported_to_rekordbox}")
                if stats.playlist_created:
                    print(f"  Playlist created: Yes")
            if not args.skip_import:
                print(f"  Imported to manadj: {stats.imported_to_manadj}")
        else:
            if not args.skip_export:
                print(f"  Would export to Rekordbox: {len(missing_in_rb)}")
                if missing_in_rb:
                    print(f"  Would create playlist: Yes")
            if not args.skip_import and missing_in_manadj:
                print(f"  Would import to manadj: {len(missing_in_manadj)}")
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
