#!/usr/bin/env python3
"""
Test libkeyfinder key detection and compare with Essentia KeyExtractor.

This script tests:
1. libkeyfinder availability and functionality
2. Accuracy comparison with Essentia KeyExtractor
3. Consistency with DJ software (Rekordbox/Serato/Mixxx)

Usage:
    uv run scripts/test_keyfinder.py
    uv run scripts/test_keyfinder.py --track-id 510
    uv run scripts/test_keyfinder.py --sample-size 50
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal
from backend import crud
from backend.key import Key

try:
    import essentia.standard as es
    ESSENTIA_AVAILABLE = True
except ImportError:
    print("ERROR: Essentia not available")
    ESSENTIA_AVAILABLE = False
    sys.exit(1)

try:
    import keyfinder
    KEYFINDER_AVAILABLE = True
except ImportError:
    KEYFINDER_AVAILABLE = False

# Check for keyfinder-cli as alternative
import subprocess
import shutil
import os

# Check common locations for keyfinder-cli
KEYFINDER_CLI_PATH = None
for path in [shutil.which('keyfinder-cli'),
             os.path.expanduser('~/.local/bin/keyfinder-cli'),
             '/usr/local/bin/keyfinder-cli']:
    if path and os.path.exists(path):
        KEYFINDER_CLI_PATH = path
        break

KEYFINDER_CLI_AVAILABLE = KEYFINDER_CLI_PATH is not None


def check_keyfinder_available():
    """Check if keyfinder is available."""
    if KEYFINDER_AVAILABLE:
        print("✅ libkeyfinder Python package is available")
        return True, 'python'
    elif KEYFINDER_CLI_AVAILABLE:
        print("✅ keyfinder-cli is available")
        return True, 'cli'
    else:
        print("❌ libkeyfinder not available")
        return False, None


def detect_key_essentia(audio_path: str):
    """
    Detect key using Essentia KeyExtractor (current method).

    Returns:
        dict with key, scale, confidence, and formats
    """
    try:
        # Load audio
        audio = es.MonoLoader(filename=audio_path, sampleRate=44100)()

        # Extract key
        key_extractor = es.KeyExtractor()
        key, scale, strength = key_extractor(audio)

        # Convert to musical notation
        if scale.lower() == 'minor':
            musical_key = f"{key}m"
        else:
            musical_key = key

        # Convert to multiple formats using Key class
        key_obj = Key.from_musical(musical_key)

        if key_obj:
            formats = {
                'musical': key_obj.musical,
                'openkey': key_obj.openkey,
                'camelot': key_obj.camelot,
                'engine_id': key_obj.engine_id
            }
        else:
            formats = {
                'musical': musical_key,
                'openkey': None,
                'camelot': None,
                'engine_id': None
            }

        return {
            'method': 'essentia',
            'key': musical_key,
            'scale': scale,
            'confidence': float(strength),
            'formats': formats
        }

    except Exception as e:
        print(f"  ⚠️  Essentia KeyExtractor failed: {str(e)}")
        return None


def detect_key_libkeyfinder(audio_path: str, method='python'):
    """
    Detect key using libkeyfinder (DJ-optimized).

    Args:
        audio_path: Path to audio file
        method: 'python' for Python wrapper, 'cli' for keyfinder-cli

    Returns:
        dict with key and formats
    """
    try:
        if method == 'python' and KEYFINDER_AVAILABLE:
            # Use libkeyfinder Python wrapper
            key_obj_kf = keyfinder.key(audio_path)

            # Get all formats
            musical_key = str(key_obj_kf)
            camelot = key_obj_kf.camelot()
            openkey = key_obj_kf.open_key()

        elif method == 'cli' and KEYFINDER_CLI_AVAILABLE:
            # Use keyfinder-cli via subprocess (default is standard notation)
            result = subprocess.run([KEYFINDER_CLI_PATH, audio_path],
                                  capture_output=True, text=True, check=True)
            musical_key = result.stdout.strip()

            # Get Open Key notation (keyfinder-cli uses 'openkey' not 'open-key')
            result = subprocess.run([KEYFINDER_CLI_PATH, '-n', 'openkey', audio_path],
                                  capture_output=True, text=True, check=True)
            openkey = result.stdout.strip()

            # Convert to our Key class to get Camelot
            key_obj_temp = Key.from_musical(musical_key)
            camelot = key_obj_temp.camelot if key_obj_temp else None
        else:
            return None

        # Convert to our Key class for engine_id
        key_obj = Key.from_musical(musical_key)

        return {
            'method': 'libkeyfinder',
            'key': musical_key,
            'scale': 'minor' if 'm' in musical_key else 'major',
            'confidence': 1.0,  # libkeyfinder doesn't provide confidence
            'formats': {
                'musical': musical_key,
                'openkey': openkey,
                'camelot': camelot,
                'engine_id': key_obj.engine_id if key_obj else None
            }
        }

    except Exception as e:
        print(f"  ⚠️  libkeyfinder failed: {str(e)}")
        return None


def test_track(track_id: int, db, keyfinder_method='python'):
    """Test key detection on a single track."""
    track = crud.get_track(db, track_id)
    if not track:
        print(f"❌ Track {track_id} not found")
        return None

    audio_path = Path(track.filename)
    if not audio_path.exists():
        print(f"❌ Audio file not found: {track.filename}")
        return None

    track_title = f"{track.artist} - {track.title}" if track.artist and track.title else track.filename
    print(f"\n{'='*80}")
    print(f"Testing: {track_title}")
    print(f"Track ID: {track_id}")

    # Get stored key if available
    stored_key = None
    stored_key_musical = None
    if track.key is not None:
        stored_key_obj = Key.from_engine_id(track.key)
        stored_key = track.key
        stored_key_musical = stored_key_obj.musical if stored_key_obj else f"ID:{track.key}"
        camelot = stored_key_obj.camelot if stored_key_obj else "?"
        print(f"Stored Key: {stored_key_musical} ({camelot})")
    else:
        print("Stored Key: (none)")

    print(f"{'='*80}\n")

    # Test Essentia KeyExtractor
    print("Testing Essentia KeyExtractor...")
    essentia_result = detect_key_essentia(str(audio_path))
    if essentia_result:
        print(f"  ✅ Key: {essentia_result['key']} ({essentia_result['formats']['camelot']})")
        print(f"     Confidence: {essentia_result['confidence']:.3f}")
        if stored_key is not None:
            match = "✅" if essentia_result['formats']['engine_id'] == stored_key else "❌"
            print(f"  {match} Match with stored: {match == '✅'}")
    else:
        essentia_result = None

    # Test libkeyfinder
    print("\nTesting libkeyfinder...")
    libkeyfinder_result = detect_key_libkeyfinder(str(audio_path), method=keyfinder_method)
    if libkeyfinder_result:
        print(f"  ✅ Key: {libkeyfinder_result['key']} ({libkeyfinder_result['formats']['camelot']})")
        print(f"     Open Key: {libkeyfinder_result['formats']['openkey']}")
        if stored_key is not None:
            match = "✅" if libkeyfinder_result['formats']['engine_id'] == stored_key else "❌"
            print(f"  {match} Match with stored: {match == '✅'}")
    else:
        libkeyfinder_result = None

    # Compare results
    if essentia_result and libkeyfinder_result:
        print(f"\n{'='*80}")
        print("COMPARISON")
        print(f"{'='*80}")
        essentia_key = essentia_result['key']
        libkeyfinder_key = libkeyfinder_result['key']

        if essentia_key == libkeyfinder_key:
            print(f"✅ Both methods agree: {essentia_key}")
        else:
            print(f"❌ Methods disagree:")
            print(f"   Essentia: {essentia_key} ({essentia_result['formats']['camelot']})")
            print(f"   libkeyfinder: {libkeyfinder_key} ({libkeyfinder_result['formats']['camelot']})")

        if stored_key is not None:
            essentia_match = essentia_result['formats']['engine_id'] == stored_key
            libkeyfinder_match = libkeyfinder_result['formats']['engine_id'] == stored_key

            if essentia_match and libkeyfinder_match:
                print(f"✅ Both match stored key: {stored_key_musical}")
            elif essentia_match:
                print(f"✅ Essentia matches stored, libkeyfinder does not")
            elif libkeyfinder_match:
                print(f"✅ libkeyfinder matches stored, Essentia does not")
            else:
                print(f"❌ Neither matches stored key: {stored_key_musical}")

    return {
        'track_id': track_id,
        'track_title': track_title,
        'stored_key': stored_key,
        'stored_key_musical': stored_key_musical,
        'essentia': essentia_result,
        'libkeyfinder': libkeyfinder_result
    }


def main():
    parser = argparse.ArgumentParser(description="Test libkeyfinder and compare with Essentia")
    parser.add_argument("--track-id", type=int, help="Specific track ID to test")
    parser.add_argument("--sample-size", type=int, default=50, help="Number of random tracks to test")
    parser.add_argument("--all", action="store_true", help="Test all tracks")
    args = parser.parse_args()

    print("="*80)
    print("Key Detection Comparison: Essentia vs libkeyfinder")
    print("="*80)

    # Check availability
    if not ESSENTIA_AVAILABLE:
        print("\n⚠️  Essentia not available. Cannot proceed.")
        return 1

    keyfinder_available, keyfinder_method = check_keyfinder_available()
    if not keyfinder_available:
        print("\n⚠️  libkeyfinder not available.")
        print("Install with:")
        print("   # Build and install libkeyfinder:")
        print("   cd /tmp && git clone https://github.com/mixxxdj/libkeyfinder.git")
        print("   cd libkeyfinder && cmake -DCMAKE_INSTALL_PREFIX=/usr/local -S . -B build")
        print("   cmake --build build --parallel $(sysctl -n hw.logicalcpu)")
        print("   sudo cmake --install build")
        print()
        print("   # Then build keyfinder-cli:")
        print("   cd /tmp && git clone https://github.com/evanpurkhiser/keyfinder-cli.git")
        print("   cd keyfinder-cli && cmake -DCMAKE_INSTALL_PREFIX=/usr/local -S . -B build")
        print("   cmake --build build --parallel $(sysctl -n hw.logicalcpu)")
        print("   sudo cmake --install build")
        return 1

    db = SessionLocal()

    try:
        if args.track_id:
            # Test specific track
            test_track(args.track_id, db, keyfinder_method)
        else:
            # Test sample or all tracks
            tracks = db.query(crud.models.Track).all()

            if len(tracks) == 0:
                print("No tracks found in database")
                return 1

            if args.all:
                sample_tracks = tracks
            else:
                import random
                sample_tracks = random.sample(tracks, min(args.sample_size, len(tracks)))

            results = []
            for track in sample_tracks:
                result = test_track(track.id, db, keyfinder_method)
                if result:
                    results.append(result)

            # Summary
            print(f"\n{'='*80}")
            print("SUMMARY")
            print(f"{'='*80}")
            print(f"Tested {len(results)} tracks\n")

            # Calculate statistics
            essentia_matches = 0
            libkeyfinder_matches = 0
            both_match = 0
            essentia_only = 0
            libkeyfinder_only = 0
            neither_match = 0
            agreement = 0
            tracks_with_stored_key = 0

            for result in results:
                if result['stored_key'] is not None:
                    tracks_with_stored_key += 1

                    essentia_match = (result['essentia'] and
                                    result['essentia']['formats']['engine_id'] == result['stored_key'])
                    libkeyfinder_match = (result['libkeyfinder'] and
                                        result['libkeyfinder']['formats']['engine_id'] == result['stored_key'])

                    if essentia_match:
                        essentia_matches += 1
                    if libkeyfinder_match:
                        libkeyfinder_matches += 1

                    if essentia_match and libkeyfinder_match:
                        both_match += 1
                    elif essentia_match:
                        essentia_only += 1
                    elif libkeyfinder_match:
                        libkeyfinder_only += 1
                    else:
                        neither_match += 1

                # Check agreement between methods
                if (result['essentia'] and result['libkeyfinder'] and
                    result['essentia']['key'] == result['libkeyfinder']['key']):
                    agreement += 1

            print(f"Tracks with stored key: {tracks_with_stored_key}")
            print()

            if tracks_with_stored_key > 0:
                essentia_accuracy = (essentia_matches / tracks_with_stored_key) * 100
                libkeyfinder_accuracy = (libkeyfinder_matches / tracks_with_stored_key) * 100

                print("Accuracy (vs stored keys):")
                print(f"  Essentia:      {essentia_accuracy:.1f}% ({essentia_matches}/{tracks_with_stored_key})")
                print(f"  libkeyfinder:  {libkeyfinder_accuracy:.1f}% ({libkeyfinder_matches}/{tracks_with_stored_key})")
                print()

                print("Match breakdown:")
                print(f"  Both match:         {both_match}")
                print(f"  Essentia only:      {essentia_only}")
                print(f"  libkeyfinder only:  {libkeyfinder_only}")
                print(f"  Neither match:      {neither_match}")
                print()

            agreement_pct = (agreement / len(results)) * 100
            print(f"Method agreement: {agreement_pct:.1f}% ({agreement}/{len(results)} tracks)")

            # Recommendation
            print(f"\n{'='*80}")
            if tracks_with_stored_key > 0:
                improvement = libkeyfinder_accuracy - essentia_accuracy
                if improvement > 10:
                    print("✅ RECOMMENDATION: Switch to libkeyfinder")
                    print(f"   libkeyfinder is {improvement:.1f}% more accurate")
                elif improvement > 0:
                    print("⚠️  RECOMMENDATION: Consider libkeyfinder")
                    print(f"   libkeyfinder is {improvement:.1f}% more accurate (modest improvement)")
                    print("   Also consider DJ software consistency")
                elif improvement < -10:
                    print("⚠️  RECOMMENDATION: Keep Essentia")
                    print(f"   Essentia is {-improvement:.1f}% more accurate")
                else:
                    print("⚠️  RECOMMENDATION: Similar accuracy")
                    print("   Consider other factors: speed, DJ software consistency")

    finally:
        db.close()

    return 0


if __name__ == "__main__":
    exit(main())
