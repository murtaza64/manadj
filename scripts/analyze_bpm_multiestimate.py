#!/usr/bin/env python3
"""
Multi-strategy BPM detection with RhythmExtractor2013.

Provides multiple BPM estimates:
1. Full track analysis
2. Trimmed track (remove first/last 15 seconds)
3. Integer-snapped versions of above
4. Optional 30-second chunk analysis

Usage:
    uv run scripts/analyze_bpm_multiestimate.py <audio_file>
    uv run scripts/analyze_bpm_multiestimate.py <audio_file> --json
    uv run scripts/analyze_bpm_multiestimate.py <audio_file> --compare
    uv run scripts/analyze_bpm_multiestimate.py <audio_file> --compare --chunks

Note: This script provides detailed CLI output with extra statistics (median, std_dev, etc.).
      For programmatic use, prefer backend.analysis.analyze_bpm() and backend.analysis.analyze_key()
"""

import argparse
import json
import sys
from pathlib import Path
import numpy as np
import essentia.standard as es

# Import from backend for key conversion
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.key import Key

# Note: Detection functions below are CLI-specific versions with extra statistics.
# For API/programmatic use, use backend.analysis module instead.


def load_audio(audio_path: str, trim_seconds: float = 0):
    """
    Load audio file using Essentia's MonoLoader.

    Args:
        audio_path: Path to audio file
        trim_seconds: Seconds to trim from start and end (0 = no trim)

    Returns:
        Tuple of (audio, sample_rate)
    """
    loader = es.MonoLoader(filename=audio_path, sampleRate=44100)
    audio = loader()
    sample_rate = 44100

    if trim_seconds > 0:
        trim_samples = int(trim_seconds * sample_rate)
        total_samples = len(audio)

        # Only trim if we have enough audio
        if total_samples > (2 * trim_samples):
            audio = audio[trim_samples:-trim_samples]

    return audio, sample_rate


def detect_key(audio_path: str):
    """
    Detect musical key using KeyExtractor.

    Returns:
        dict: Key, scale, strength, and OpenKey notation
    """
    audio, sample_rate = load_audio(audio_path, trim_seconds=0)

    key_extractor = es.KeyExtractor()
    key, scale, strength = key_extractor(audio)

    # Convert to musical notation format (e.g., "C", "Am", "F#")
    # Essentia returns key like "C" and scale like "major" or "minor"
    if scale.lower() == 'minor':
        musical_key = f"{key}m"
    else:
        musical_key = key

    # Convert to OpenKey notation using Key class
    key_obj = Key.from_musical(musical_key)
    openkey = key_obj.openkey if key_obj else None

    return {
        'key': key,
        'scale': scale,
        'strength': float(strength),
        'musical': musical_key,
        'openkey': openkey
    }


def detect_bpm_full(audio_path: str):
    """
    Detect BPM using full track.

    Returns:
        dict: BPM and analysis results
    """
    audio, sample_rate = load_audio(audio_path, trim_seconds=0)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    # Calculate statistics from beat intervals
    if len(bpm_intervals) > 0:
        interval_bpms = 60.0 / bpm_intervals
        mean_bpm = float(np.mean(interval_bpms))
        median_bpm = float(np.median(interval_bpms))
        std_bpm = float(np.std(interval_bpms))
    else:
        mean_bpm = float(bpm)
        median_bpm = float(bpm)
        std_bpm = 0.0

    return {
        'bpm': float(bpm),
        'bpm_snapped': round(float(bpm)),
        'mean_bpm': mean_bpm,
        'median_bpm': median_bpm,
        'std_bpm': std_bpm,
        'confidence': float(beats_confidence),
        'total_beats': len(beats),
        'duration': len(audio) / sample_rate,
        'method': 'full_track'
    }


