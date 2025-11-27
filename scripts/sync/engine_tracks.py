#!/usr/bin/env python3
"""
Bidirectional track sync between manadj and Engine DJ.

Syncs tracks in both directions:
- Exports new tracks from manadj to Engine DJ (creates "Needs Analysis" playlist)
- Imports new tracks from Engine DJ to manadj

Usage:
    python scripts/sync_tracks_engine.py                              # Dry-run (both directions)
    python scripts/sync_tracks_engine.py --apply                      # Apply changes (both directions)
    python scripts/sync_tracks_engine.py --apply --skip-import        # Only export to Engine DJ
    python scripts/sync_tracks_engine.py --apply --skip-export        # Only import from Engine DJ
    python scripts/sync_tracks_engine.py --apply --playlist-name "Custom Name"
"""

import argparse
import sys
import time
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from enginedj.connection import EngineDJDatabase
from enginedj.models.track import Track as EDJTrack
from enginedj.models.playlist import Playlist as EDJPlaylist
from enginedj.models.playlist_entity import PlaylistEntity as EDJPlaylistEntity
from enginedj.models.information import Information as EDJInformation

from backend.database import SessionLocal
from backend.models import Track as ManAdjTrack
from enginedj.sync import (
    find_missing_tracks_in_enginedj,
    find_missing_tracks_in_manadj,
)
from backend.sync_common.formats import format_track_preview


@dataclass
class SyncStats:
    """Statistics for sync operation."""
    manadj_tracks: int = 0
    enginedj_tracks: int = 0
    missing_in_enginedj: int = 0
    missing_in_manadj: int = 0
    exported_to_enginedj: int = 0
    imported_to_manadj: int = 0
    skipped_file_not_found: int = 0
    playlist_created: bool = False




def export_tracks_to_enginedj(
    tracks: list[ManAdjTrack],
    edj_session,
    dry_run: bool = True
) -> int:
    """
    Export tracks from manadj to Engine DJ.

    Args:
        tracks: List of manadj tracks to export
        edj_session: Engine DJ writable session
        dry_run: If True, don't actually write to database

    Returns:
        Number of tracks exported
    """
    if dry_run:
        return 0

    current_time = int(time.time())
    exported = 0

    for track in tracks:
        # Get file metadata
        file_path = Path(track.filename)
        file_stat = file_path.stat() if file_path.exists() else None

        # Convert absolute path to relative path (Engine DJ uses relative paths)
        # Assume tracks are in ../Tracks relative to the database
        relative_path = f"../Tracks/{file_path.name}"

        # Convert centiBPM to actual BPM (Engine DJ stores actual BPM, not centiBPM!)
        bpm_value = track.bpm // 100 if track.bpm else None

        # Create Engine DJ track record
        edj_track = EDJTrack(
            # File info
            path=relative_path,  # Use relative path, not absolute
            filename=file_path.name,
            fileType=file_path.suffix.lower().lstrip('.') if file_path.suffix else None,
            fileBytes=file_stat.st_size if file_stat else None,

            # Metadata
            title=track.title or file_path.stem,
            artist=track.artist,
            bpm=bpm_value,  # Convert from centiBPM to actual BPM
            key=track.key,  # Both use 0-23 Engine DJ format
            length=None,  # Don't have duration in manadj

            # Playback
            playOrder=1,  # CRITICAL: Must be 1, not NULL

            # Status flags - CRITICAL: Must be 0, not NULL
            isAnalyzed=0,  # Needs analysis in Engine DJ
            isAvailable=1,  # File exists
            isPlayed=0,
            isMetadataImported=0,

            # Packed track flags - MUST be 0, not NULL
            isMetadataOfPackedTrackChanged=0,
            isPerfomanceDataOfPackedTrackChanged=0,
            pdbImportKey=0,
            isBeatGridLocked=0,
            explicitLyrics=0,
            streamingFlags=0,

            # Timestamps
            dateCreated=current_time,
            dateAdded=current_time,
            lastEditTime=current_time,
        )

        edj_session.add(edj_track)
        exported += 1

    if exported > 0:
        edj_session.flush()

    return exported


