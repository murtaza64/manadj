#!/usr/bin/env python3
"""
Import new tracks from a directory into manadj database.

Scans a directory for audio files and imports any tracks that aren't
already in the manadj database. Extracts metadata from ID3 tags.

Usage:
    python scripts/import_tracks.py --dry-run
    python scripts/import_tracks.py --apply
    python scripts/import_tracks.py --apply --tracks-dir /path/to/tracks
    python scripts/import_tracks.py --apply --recursive
"""

import argparse
import sys
from pathlib import Path
from dataclasses import dataclass

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal
from backend.models import Track
from backend.id3_utils import extract_id3_metadata


# Supported audio file extensions
AUDIO_EXTENSIONS = {'.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.aiff', '.alac'}


@dataclass
class ImportStats:
    """Statistics for import operation."""
    files_scanned: int = 0
    already_in_db: int = 0
    new_tracks: int = 0
    imported: int = 0
    skipped_unsupported: int = 0
    skipped_no_metadata: int = 0
    errors: int = 0


def scan_directory(tracks_dir: Path, recursive: bool = False) -> list[Path]:
    """
    Scan directory for audio files.

    Args:
        tracks_dir: Directory to scan
        recursive: Whether to scan subdirectories recursively

    Returns:
        List of audio file paths
    """
    audio_files = []

    if recursive:
        # Recursive scan
        for ext in AUDIO_EXTENSIONS:
            audio_files.extend(tracks_dir.rglob(f'*{ext}'))
    else:
        # Single directory scan
        for ext in AUDIO_EXTENSIONS:
            audio_files.extend(tracks_dir.glob(f'*{ext}'))

    # Convert to absolute paths and sort
    audio_files = [f.resolve() for f in audio_files]
    audio_files.sort()

    return audio_files


def find_new_tracks(audio_files: list[Path], db_session) -> tuple[list[Path], ImportStats]:
    """
    Find tracks that don't exist in the database.

    Args:
        audio_files: List of audio file paths
        db_session: Database session

    Returns:
        Tuple of (new track paths, stats)
    """
    stats = ImportStats()
    stats.files_scanned = len(audio_files)

    # Get all existing track filenames from database
    existing_tracks = db_session.query(Track.filename).all()
    existing_filenames = {str(Path(t.filename).resolve()) for t in existing_tracks}

    # Find new tracks
    new_tracks = []
    for file_path in audio_files:
        file_path_str = str(file_path)

        # Check if already in database
        if file_path_str in existing_filenames:
            stats.already_in_db += 1
            continue

        new_tracks.append(file_path)
        stats.new_tracks += 1

    return new_tracks, stats


def import_tracks(
    track_paths: list[Path],
    db_session,
    dry_run: bool = True,
    verbose: bool = False
) -> ImportStats:
    """
    Import tracks into database with metadata extraction.

    Args:
        track_paths: List of audio file paths to import
        db_session: Database session
        dry_run: If True, don't actually write to database
        verbose: If True, print detailed progress

    Returns:
        Import statistics
    """
    stats = ImportStats()

    for i, file_path in enumerate(track_paths, 1):
        try:
            if verbose:
                print(f"  [{i}/{len(track_paths)}] Processing: {file_path.name}")

            # Extract metadata from ID3 tags
            metadata = extract_id3_metadata(str(file_path))

            # Skip if no metadata could be extracted
            if not metadata:
                if verbose:
                    print(f"      ⚠️  No metadata found")
                stats.skipped_no_metadata += 1
                continue

            if not dry_run:
                # Create track record
                # BPM is stored as centiBPM (BPM * 100) in database
                bpm = metadata.get('bpm')
                bpm_centi = bpm * 100 if bpm else None

                track = Track(
                    filename=str(file_path),
                    title=metadata.get('title'),
                    artist=metadata.get('artist'),
                    bpm=bpm_centi,
                    key=metadata.get('key'),
                    energy=None,  # User will set manually
                    file_hash=None  # Will be generated if needed
                )

                db_session.add(track)
                stats.imported += 1

                if verbose:
                    title = metadata.get('title', 'Unknown')
                    artist = metadata.get('artist', 'Unknown')
                    bpm = metadata.get('bpm', '?')
                    key = metadata.get('key', '?')
                    print(f"      ✅ {title} - {artist} ({bpm} BPM, Key {key})")
            else:
                stats.imported += 1
                if verbose:
                    title = metadata.get('title', 'Unknown')
                    artist = metadata.get('artist', 'Unknown')
                    print(f"      Would import: {title} - {artist}")

        except Exception as e:
            if verbose:
                print(f"      ❌ Error: {e}")
            stats.errors += 1

    # Commit all changes at once
    if not dry_run and stats.imported > 0:
        try:
            db_session.commit()
        except Exception as e:
            db_session.rollback()
            print(f"❌ Failed to commit changes: {e}")
            stats.errors += stats.imported
            stats.imported = 0
            raise

    return stats


