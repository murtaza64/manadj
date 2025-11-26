#!/usr/bin/env python3
"""
Bidirectional track sync between manadj and Engine DJ.

Syncs tracks in both directions:
- Exports new tracks from manadj to Engine DJ (creates "Needs Analysis" playlist)
- Imports new tracks from Engine DJ to manadj

Usage:
    python scripts/sync_tracks_engine.py --dry-run
    python scripts/sync_tracks_engine.py --apply
    python scripts/sync_tracks_engine.py --apply --no-import
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


def match_track(manadj_track: ManAdjTrack, edj_tracks_by_path: dict, edj_tracks_by_filename: dict) -> EDJTrack | None:
    """
    Match a manadj track to an Engine DJ track.

    Priority:
    1. Full path match
    2. Filename-only match

    Args:
        manadj_track: manadj track to match
        edj_tracks_by_path: Engine DJ tracks indexed by full path
        edj_tracks_by_filename: Engine DJ tracks indexed by filename only

    Returns:
        Matching Engine DJ track or None
    """
    # Priority 1: Full path match
    if manadj_track.filename in edj_tracks_by_path:
        return edj_tracks_by_path[manadj_track.filename]

    # Priority 2: Filename-only match
    filename = Path(manadj_track.filename).name
    if filename in edj_tracks_by_filename:
        return edj_tracks_by_filename[filename]

    return None


def find_missing_tracks_in_enginedj(
    manadj_session,
    edj_session,
    validate_paths: bool = True
) -> tuple[list[ManAdjTrack], SyncStats]:
    """
    Find tracks that exist in manadj but not in Engine DJ.

    Args:
        manadj_session: manadj database session
        edj_session: Engine DJ database session
        validate_paths: Whether to validate file paths exist

    Returns:
        Tuple of (missing tracks, stats)
    """
    stats = SyncStats()

    # Get all tracks from manadj
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    stats.manadj_tracks = len(manadj_tracks)

    # Get all tracks from Engine DJ
    edj_tracks = edj_session.query(EDJTrack).all()
    stats.enginedj_tracks = len(edj_tracks)

    # Index Engine DJ tracks
    edj_tracks_by_path = {t.path: t for t in edj_tracks if t.path}
    edj_tracks_by_filename = {Path(t.filename).name: t for t in edj_tracks if t.filename}

    # Find missing tracks
    missing = []
    for track in manadj_tracks:
        matched = match_track(track, edj_tracks_by_path, edj_tracks_by_filename)
        if not matched:
            # Validate file exists if requested
            if validate_paths:
                path = Path(track.filename)
                if not path.exists():
                    stats.skipped_file_not_found += 1
                    continue
            missing.append(track)

    stats.missing_in_enginedj = len(missing)
    return missing, stats


def find_missing_tracks_in_manadj(
    manadj_session,
    edj_session
) -> tuple[list[EDJTrack], SyncStats]:
    """
    Find tracks that exist in Engine DJ but not in manadj.

    Args:
        manadj_session: manadj database session
        edj_session: Engine DJ database session

    Returns:
        Tuple of (missing tracks, partial stats)
    """
    stats = SyncStats()

    # Get all tracks
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    edj_tracks = edj_session.query(EDJTrack).all()

    # Index manadj tracks
    manadj_tracks_by_path = {t.filename: t for t in manadj_tracks}
    manadj_tracks_by_filename = {Path(t.filename).name: t for t in manadj_tracks}

    # Find missing tracks
    missing = []
    for edj_track in edj_tracks:
        # Try full path match
        if edj_track.path and edj_track.path in manadj_tracks_by_path:
            continue

        # Try filename match
        if edj_track.filename:
            filename = Path(edj_track.filename).name
            if filename in manadj_tracks_by_filename:
                continue

        missing.append(edj_track)

    stats.missing_in_manadj = len(missing)
    return missing, stats


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
        # Create Engine DJ track record
        edj_track = EDJTrack(
            path=track.filename,
            filename=Path(track.filename).name,
            title=track.title or Path(track.filename).stem,
            artist=track.artist,
            bpm=track.bpm,  # manadj stores centiBPM, Engine DJ expects integer BPM
            key=track.key,  # Both use 0-23 Engine DJ format
            length=None,  # Don't have duration in manadj
            isAnalyzed=False,  # Needs analysis in Engine DJ
            isMetadataImported=track.title is not None or track.artist is not None,
            dateCreated=current_time,
            dateAdded=current_time,
            lastEditTime=current_time,
            isAvailable=True,
            isPlayed=False,
            # Leave other fields as None/default
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


def format_track_preview(track: ManAdjTrack | EDJTrack, limit: int = 10) -> str:
    """Format track info for preview display."""
    if isinstance(track, ManAdjTrack):
        bpm_str = f"{track.bpm} BPM" if track.bpm else "? BPM"
        key_str = str(track.key) if track.key is not None else "?"
        title = track.title or Path(track.filename).stem
        artist = track.artist or "Unknown"
        path = track.filename
    else:  # EDJTrack
        bpm_str = f"{track.bpm} BPM" if track.bpm else "? BPM"
        key_str = str(track.key) if track.key is not None else "?"
        title = track.title or Path(track.filename or "").stem
        artist = track.artist or "Unknown"
        path = track.path or track.filename or "?"

    return f"{title} - {artist} ({bpm_str}, Key {key_str}) [{path}]"


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
        '--no-import',
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
        # Phase 1: Find tracks in manadj but NOT in Engine DJ
        print("📊 Analyzing libraries...")
        with edj_db.session_m() as edj_session:
            missing_in_edj, stats = find_missing_tracks_in_enginedj(
                manadj_db, edj_session, validate_paths=True
            )

        print(f"  manadj tracks: {stats.manadj_tracks}")
        print(f"  Engine DJ tracks: {stats.enginedj_tracks}")
        print()
        print(f"  Tracks in manadj but NOT in Engine DJ: {stats.missing_in_enginedj}")
        if stats.skipped_file_not_found > 0:
            print(f"  ⚠️  Skipped (file not found): {stats.skipped_file_not_found}")

        # Phase 2: Find tracks in Engine DJ but NOT in manadj (if not --no-import)
        missing_in_manadj = []
        if not args.no_import:
            with edj_db.session_m() as edj_session:
                missing_in_manadj, import_stats = find_missing_tracks_in_manadj(
                    manadj_db, edj_session
                )
            print(f"  Tracks in Engine DJ but NOT in manadj: {import_stats.missing_in_manadj}")
        print()

        # Show preview of tracks to export
        if missing_in_edj:
            print(f"📋 Preview: Tracks to add to Engine DJ (showing first 10):")
            for i, track in enumerate(missing_in_edj[:10], 1):
                print(f"  {i}. {format_track_preview(track)}")
            if len(missing_in_edj) > 10:
                print(f"  ... and {len(missing_in_edj) - 10} more")
            print()

        # Show preview of tracks to import
        if missing_in_manadj:
            print(f"📋 Preview: Tracks to import to manadj (showing first 10):")
            for i, track in enumerate(missing_in_manadj[:10], 1):
                print(f"  {i}. {format_track_preview(track)}")
            if len(missing_in_manadj) > 10:
                print(f"  ... and {len(missing_in_manadj) - 10} more")
            print()

        # Phase 3: Export tracks to Engine DJ (if --apply)
        if missing_in_edj:
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

        # Phase 4: Import tracks from Engine DJ (if --apply and not --no-import)
        if missing_in_manadj and not args.no_import:
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
            print(f"  Exported to Engine DJ: {stats.exported_to_enginedj}")
            if stats.playlist_created:
                print(f"  Playlist created: Yes")
            if not args.no_import:
                print(f"  Imported to manadj: {stats.imported_to_manadj}")
        else:
            print(f"  Would export to Engine DJ: {len(missing_in_edj)}")
            if missing_in_edj:
                print(f"  Would create playlist: Yes")
            if not args.no_import and missing_in_manadj:
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