def create_needs_analysis_playlist(
    tracks: list[ManAdjTrack],
    edj_session,
    playlist_name: str | None = None,
    dry_run: bool = True
) -> bool:
    """
    Create "Needs Analysis" playlist in Engine DJ with newly imported tracks.

    Args:
        tracks: List of tracks to add to playlist
        edj_session: Engine DJ writable session
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

    # Get database UUID for origin tracking
    info = edj_session.query(EDJInformation).first()
    db_uuid = info.uuid if info else ""

    current_time = int(time.time())

    # Create playlist
    playlist = EDJPlaylist(
        title=playlist_name,
        parentListId=0,  # Top level
        nextListId=0,  # Will be updated if needed
        isPersisted=True,
        isExplicitlyExported=False,
        lastEditTime=current_time
    )

    edj_session.add(playlist)
    edj_session.flush()  # Get playlist ID

    # Find Engine DJ track IDs by path
    track_paths = [t.filename for t in tracks]
    edj_tracks = edj_session.query(EDJTrack).filter(
        EDJTrack.path.in_(track_paths)
    ).all()

    # Create playlist entities (linked list)
    entities = []
    for edj_track in edj_tracks:
        entity = EDJPlaylistEntity(
            listId=playlist.id,
            trackId=edj_track.id,
            databaseUuid=db_uuid,
            nextEntityId=0,  # Will be updated below
            membershipReference=0
        )
        entities.append(entity)
        edj_session.add(entity)

    edj_session.flush()  # Get entity IDs

    # Link entities in order
    for i in range(len(entities) - 1):
        entities[i].nextEntityId = entities[i + 1].id

    return True


def import_tracks_from_enginedj(
    tracks: list[EDJTrack],
    manadj_session,
    dry_run: bool = True
) -> int:
    """
    Import tracks from Engine DJ to manadj.

    Args:
        tracks: List of Engine DJ tracks to import
        manadj_session: manadj database session
        dry_run: If True, don't actually write to database

    Returns:
        Number of tracks imported
    """
    if dry_run:
        return 0

    imported = 0

    for edj_track in tracks:
        # Use path if available, otherwise filename
        filename = edj_track.path if edj_track.path else edj_track.filename
        if not filename:
            continue

        # Create manadj track record
        manadj_track = ManAdjTrack(
            filename=filename,
            title=edj_track.title,
            artist=edj_track.artist,
            bpm=edj_track.bpm,  # Engine DJ uses integer BPM
            key=edj_track.key,  # Both use 0-23 Engine DJ format
            energy=None,  # User will set manually
            # file_hash will be generated on save if needed
        )

        manadj_session.add(manadj_track)
        imported += 1

    if imported > 0:
        manadj_session.commit()

    return imported


def main():
    parser = argparse.ArgumentParser(
        description='Bidirectional track sync between manadj and Engine DJ'
    )
    parser.add_argument(
        '--engine-db',
        type=Path,
        default=Path(__file__).parent.parent / "data" / "Engine Library" / "Database2",
        help='Path to Engine DJ Database2 directory (default: data/Engine Library/Database2)'
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply changes (default is dry-run mode)'
    )
    parser.add_argument(
        '--skip-export',
        action='store_true',
        help='Skip exporting tracks from manadj to Engine DJ'
    )
    parser.add_argument(
        '--skip-import',
        action='store_true',
        help='Skip importing tracks from Engine DJ to manadj'
    )
    parser.add_argument(
        '--playlist-name',
        type=str,
        help='Custom name for "Needs Analysis" playlist (default: "manadj - Needs Analysis [date]")'
    )

    args = parser.parse_args()

    # Validate paths
    if not args.engine_db.exists():
        print(f"❌ Engine DJ database not found: {args.engine_db}")
        print(f"   Please specify correct path with --engine-db")
        return 1

    # Print header
    print("🎵 Engine DJ Track Sync")
    print("=" * 70)
    print(f"Mode: {'APPLY CHANGES' if args.apply else 'DRY RUN (use --apply to commit changes)'}")
    print(f"Engine DJ database: {args.engine_db}")
    print()

    # Connect to databases
    try:
        edj_db = EngineDJDatabase(args.engine_db)
        manadj_db = SessionLocal()
    except Exception as e:
        print(f"❌ Failed to connect to databases: {e}")
        return 1

    try:
        # Phase 1: Find tracks in manadj but NOT in Engine DJ (if not --skip-export)
        print("📊 Analyzing libraries...")
        missing_in_edj = []
        stats = SyncStats()

        if not args.skip_export:
            with edj_db.session_m() as edj_session:
                missing_in_edj, stats_dict = find_missing_tracks_in_enginedj(
                    manadj_db, edj_session, validate_paths=True
                )
                # Convert dict stats to SyncStats
                stats = SyncStats()
                stats.manadj_tracks = stats_dict['manadj_tracks']
                stats.enginedj_tracks = stats_dict['enginedj_tracks']
                stats.missing_in_enginedj = stats_dict['missing_count']
                stats.skipped_file_not_found = stats_dict['skipped_file_not_found']

            print(f"  manadj tracks: {stats.manadj_tracks}")
            print(f"  Engine DJ tracks: {stats.enginedj_tracks}")
            print()
            print(f"  Tracks in manadj but NOT in Engine DJ: {stats.missing_in_enginedj}")
            if stats.skipped_file_not_found > 0:
                print(f"  ⚠️  Skipped (file not found): {stats.skipped_file_not_found}")
        else:
            print("  ⏭️  Skipping export phase (--skip-export)")
            print()

        # Phase 2: Find tracks in Engine DJ but NOT in manadj (if not --skip-import)
        missing_in_manadj = []
        if not args.skip_import:
            with edj_db.session_m() as edj_session:
                missing_in_manadj, import_stats_dict = find_missing_tracks_in_manadj(
                    manadj_db, edj_session
                )
            print(f"  Tracks in Engine DJ but NOT in manadj: {import_stats_dict['missing_count']}")
        else:
            print("  ⏭️  Skipping import phase (--skip-import)")
        print()

        # Show preview of tracks to export
        if missing_in_edj and not args.skip_export:
            print(f"📋 Preview: Tracks to add to Engine DJ (showing first 10):")
            for i, track in enumerate(missing_in_edj[:10], 1):
                print(f"  {i}. {format_track_preview(track)}")
            if len(missing_in_edj) > 10:
                print(f"  ... and {len(missing_in_edj) - 10} more")
            print()

        # Show preview of tracks to import
        if missing_in_manadj and not args.skip_import:
            print(f"📋 Preview: Tracks to import to manadj (showing first 10):")
            for i, track in enumerate(missing_in_manadj[:10], 1):
                print(f"  {i}. {format_track_preview(track)}")
            if len(missing_in_manadj) > 10:
                print(f"  ... and {len(missing_in_manadj) - 10} more")
            print()

        # Phase 3: Export tracks to Engine DJ (if --apply and not --skip-export)
        if missing_in_edj and not args.skip_export:
            if args.apply:
                print(f"✅ Exporting {len(missing_in_edj)} tracks to Engine DJ...")
                with edj_db.session_m_write() as edj_session:
                    exported = export_tracks_to_enginedj(missing_in_edj, edj_session, dry_run=False)
                    stats.exported_to_enginedj = exported

                    # Create playlist
                    playlist_created = create_needs_analysis_playlist(
                        missing_in_edj, edj_session, args.playlist_name, dry_run=False
                    )
                    stats.playlist_created = playlist_created

                print(f"   Exported: {stats.exported_to_enginedj} tracks")
                if stats.playlist_created:
                    playlist_name = args.playlist_name or f"manadj - Needs Analysis [{datetime.now().strftime('%Y-%m-%d')}]"
                    print(f"   Created playlist: \"{playlist_name}\"")
            else:
                print(f"✅ Would export {len(missing_in_edj)} tracks to Engine DJ")
                playlist_name = args.playlist_name or f"manadj - Needs Analysis [{datetime.now().strftime('%Y-%m-%d')}]"
                print(f"   Would create playlist: \"{playlist_name}\"")

        # Phase 4: Import tracks from Engine DJ (if --apply and not --skip-import)
        if missing_in_manadj and not args.skip_import:
            if args.apply:
                print(f"✅ Importing {len(missing_in_manadj)} tracks to manadj...")
                imported = import_tracks_from_enginedj(missing_in_manadj, manadj_db, dry_run=False)
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
                print(f"  Exported to Engine DJ: {stats.exported_to_enginedj}")
                if stats.playlist_created:
                    print(f"  Playlist created: Yes")
            if not args.skip_import:
                print(f"  Imported to manadj: {stats.imported_to_manadj}")
        else:
            if not args.skip_export:
                print(f"  Would export to Engine DJ: {len(missing_in_edj)}")
                if missing_in_edj:
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


if __name__ == '__main__':
    sys.exit(main())
