#!/usr/bin/env python3
"""
Test TempoCNN deep learning BPM detection and compare with existing methods.

This script tests:
1. TempoCNN availability and functionality
2. Majority voting across multiple methods
3. Accuracy comparison with existing approach

Usage:
    uv run scripts/test_tempocnn.py
    uv run scripts/test_tempocnn.py --track-id 510
    uv run scripts/test_tempocnn.py --sample-size 10
"""

import argparse
import sys
from pathlib import Path
from collections import Counter

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal
from backend import crud

try:
    import essentia.standard as es
    import numpy as np
    ESSENTIA_AVAILABLE = True
except ImportError:
    print("ERROR: Essentia not available")
    ESSENTIA_AVAILABLE = False
    sys.exit(1)


def check_tempocnn_available():
    """Check if TempoCNN is available in Essentia."""
    try:
        # Try to access TempoCNN
        hasattr(es, 'TempoCNN')
        print("✅ TempoCNN is available in Essentia")
        return True
    except AttributeError:
        print("❌ TempoCNN not available in this Essentia build")
        return False


def detect_bpm_tempocnn(audio_path: str, model_path: str = None):
    """
    Detect BPM using TempoCNN deep learning model.

    Args:
        audio_path: Path to audio file
        model_path: Path to TempoCNN model file (optional)

    Returns:
        dict with bpm, confidence, and method
    """
    try:
        # TempoCNN requires 11025 Hz
        sr = 11025
        audio = es.MonoLoader(filename=audio_path, sampleRate=sr)()

        # Try to use TempoCNN
        if model_path and Path(model_path).exists():
            global_bpm, local_bpm, local_probs = es.TempoCNN(
                graphFilename=model_path
            )(audio)
        else:
            # Try without model path (use default if available)
            global_bpm, local_bpm, local_probs = es.TempoCNN()(audio)

        # Calculate average confidence from local probabilities
        avg_confidence = float(np.mean(local_probs)) if len(local_probs) > 0 else 0.0

        return {
            'method': 'tempocnn',
            'bpm': float(global_bpm),
            'bpm_snapped': round(float(global_bpm)),
            'confidence': avg_confidence,
            'local_bpm': [float(b) for b in local_bpm],
            'local_probs': [float(p) for p in local_probs]
        }

    except Exception as e:
        print(f"  ⚠️  TempoCNN failed: {str(e)}")
        return None


def detect_bpm_rhythm_extractor(audio_path: str):
    """Detect BPM using RhythmExtractor2013 (current method)."""
    try:
        audio = es.MonoLoader(filename=audio_path, sampleRate=44100)()

        rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
        bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

        # Calculate mean from intervals
        if len(bpm_intervals) > 0:
            interval_bpms = 60.0 / bpm_intervals
            mean_bpm = float(np.mean(interval_bpms))
        else:
            mean_bpm = float(bpm)

        return {
            'method': 'rhythm_extractor',
            'bpm': float(bpm),
            'bpm_snapped': round(float(bpm)),
            'mean_bpm': mean_bpm,
            'mean_bpm_snapped': round(mean_bpm),
            'confidence': float(beats_confidence)
        }

    except Exception as e:
        print(f"  ⚠️  RhythmExtractor failed: {str(e)}")
        return None


def majority_vote(estimates: list[dict], method='simple'):
    """
    Combine multiple BPM estimates using majority voting.

    Args:
        estimates: List of estimate dicts with 'bpm_snapped' and 'confidence'
        method: 'simple', 'weighted', or 'confidence_threshold'

    Returns:
        Winning BPM and vote details
    """
    if not estimates:
        return None, {}

    if method == 'simple':
        # Simple majority: most common BPM
        bpms = [e['bpm_snapped'] for e in estimates]
        vote_counts = Counter(bpms)
        winner = vote_counts.most_common(1)[0][0]

        return winner, {
            'method': 'simple_majority',
            'votes': dict(vote_counts),
            'winner': winner
        }

    elif method == 'weighted':
        # Weighted by confidence
        weighted_votes = {}
        for est in estimates:
            bpm = est['bpm_snapped']
            conf = est.get('confidence', 1.0)
            weighted_votes[bpm] = weighted_votes.get(bpm, 0) + conf

        winner = max(weighted_votes, key=weighted_votes.get)

        return winner, {
            'method': 'weighted_majority',
            'votes': weighted_votes,
            'winner': winner
        }

    elif method == 'confidence_threshold':
        # Only use estimates above confidence threshold
        threshold = 0.5
        high_conf = [e for e in estimates if e.get('confidence', 0) >= threshold]

        if not high_conf:
            # Fall back to all estimates
            high_conf = estimates

        bpms = [e['bpm_snapped'] for e in high_conf]
        vote_counts = Counter(bpms)
        winner = vote_counts.most_common(1)[0][0]

        return winner, {
            'method': 'confidence_threshold',
            'threshold': threshold,
            'filtered_count': len(high_conf),
            'votes': dict(vote_counts),
            'winner': winner
        }