def detect_bpm_trimmed(audio_path: str, trim_seconds: float = 15.0):
    """
    Detect BPM with intro/outro trimmed.

    Args:
        audio_path: Path to audio file
        trim_seconds: Seconds to trim from start and end

    Returns:
        dict: BPM and analysis results
    """
    audio, sample_rate = load_audio(audio_path, trim_seconds=trim_seconds)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    # Calculate statistics from beat intervals
    if len(bpm_intervals) > 0:
        interval_bpms = 60.0 / bpm_intervals
        mean_bpm = float(np.mean(interval_bpms))
        median_bpm = float(np.median(interval_bpms))
        std_bpm = float(np.std(interval_bpms))
    else:
        mean_bpm = float(bpm)
        median_bpm = float(bpm)
        std_bpm = 0.0

    return {
        'bpm': float(bpm),
        'bpm_snapped': round(float(bpm)),
        'mean_bpm': mean_bpm,
        'median_bpm': median_bpm,
        'std_bpm': std_bpm,
        'confidence': float(beats_confidence),
        'total_beats': len(beats),
        'duration': len(audio) / sample_rate,
        'trim_seconds': trim_seconds,
        'method': f'trimmed_{int(trim_seconds)}s'
    }


def detect_bpm_chunks(audio_path: str, chunk_duration: float = 30.0):
    """
    Detect BPM for every chunk of the track.

    Args:
        audio_path: Path to audio file
        chunk_duration: Duration of each chunk in seconds

    Returns:
        list: List of dicts with BPM for each chunk
    """
    # Load full audio
    audio, sample_rate = load_audio(audio_path, trim_seconds=0)
    total_duration = len(audio) / sample_rate

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")

    chunks = []
    chunk_samples = int(chunk_duration * sample_rate)

    for start_sample in range(0, len(audio), chunk_samples):
        end_sample = min(start_sample + chunk_samples, len(audio))
        chunk_audio = audio[start_sample:end_sample]

        # Skip very short chunks
        if len(chunk_audio) < sample_rate * 5:  # At least 5 seconds
            continue

        start_time = start_sample / sample_rate
        end_time = end_sample / sample_rate

        try:
            bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(chunk_audio)

            # Calculate mean from intervals
            if len(bpm_intervals) > 0:
                interval_bpms = 60.0 / bpm_intervals
                mean_bpm = float(np.mean(interval_bpms))
            else:
                mean_bpm = float(bpm)

            chunks.append({
                'start_time': start_time,
                'end_time': end_time,
                'duration': end_time - start_time,
                'bpm': float(bpm),
                'bpm_snapped': round(float(bpm)),
                'mean_bpm': mean_bpm,
                'mean_bpm_snapped': round(mean_bpm),
                'confidence': float(beats_confidence),
                'total_beats': len(beats)
            })
        except Exception as e:
            # If analysis fails for a chunk, skip it
            continue

    return chunks


def compare_with_id3(audio_path: str, detected_bpm: float):
    """Compare detected BPM with ID3 tag."""
    try:
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
                'difference_percent': float(diff_percent)
            }
    except Exception:
        pass

    return None


def format_comparison(estimate_name: str, bpm: float, id3_bpm: float):
    """Format comparison line for display."""
    diff = bpm - id3_bpm
    diff_percent = (diff / id3_bpm) * 100
    status = '✓' if abs(diff_percent) < 1 else '~' if abs(diff_percent) < 3 else '✗'
    # Handle both float and int BPM values
    if isinstance(bpm, int):
        return f"{estimate_name:<35} {bpm:>7}  {diff:>+6.2f}  ({diff_percent:>+5.1f}%)  {status}"
    else:
        return f"{estimate_name:<35} {bpm:>7.2f}  {diff:>+6.2f}  ({diff_percent:>+5.1f}%)  {status}"


def format_time_range(start: float, end: float) -> str:
    """Format time range as MM:SS - MM:SS."""
    def format_time(seconds: float) -> str:
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes:02d}:{secs:02d}"
    return f"{format_time(start)} - {format_time(end)}"


