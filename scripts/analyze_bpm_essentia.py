#!/usr/bin/env python3
"""
Essentia proof-of-concept for BPM detection.

Usage:
    uv run scripts/analyze_bpm_essentia.py <audio_file>
    uv run scripts/analyze_bpm_essentia.py <audio_file> --method rhythm
    uv run scripts/analyze_bpm_essentia.py <audio_file> --method percival
    uv run scripts/analyze_bpm_essentia.py <audio_file> --json
"""

import argparse
import json
from pathlib import Path
import essentia.standard as es


def load_audio(audio_path: str):
    """
    Load audio file using Essentia's MonoLoader.

    Returns audio as mono, resampled to 44100 Hz.
    """
    loader = es.MonoLoader(filename=audio_path, sampleRate=44100)
    audio = loader()
    return audio


def detect_bpm_rhythm_extractor(audio_path: str):
    """
    Detect BPM using RhythmExtractor2013.

    This is Essentia's comprehensive rhythm analysis algorithm,
    specifically designed for music with constant tempo.

    Returns:
        dict: BPM, confidence, beat positions, and other rhythm features
    """
    # Load audio
    audio = load_audio(audio_path)

    # Initialize RhythmExtractor2013
    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")

    # Extract rhythm features
    # Returns: bpm, beats, beats_confidence, estimates, bpm_intervals
    bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    return {
        'bpm': float(bpm),
        'beats': beats.tolist(),
        'beats_confidence': float(beats_confidence),
        'bpm_estimates': estimates.tolist(),  # Alternative BPM estimates
        'bpm_intervals': bpm_intervals.tolist(),
        'total_beats': len(beats),
        'duration': float(len(audio) / 44100)
    }


def detect_bpm_percival(audio_path: str):
    """
    Detect BPM using Percival2014 algorithm.

    Enhanced beat tracking algorithm specifically for electronic dance music.

    Returns:
        dict: BPM and beat positions
    """
    # Load audio
    audio = load_audio(audio_path)

    # Use Percival2014 for beat tracking
    beat_tracker = es.BeatTrackerMultiFeature()
    beats = beat_tracker(audio)

    # Convert to numpy array if needed
    import numpy as np
    if not isinstance(beats, np.ndarray):
        beats = np.array(beats)

    # Calculate BPM from beat intervals
    if len(beats) > 1:
        beat_intervals = beats[1:] - beats[:-1]
        avg_interval = beat_intervals.mean()
        bpm = 60.0 / avg_interval
    else:
        bpm = None

    return {
        'bpm': float(bpm) if bpm else None,
        'beats': beats.tolist(),
        'total_beats': len(beats),
        'duration': float(len(audio) / 44100)
    }


def detect_bpm_tempo_cnn(audio_path: str):
    """
    Detect BPM using TempoTap algorithm.

    Uses onset-based tempo estimation with beat tracking.

    Returns:
        dict: BPM estimates
    """
    # Load audio
    audio = load_audio(audio_path)

    # Use TempoTap (available in essentia.standard)
    tempo_tap = es.TempoTap()

    # Need to generate ticks for TempoTap
    # Use onset detection to get timing information
    onset_detect = es.OnsetDetection(method='hfc')
    w = es.Windowing(type='hann')
    fft = es.FFT()
    c2p = es.CartesianToPolar()

    onsets = []
    for frame in es.FrameGenerator(audio, frameSize=1024, hopSize=512):
        mag, phase = c2p(fft(w(frame)))
        onsets.append(onset_detect(mag, phase))

    # Get tempo from TempoTap
    import numpy as np
    onsets = np.array(onsets)

    # TempoTap expects tick times, estimate from onsets
    tick_times = []
    for i, onset_val in enumerate(onsets):
        if onset_val > np.mean(onsets) + 2 * np.std(onsets):
            tick_times.append(i * 512 / 44100.0)  # Convert to seconds

    if tick_times:
        bpm = tempo_tap(tick_times)
    else:
        bpm = 0.0

    return {
        'bpm': float(bpm) if bpm > 0 else None,
        'duration': float(len(audio) / 44100)
    }


def detect_bpm_simple(audio_path: str):
    """
    Simple BPM detection using basic onset detection + tempo estimation.

    Fastest method, good for prototyping.

    Returns:
        dict: BPM estimate
    """
    # Load audio
    audio = load_audio(audio_path)

    # Simple onset detection
    onsets = es.OnsetDetection(method='hfc')

    # Use PercivalBpmEstimator for quick BPM estimate
    bpm_estimator = es.PercivalBpmEstimator()

    # Extract onset strength
    w = es.Windowing(type='hann')
    fft = es.FFT()
    c2p = es.CartesianToPolar()

    onset_values = []
    for frame in es.FrameGenerator(audio, frameSize=1024, hopSize=512):
        mag, phase = c2p(fft(w(frame)))
        onset_values.append(onsets(mag, phase))

    # Estimate BPM
    bpm = bpm_estimator(onset_values)

    return {
        'bpm': float(bpm),
        'duration': float(len(audio) / 44100)
    }


