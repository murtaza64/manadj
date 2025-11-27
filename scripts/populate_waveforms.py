"""
Script to pre-populate waveform data for all tracks in the library.

This script generates waveform data for any tracks that don't already have it.
Run this to avoid on-demand generation during playback.

Usage:
    uv run -m backend.populate_waveforms
"""

import sys
from pathlib import Path
import time

# Add parent directory to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.models import Track, Waveform
from backend.crud import create_waveform
from backend.database import SessionLocal


def populate_waveforms():
    """Generate waveforms for all tracks that don't have them."""
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

        print(f"Found {missing_count} tracks without waveforms.")
        print(f"Generating waveforms for {missing_count}/{total_tracks} tracks...\n")

        # Generate waveforms
        success_count = 0
        failed_tracks = []

        for i, track in enumerate(tracks_without_waveforms, 1):
            track_name = track.title or Path(track.filename).name
            print(f"[{i}/{missing_count}] Generating waveform for: {track_name}")

            # Check if file exists
            if not Path(track.filename).exists():
                print(f"  ✗ File not found: {track.filename}")
                failed_tracks.append((track, "File not found"))
                continue

            try:
                start_time = time.time()
                waveform = create_waveform(db, track.id, track.filename)
                elapsed = time.time() - start_time

                print(f"  ✓ Generated in {elapsed:.2f}s")
                success_count += 1

            except Exception as e:
                print(f"  ✗ Failed: {str(e)}")
                failed_tracks.append((track, str(e)))

        # Print summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Total tracks: {total_tracks}")
        print(f"Tracks with existing waveforms: {total_tracks - missing_count}")
        print(f"Newly generated waveforms: {success_count}")
        print(f"Failed: {len(failed_tracks)}")

        if failed_tracks:
            print("\nFailed tracks:")
            for track, error in failed_tracks:
                track_name = track.title or Path(track.filename).name
                print(f"  - {track_name}: {error}")

        print("\n✓ Waveform population complete!")

    except Exception as e:
        print(f"\n✗ Error during waveform population: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    try:
        populate_waveforms()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Exiting...")
        sys.exit(1)
    except Exception as e:
        print(f"\nFatal error: {e}")
        sys.exit(1)
