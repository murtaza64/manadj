"""
Script to pre-populate waveform data for all tracks in the library.

This script generates waveform data for any tracks that don't already have it.
Run this to avoid on-demand generation during playback.

Usage:
    uv run -m backend.populate_waveforms [--jobs N]

Options:
    --jobs N    Number of parallel workers (default: auto, max: CPU count)
"""

import sys
from pathlib import Path
import time
import argparse
from multiprocessing import Pool, cpu_count
from functools import partial

# Add parent directory to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.models import Track, Waveform
from backend.crud import create_waveform
from backend.database import SessionLocal


def process_track(track_data):
    """
    Worker function to process a single track.

    Args:
        track_data: Tuple of (track_id, track_filename, track_display_name)

    Returns:
        Tuple of (success: bool, track_display_name: str, elapsed_time: float or None, error: str or None)
    """
    track_id, track_filename, track_display_name = track_data

    # Check if file exists
    if not Path(track_filename).exists():
        return (False, track_display_name, None, "File not found")

    # Create new DB session for this worker
    db = SessionLocal()

    try:
        start_time = time.time()
        create_waveform(db, track_id, track_filename)
        elapsed = time.time() - start_time
        return (True, track_display_name, elapsed, None)
    except Exception as e:
        return (False, track_display_name, None, str(e))
    finally:
        db.close()


def populate_waveforms(num_jobs=None):
    """
    Generate waveforms for all tracks that don't have them.

    Args:
        num_jobs: Number of parallel workers. If None, uses min(cpu_count(), 8).
    """
    db = SessionLocal()

    try:
        # Get all tracks
        tracks = db.query(Track).all()
        total_tracks = len(tracks)

        if total_tracks == 0:
            print("No tracks found in library.")
            return

        print(f"Found {total_tracks} tracks in library.")
        print("Checking for missing waveforms...\n")

        # Find tracks without waveforms
        tracks_without_waveforms = []
        for track in tracks:
            existing_waveform = db.query(Waveform).filter(
                Waveform.track_id == track.id
            ).first()

            if not existing_waveform:
                tracks_without_waveforms.append(track)

        missing_count = len(tracks_without_waveforms)

        if missing_count == 0:
            print("✓ All tracks already have waveforms!")
            return

        # Determine number of workers
        if num_jobs is None:
            # Default: use all CPUs, but cap at reasonable limit
            num_workers = min(cpu_count(), 8)
        else:
            # User-specified, but cap at CPU count
            num_workers = min(num_jobs, cpu_count())

        print(f"Found {missing_count} tracks without waveforms.")
        print(f"Generating waveforms for {missing_count}/{total_tracks} tracks using {num_workers} workers...\n")

        # Prepare track data for parallel processing
        track_data_list = [
            (track.id, track.filename, track.title or Path(track.filename).name)
            for track in tracks_without_waveforms
        ]

        # Generate waveforms in parallel
        success_count = 0
        failed_tracks = []
        start_time = time.time()

        with Pool(processes=num_workers) as pool:
            # Process tracks and show progress
            for i, result in enumerate(pool.imap(process_track, track_data_list), 1):
                success, track_name, elapsed, error = result

                if success:
                    print(f"[{i}/{missing_count}] ✓ {track_name} ({elapsed:.2f}s)")
                    success_count += 1
                else:
                    print(f"[{i}/{missing_count}] ✗ {track_name}: {error}")
                    failed_tracks.append((track_name, error))

        total_elapsed = time.time() - start_time

        # Print summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Total tracks: {total_tracks}")
        print(f"Tracks with existing waveforms: {total_tracks - missing_count}")
        print(f"Newly generated waveforms: {success_count}")
        print(f"Failed: {len(failed_tracks)}")
        print(f"Total time: {total_elapsed:.2f}s")
        if success_count > 0:
            avg_time = total_elapsed / missing_count
            rate = success_count / total_elapsed
            print(f"Average time per track: {avg_time:.2f}s")
            print(f"Processing rate: {rate:.2f} tracks/second")

        if failed_tracks:
            print("\nFailed tracks:")
            for track_name, error in failed_tracks:
                print(f"  - {track_name}: {error}")

        print("\n✓ Waveform population complete!")

    except Exception as e:
        print(f"\n✗ Error during waveform population: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Pre-populate waveform data for all tracks in the library."
    )
    parser.add_argument(
        "--jobs", "-j",
        type=int,
        default=None,
        metavar="N",
        help="Number of parallel workers (default: auto-detect, max 8)"
    )

    args = parser.parse_args()

    # Validate jobs argument
    if args.jobs is not None and args.jobs < 1:
        print("Error: --jobs must be at least 1")
        sys.exit(1)

    try:
        populate_waveforms(num_jobs=args.jobs)
    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Exiting...")
        sys.exit(1)
    except Exception as e:
        print(f"\nFatal error: {e}")
        sys.exit(1)