def print_results(results: dict, audio_path: str, id3_bpm: float = None):
    """Print formatted multi-estimate results."""
    # ANSI color codes
    GREEN = '\033[92m'
    RESET = '\033[0m'

    print(f"\n{'='*100}")
    print(f"BPM Detection Results")
    print(f"{'='*100}")
    print(f"File: {Path(audio_path).name}")
    print(f"Duration: {results['full']['duration']:.2f} seconds")

    if 'key' in results:
        key_info = results['key']
        openkey_str = f" / {key_info['openkey']}" if key_info.get('openkey') else ""
        print(f"Key: {key_info['musical']}{openkey_str} (strength: {key_info['strength']:.3f})")

    if id3_bpm:
        print(f"ID3 Tag BPM: {id3_bpm:.2f}")

    print(f"\n{'Strategy':<30} {'Detected':>8}  {'Det(Snap)':>10}  {'Mean':>8}  {'Mean(Snap)':>11}  {'Diff':>6}  {'% Diff':>9}")
    print(f"{'-'*100}")

    def format_bpm_value(value, is_match):
        """Format BPM value with green color if it matches ID3."""
        if is_match:
            if isinstance(value, int):
                return f"{GREEN}{value:>10}{RESET}"
            else:
                return f"{GREEN}{value:>8.2f}{RESET}"
        else:
            if isinstance(value, int):
                return f"{value:>10}"
            elif isinstance(value, str):
                return f"{value:>8}"
            else:
                return f"{value:>8.2f}"

    # Full track
    full = results['full']
    if id3_bpm:
        detected_match = full['bpm_snapped'] == id3_bpm
        mean_match = round(full['mean_bpm']) == id3_bpm
        diff_mean_snap = round(full['mean_bpm']) - id3_bpm
        diff_percent = (diff_mean_snap / id3_bpm) * 100

        det_str = format_bpm_value(full['bpm'], False)
        det_snap_str = format_bpm_value(full['bpm_snapped'], detected_match)
        mean_str = format_bpm_value(full['mean_bpm'], False)
        mean_snap_str = format_bpm_value(round(full['mean_bpm']), mean_match)

        print(f"{'Full Track':<30} {det_str}  {det_snap_str}  {mean_str}  {mean_snap_str}  "
              f"{diff_mean_snap:>+6.2f}  ({diff_percent:>+5.1f}%)")
    else:
        print(f"{'Full Track':<30} {full['bpm']:>8.2f}  {full['bpm_snapped']:>10}  {full['mean_bpm']:>8.2f}  {round(full['mean_bpm']):>11}")

    # Trimmed track
    trimmed = results['trimmed']
    if id3_bpm:
        detected_match = trimmed['bpm_snapped'] == id3_bpm
        mean_match = round(trimmed['mean_bpm']) == id3_bpm
        diff_mean_snap = round(trimmed['mean_bpm']) - id3_bpm
        diff_percent = (diff_mean_snap / id3_bpm) * 100

        det_str = format_bpm_value(trimmed['bpm'], False)
        det_snap_str = format_bpm_value(trimmed['bpm_snapped'], detected_match)
        mean_str = format_bpm_value(trimmed['mean_bpm'], False)
        mean_snap_str = format_bpm_value(round(trimmed['mean_bpm']), mean_match)

        print(f"{'Trimmed (±' + str(int(trimmed['trim_seconds'])) + 's)':<30} {det_str}  {det_snap_str}  {mean_str}  {mean_snap_str}  "
              f"{diff_mean_snap:>+6.2f}  ({diff_percent:>+5.1f}%)")
    else:
        print(f"{'Trimmed (±' + str(int(trimmed['trim_seconds'])) + 's)':<30} {trimmed['bpm']:>8.2f}  {trimmed['bpm_snapped']:>10}  "
              f"{trimmed['mean_bpm']:>8.2f}  {round(trimmed['mean_bpm']):>11}")

    # Print chunk results if available
    if 'chunks' in results:
        print()
        chunks = results['chunks']
        for chunk in chunks:
            time_range = format_time_range(chunk['start_time'], chunk['end_time'])
            if id3_bpm:
                detected_match = chunk['bpm_snapped'] == id3_bpm
                mean_match = chunk['mean_bpm_snapped'] == id3_bpm
                mean_snapped = chunk['mean_bpm_snapped']
                diff = mean_snapped - id3_bpm
                diff_percent = (diff / id3_bpm) * 100

                det_str = format_bpm_value(chunk['bpm'], False)
                det_snap_str = format_bpm_value(chunk['bpm_snapped'], detected_match)
                mean_str = format_bpm_value(chunk['mean_bpm'], False)
                mean_snap_str = format_bpm_value(mean_snapped, mean_match)

                print(f"{time_range:<30} {det_str}  {det_snap_str}  {mean_str}  {mean_snap_str}  "
                      f"{diff:>+6.2f}  ({diff_percent:>+5.1f}%)")
            else:
                print(f"{time_range:<30} {chunk['bpm']:>8.2f}  {chunk['bpm_snapped']:>10}  {chunk['mean_bpm']:>8.2f}  "
                      f"{chunk['mean_bpm_snapped']:>11}")

        # Add chunk aggregation rows
        print()
        chunk_detected_bpms = [c['bpm'] for c in chunks]
        chunk_detected_snapped = [c['bpm_snapped'] for c in chunks]
        chunk_mean_bpms = [c['mean_bpm'] for c in chunks]
        chunk_mean_snapped = [c['mean_bpm_snapped'] for c in chunks]

        # Median aggregation
        median_detected = float(np.median(chunk_detected_bpms))
        median_detected_snap = int(round(np.median(chunk_detected_snapped)))
        median_mean = float(np.median(chunk_mean_bpms))
        median_mean_snap = int(round(np.median(chunk_mean_snapped)))

        # Mode aggregation (most common value)
        from collections import Counter
        mode_detected_snap = Counter(chunk_detected_snapped).most_common(1)[0][0]
        mode_mean_snap = Counter(chunk_mean_snapped).most_common(1)[0][0]

        # Print median row
        if id3_bpm:
            detected_match = median_detected_snap == id3_bpm
            mean_match = median_mean_snap == id3_bpm
            diff = median_mean_snap - id3_bpm
            diff_percent = (diff / id3_bpm) * 100

            det_str = format_bpm_value(median_detected, False)
            det_snap_str = format_bpm_value(median_detected_snap, detected_match)
            mean_str = format_bpm_value(median_mean, False)
            mean_snap_str = format_bpm_value(median_mean_snap, mean_match)

            print(f"{'Chunks (Median)':<30} {det_str}  {det_snap_str}  {mean_str}  {mean_snap_str}  "
                  f"{diff:>+6.2f}  ({diff_percent:>+5.1f}%)")
        else:
            print(f"{'Chunks (Median)':<30} {median_detected:>8.2f}  {median_detected_snap:>10}  "
                  f"{median_mean:>8.2f}  {median_mean_snap:>11}")

        # Print mode row
        if id3_bpm:
            detected_match = mode_detected_snap == id3_bpm
            mean_match = mode_mean_snap == id3_bpm
            diff = mode_mean_snap - id3_bpm
            diff_percent = (diff / id3_bpm) * 100

            # For mode, we don't show the float values, just the snapped ones
            det_str = format_bpm_value('—', False)
            det_snap_str = format_bpm_value(mode_detected_snap, detected_match)
            mean_str = format_bpm_value('—', False)
            mean_snap_str = format_bpm_value(mode_mean_snap, mean_match)

            print(f"{'Chunks (Mode)':<30} {'—':>8}  {det_snap_str}  {'—':>8}  {mean_snap_str}  "
                  f"{diff:>+6.2f}  ({diff_percent:>+5.1f}%)")
        else:
            print(f"{'Chunks (Mode)':<30} {'—':>8}  {mode_detected_snap:>10}  "
                  f"{'—':>8}  {mode_mean_snap:>11}")

    print(f"{'-'*100}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Multi-strategy BPM detection using RhythmExtractor2013"
    )
    parser.add_argument(
        "audio_file",
        type=str,
        help="Path to audio file"
    )
    parser.add_argument(
        "--trim",
        type=float,
        default=15.0,
        help="Seconds to trim from start/end (default: 15.0)"
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
    parser.add_argument(
        "--chunks",
        action='store_true',
        help="Analyze BPM for every 30-second chunk"
    )
    parser.add_argument(
        "--chunk-duration",
        type=float,
        default=30.0,
        help="Duration of each chunk in seconds (default: 30.0)"
    )

    args = parser.parse_args()

    # Validate audio file
    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        print(f"Error: File not found: {audio_path}")
        return 1

    print(f"Analyzing: {audio_path.name}")

    # Run detection strategies
    try:
        results = {
            'full': detect_bpm_full(str(audio_path)),
            'trimmed': detect_bpm_trimmed(str(audio_path), trim_seconds=args.trim)
        }

        # Detect key
        print("Detecting key...")
        results['key'] = detect_key(str(audio_path))

        # Add chunk analysis if requested
        if args.chunks:
            print("Analyzing chunks...")
            results['chunks'] = detect_bpm_chunks(str(audio_path), chunk_duration=args.chunk_duration)

            # Calculate chunk aggregations
            from collections import Counter
            chunks = results['chunks']

            chunk_detected_bpms = [c['bpm'] for c in chunks]
            chunk_detected_snapped = [c['bpm_snapped'] for c in chunks]
            chunk_mean_bpms = [c['mean_bpm'] for c in chunks]
            chunk_mean_snapped = [c['mean_bpm_snapped'] for c in chunks]

            results['chunk_aggregations'] = {
                'median_detected': float(np.median(chunk_detected_bpms)),
                'median_detected_snap': int(round(np.median(chunk_detected_snapped))),
                'median_mean': float(np.median(chunk_mean_bpms)),
                'median_mean_snap': int(round(np.median(chunk_mean_snapped))),
                'mode_detected_snap': Counter(chunk_detected_snapped).most_common(1)[0][0],
                'mode_mean_snap': Counter(chunk_mean_snapped).most_common(1)[0][0]
            }

        # Build estimates dictionary
        estimates = {
            'full_detected': results['full']['bpm'],
            'full_detected_snap': results['full']['bpm_snapped'],
            'full_mean': results['full']['mean_bpm'],
            'full_mean_snap': round(results['full']['mean_bpm']),
            'trimmed_detected': results['trimmed']['bpm'],
            'trimmed_detected_snap': results['trimmed']['bpm_snapped'],
            'trimmed_mean': results['trimmed']['mean_bpm'],
            'trimmed_mean_snap': round(results['trimmed']['mean_bpm']),
        }

        if 'chunk_aggregations' in results:
            estimates.update({
                'chunks_median_detected': results['chunk_aggregations']['median_detected'],
                'chunks_median_detected_snap': results['chunk_aggregations']['median_detected_snap'],
                'chunks_median_mean': results['chunk_aggregations']['median_mean'],
                'chunks_median_mean_snap': results['chunk_aggregations']['median_mean_snap'],
                'chunks_mode_detected_snap': results['chunk_aggregations']['mode_detected_snap'],
                'chunks_mode_mean_snap': results['chunk_aggregations']['mode_mean_snap'],
            })

        results['estimates'] = estimates

    except Exception as e:
        print(f"Error during analysis: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Get ID3 BPM if comparison requested
    id3_bpm = None
    if args.compare:
        comparison = compare_with_id3(str(audio_path), results['full']['bpm'])
        if comparison:
            id3_bpm = comparison['id3_bpm']

    # Output
    if args.json:
        output = {
            'file': str(audio_path),
            'results': results
        }
        if id3_bpm:
            output['id3_bpm'] = id3_bpm
        print(json.dumps(output, indent=2))
    else:
        print_results(results, str(audio_path), id3_bpm)

    return 0


if __name__ == '__main__':
    exit(main())