def compare_with_id3(audio_path: str, detected_bpm: float):
    """
    Compare detected BPM with ID3 tag (if available).
    """
    try:
        # Try to import id3_utils from backend
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from backend.track_metadata import read_file_metadata

        metadata = read_file_metadata(audio_path)
        id3_bpm = metadata.bpm if metadata else None

        if id3_bpm and detected_bpm:
            diff = abs(detected_bpm - id3_bpm)
            diff_percent = (diff / id3_bpm) * 100

            return {
                'id3_bpm': float(id3_bpm),
                'detected_bpm': float(detected_bpm),
                'difference': float(diff),
                'difference_percent': float(diff_percent),
                'status': 'excellent' if diff_percent < 1 else
                         'good' if diff_percent < 3 else
                         'acceptable' if diff_percent < 5 else 'poor'
            }
    except Exception as e:
        pass

    return None


def format_time(seconds: float) -> str:
    """Format seconds as MM:SS.mmm"""
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes:02d}:{secs:06.3f}"


def print_results(results: dict, audio_path: str, method: str, comparison: dict = None):
    """Print formatted analysis results"""
    print(f"\n{'='*60}")
    print(f"Essentia BPM Detection Results")
    print(f"{'='*60}")
    print(f"File: {Path(audio_path).name}")
    print(f"Method: {method}")
    print(f"Duration: {format_time(results['duration'])}")

    print(f"\nDetected BPM: {results['bpm']:.2f}" if results.get('bpm') else "\nBPM: Unable to detect")

    if results.get('beats_confidence'):
        print(f"Confidence: {results['beats_confidence']:.3f}")

    if results.get('total_beats'):
        print(f"Total beats detected: {results['total_beats']}")

        if results.get('beats') and len(results['beats']) >= 2:
            print(f"\nFirst 5 beat times:")
            for i, beat_time in enumerate(results['beats'][:5]):
                print(f"  Beat {i+1:3d}: {format_time(beat_time)}")

            if len(results['beats']) > 5:
                print(f"  ... ({len(results['beats']) - 5} more beats)")

    if results.get('bpm_estimates') and len(results['bpm_estimates']) > 1:
        print(f"\nAlternative BPM estimates:")
        for i, est in enumerate(results['bpm_estimates'][:3]):
            print(f"  Estimate {i+1}: {est:.2f} BPM")

    # Comparison with ID3 tags
    if comparison:
        print(f"\n{'─'*60}")
        print("Comparison with ID3 Tags:")
        print(f"  ID3 BPM: {comparison['id3_bpm']:.2f}")
        print(f"  Detected BPM: {comparison['detected_bpm']:.2f}")
        print(f"  Difference: {comparison['difference']:.2f} BPM ({comparison['difference_percent']:.1f}%)")

        status_symbols = {
            'excellent': '✓ Excellent match!',
            'good': '✓ Good match',
            'acceptable': '⚠ Acceptable difference',
            'poor': '✗ Large difference - investigate'
        }
        print(f"  {status_symbols.get(comparison['status'], '?')}")

    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Detect BPM from audio file using Essentia"
    )
    parser.add_argument(
        "audio_file",
        type=str,
        help="Path to audio file (mp3, flac, wav, etc.)"
    )
    parser.add_argument(
        "--method",
        type=str,
        choices=['rhythm', 'percival', 'tap', 'simple'],
        default='rhythm',
        help="Detection method (default: rhythm = RhythmExtractor2013)"
    )
    parser.add_argument(
        "--json",
        action='store_true',
        help="Output results as JSON"
    )
    parser.add_argument(
        "--compare",
        action='store_true',
        help="Compare with ID3 BPM tags"
    )

    args = parser.parse_args()

    # Validate audio file exists
    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        print(f"Error: File not found: {audio_path}")
        return 1

    print(f"Analyzing: {audio_path.name}")
    print(f"Method: {args.method}")

    # Detect BPM using selected method
    try:
        if args.method == 'rhythm':
            results = detect_bpm_rhythm_extractor(str(audio_path))
        elif args.method == 'percival':
            results = detect_bpm_percival(str(audio_path))
        elif args.method == 'tap':
            results = detect_bpm_tempo_cnn(str(audio_path))
        elif args.method == 'simple':
            results = detect_bpm_simple(str(audio_path))
        else:
            print(f"Unknown method: {args.method}")
            return 1
    except Exception as e:
        print(f"Error during analysis: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Compare with ID3 if requested
    comparison = None
    if args.compare and results.get('bpm'):
        comparison = compare_with_id3(str(audio_path), results['bpm'])

    # Output
    if args.json:
        output = {
            'file': str(audio_path),
            'method': args.method,
            'results': results
        }
        if comparison:
            output['comparison'] = comparison
        print(json.dumps(output, indent=2))
    else:
        print_results(results, str(audio_path), args.method, comparison)

    return 0


if __name__ == '__main__':
    exit(main())