def format_file_list(files: list[Path], limit: int = 10) -> str:
    """Format file list for preview display."""
    lines = []
    for i, file_path in enumerate(files[:limit], 1):
        lines.append(f"  {i}. {file_path.name}")

    if len(files) > limit:
        lines.append(f"  ... and {len(files) - limit} more")

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(
        description='Import new tracks from a directory into manadj database'
    )
    parser.add_argument(
        '--tracks-dir',
        type=Path,
        default=Path.home() / "Music" / "Tracks",
        help='Directory containing audio files (default: ~/Music/Tracks)'
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply changes (default is dry-run mode)'
    )
    parser.add_argument(
        '--recursive',
        action='store_true',
        help='Scan subdirectories recursively'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Print detailed progress for each file'
    )

    args = parser.parse_args()

    # Validate directory
    if not args.tracks_dir.exists():
        print(f"❌ Directory not found: {args.tracks_dir}")
        return 1

    if not args.tracks_dir.is_dir():
        print(f"❌ Not a directory: {args.tracks_dir}")
        return 1

    # Print header
    print("🎵 manadj Track Import")
    print("=" * 70)
    print(f"Mode: {'APPLY CHANGES' if args.apply else 'DRY RUN (use --apply to commit changes)'}")
    print(f"Tracks directory: {args.tracks_dir}")
    print(f"Recursive scan: {'Yes' if args.recursive else 'No'}")
    print()

    # Connect to database
    try:
        db = SessionLocal()
    except Exception as e:
        print(f"❌ Failed to connect to database: {e}")
        return 1

    try:
        # Phase 1: Scan directory for audio files
        print("📂 Scanning for audio files...")
        audio_files = scan_directory(args.tracks_dir, recursive=args.recursive)
        print(f"   Found {len(audio_files)} audio files")
        print()

        if len(audio_files) == 0:
            print("✅ No audio files found.")
            return 0

        # Phase 2: Find new tracks
        print("📊 Checking against database...")
        new_tracks, stats = find_new_tracks(audio_files, db)

        print(f"   Files scanned: {stats.files_scanned}")
        print(f"   Already in database: {stats.already_in_db}")
        print(f"   New tracks: {stats.new_tracks}")
        print()

        if stats.new_tracks == 0:
            print("✅ All tracks are already in the database.")
            return 0

        # Show preview of new tracks
        if new_tracks:
            print(f"📋 Preview: New tracks to import (showing first 10):")
            print(format_file_list(new_tracks, limit=10))
            print()

        # Phase 3: Import tracks
        if args.apply:
            print(f"✅ Importing {len(new_tracks)} new tracks...")
            import_stats = import_tracks(
                new_tracks,
                db,
                dry_run=False,
                verbose=args.verbose
            )

            if not args.verbose:
                print(f"   Imported: {import_stats.imported}")
            if import_stats.skipped_no_metadata > 0:
                print(f"   ⚠️  Skipped (no metadata): {import_stats.skipped_no_metadata}")
            if import_stats.errors > 0:
                print(f"   ❌ Errors: {import_stats.errors}")
        else:
            print(f"✅ Would import {len(new_tracks)} new tracks")

        # Summary
        print()
        print("=" * 70)
        print("📊 Summary:")
        if args.apply:
            print(f"  Successfully imported: {import_stats.imported}")
            if import_stats.skipped_no_metadata > 0:
                print(f"  Skipped (no metadata): {import_stats.skipped_no_metadata}")
            if import_stats.errors > 0:
                print(f"  Errors: {import_stats.errors}")
        else:
            print(f"  Would import: {len(new_tracks)} new tracks")
            print()
            print("Use --apply to execute the import.")

        print()
        return 0

    except Exception as e:
        print(f"❌ Error during import: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        db.close()


if __name__ == '__main__':
    sys.exit(main())