def test_track(track_id: int, db, model_path: str = None):
    """Test BPM detection on a single track."""
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

    # Get stored BPM if available
    stored_bpm = None
    if track.bpm:
        stored_bpm = track.bpm / 100.0  # Convert from centiBPM
        print(f"Stored BPM: {stored_bpm:.1f}")
    else:
        print("Stored BPM: (none)")

    print(f"{'='*80}\n")

    # Collect all estimates
    estimates = []

    # Test RhythmExtractor2013
    print("Testing RhythmExtractor2013...")
    rhythm_result = detect_bpm_rhythm_extractor(str(audio_path))
    if rhythm_result:
        estimates.append(rhythm_result)
        print(f"  ✅ BPM: {rhythm_result['bpm']:.1f} → {rhythm_result['bpm_snapped']}")
        print(f"     Mean BPM: {rhythm_result['mean_bpm']:.1f} → {rhythm_result['mean_bpm_snapped']}")
        print(f"     Confidence: {rhythm_result['confidence']:.3f}")

    # Test TempoCNN
    print("\nTesting TempoCNN...")
    tempocnn_result = detect_bpm_tempocnn(str(audio_path), model_path)
    if tempocnn_result:
        estimates.append(tempocnn_result)
        print(f"  ✅ BPM: {tempocnn_result['bpm']:.1f} → {tempocnn_result['bpm_snapped']}")
        print(f"     Confidence: {tempocnn_result['confidence']:.3f}")
        print(f"     Local estimates: {len(tempocnn_result['local_bpm'])} segments")

    # Majority voting
    if len(estimates) > 1:
        print(f"\n{'='*80}")
        print("MAJORITY VOTING RESULTS")
        print(f"{'='*80}\n")

        for vote_method in ['simple', 'weighted', 'confidence_threshold']:
            winner, details = majority_vote(estimates, method=vote_method)
            print(f"{vote_method.upper()}:")
            print(f"  Winner: {winner} BPM")
            print(f"  Votes: {details.get('votes', {})}")

            if stored_bpm:
                match = "✅" if abs(winner - stored_bpm) < 1.0 else "❌"
                print(f"  {match} Match with stored: {abs(winner - stored_bpm):.1f} BPM difference")
            print()

    return {
        'track_id': track_id,
        'track_title': track_title,
        'stored_bpm': stored_bpm,
        'estimates': estimates
    }


def main():
    parser = argparse.ArgumentParser(description="Test TempoCNN and majority voting")
    parser.add_argument("--track-id", type=int, help="Specific track ID to test")
    parser.add_argument("--sample-size", type=int, default=5, help="Number of random tracks to test")
    parser.add_argument("--model-path", type=str, help="Path to TempoCNN model file")
    args = parser.parse_args()

    print("="*80)
    print("TempoCNN and Majority Voting Test")
    print("="*80)

    # Check TempoCNN availability
    if not check_tempocnn_available():
        print("\n⚠️  TempoCNN not available. Install with:")
        print("   pip install essentia-tensorflow")
        print("\nOr use Essentia version with TensorFlow support")
        return 1

    if args.model_path and not Path(args.model_path).exists():
        print(f"\n⚠️  Model file not found: {args.model_path}")
        print("Continuing without explicit model path (will use default if available)...")

    db = SessionLocal()

    try:
        if args.track_id:
            # Test specific track
            test_track(args.track_id, db, args.model_path)
        else:
            # Test random sample
            tracks = db.query(crud.models.Track).all()

            if len(tracks) == 0:
                print("No tracks found in database")
                return 1

            import random
            sample_tracks = random.sample(tracks, min(args.sample_size, len(tracks)))

            results = []
            for track in sample_tracks:
                result = test_track(track.id, db, args.model_path)
                if result:
                    results.append(result)

            # Summary
            print(f"\n{'='*80}")
            print("SUMMARY")
            print(f"{'='*80}")
            print(f"Tested {len(results)} tracks")
            print(f"TempoCNN available: {'✅' if check_tempocnn_available() else '❌'}")

    finally:
        db.close()

    return 0


if __name__ == "__main__":
    exit(main())
