#!/usr/bin/env python3
"""
Benchmark BPM detection accuracy across multiple tracks.

Samples random tracks from ~/Music/Tracks and compares detected BPM estimates
against ID3 tags to measure accuracy.

Usage:
    uv run scripts/benchmark_bpm_detection.py
    uv run scripts/benchmark_bpm_detection.py --samples 50
    uv run scripts/benchmark_bpm_detection.py --samples 100 --json
"""

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Optional

# Import BPM analysis functions
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.id3_utils import extract_id3_metadata

# Import the analysis modules
import numpy as np
import essentia.standard as es
from collections import Counter


def get_audio_files(music_dir: Path, sample_size: int) -> list[Path]:
    """Get random sample of audio files from music directory."""
    # Common audio extensions
    extensions = ['*.mp3', '*.flac', '*.m4a', '*.wav', '*.aiff', '*.ogg']

    all_files = []
    for ext in extensions:
        all_files.extend(music_dir.rglob(ext))

    if len(all_files) == 0:
        raise ValueError(f"No audio files found in {music_dir}")

    # Sample randomly
    sample_size = min(sample_size, len(all_files))
    return random.sample(all_files, sample_size)


def load_audio(audio_path: str, trim_seconds: float = 0):
    """Load audio file using Essentia's MonoLoader."""
    loader = es.MonoLoader(filename=audio_path, sampleRate=44100)
    audio = loader()
    sample_rate = 44100

    if trim_seconds > 0:
        trim_samples = int(trim_seconds * sample_rate)
        total_samples = len(audio)

        if total_samples > (2 * trim_samples):
            audio = audio[trim_samples:-trim_samples]

    return audio, sample_rate


def detect_bpm_full(audio_path: str):
    """Detect BPM using full track."""
    audio, sample_rate = load_audio(audio_path, trim_seconds=0)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    if len(bpm_intervals) > 0:
        interval_bpms = 60.0 / bpm_intervals
        mean_bpm = float(np.mean(interval_bpms))
    else:
        mean_bpm = float(bpm)

    return {
        'bpm': float(bpm),
        'bpm_snapped': round(float(bpm)),
        'mean_bpm': mean_bpm,
    }


def detect_bpm_trimmed(audio_path: str, trim_seconds: float = 15.0):
    """Detect BPM with intro/outro trimmed."""
    audio, sample_rate = load_audio(audio_path, trim_seconds=trim_seconds)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    if len(bpm_intervals) > 0:
        interval_bpms = 60.0 / bpm_intervals
        mean_bpm = float(np.mean(interval_bpms))
    else:
        mean_bpm = float(bpm)

    return {
        'bpm': float(bpm),
        'bpm_snapped': round(float(bpm)),
        'mean_bpm': mean_bpm,
    }


def detect_bpm_chunks(audio_path: str, chunk_duration: float = 30.0):
    """Detect BPM for every chunk of the track."""
    audio, sample_rate = load_audio(audio_path, trim_seconds=0)

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")

    chunks = []
    chunk_samples = int(chunk_duration * sample_rate)

    for start_sample in range(0, len(audio), chunk_samples):
        end_sample = min(start_sample + chunk_samples, len(audio))
        chunk_audio = audio[start_sample:end_sample]

        if len(chunk_audio) < sample_rate * 5:
            continue

        try:
            bpm, beats, beats_confidence, estimates, bpm_intervals = rhythm_extractor(chunk_audio)

            if len(bpm_intervals) > 0:
                interval_bpms = 60.0 / bpm_intervals
                mean_bpm = float(np.mean(interval_bpms))
            else:
                mean_bpm = float(bpm)

            chunks.append({
                'bpm': float(bpm),
                'bpm_snapped': round(float(bpm)),
                'mean_bpm': mean_bpm,
                'mean_bpm_snapped': round(mean_bpm),
            })
        except Exception:
            continue

    return chunks


def analyze_track(audio_path: Path) -> Optional[dict]:
    """Run full BPM analysis on a track."""
    try:
        # Get ID3 BPM
        metadata = extract_id3_metadata(str(audio_path))
        if not metadata or 'bpm' not in metadata or metadata['bpm'] is None:
            return None

        id3_bpm = float(metadata['bpm'])

        # Run detection
        full = detect_bpm_full(str(audio_path))
        trimmed = detect_bpm_trimmed(str(audio_path), trim_seconds=15.0)
        chunks = detect_bpm_chunks(str(audio_path), chunk_duration=30.0)

        # Calculate chunk aggregations
        if len(chunks) > 0:
            chunk_detected_bpms = [c['bpm'] for c in chunks]
            chunk_detected_snapped = [c['bpm_snapped'] for c in chunks]
            chunk_mean_bpms = [c['mean_bpm'] for c in chunks]
            chunk_mean_snapped = [c['mean_bpm_snapped'] for c in chunks]

            chunk_agg = {
                'median_detected': float(np.median(chunk_detected_bpms)),
                'median_detected_snap': int(round(np.median(chunk_detected_snapped))),
                'median_mean': float(np.median(chunk_mean_bpms)),
                'median_mean_snap': int(round(np.median(chunk_mean_snapped))),
                'mode_detected_snap': Counter(chunk_detected_snapped).most_common(1)[0][0],
                'mode_mean_snap': Counter(chunk_mean_snapped).most_common(1)[0][0]
            }
        else:
            chunk_agg = None

        # Build estimates
        estimates = {
            'full_detected_snap': full['bpm_snapped'],
            'full_mean_snap': round(full['mean_bpm']),
            'trimmed_detected_snap': trimmed['bpm_snapped'],
            'trimmed_mean_snap': round(trimmed['mean_bpm']),
        }

        if chunk_agg:
            estimates.update({
                'chunks_median_detected_snap': chunk_agg['median_detected_snap'],
                'chunks_median_mean_snap': chunk_agg['median_mean_snap'],
                'chunks_mode_detected_snap': chunk_agg['mode_detected_snap'],
                'chunks_mode_mean_snap': chunk_agg['mode_mean_snap'],
            })

        return {
            'file': audio_path.name,
            'id3_bpm': id3_bpm,
            'estimates': estimates
        }

    except Exception as e:
        print(f"Error analyzing {audio_path.name}: {e}")
        return None


def run_benchmark(music_dir: Path, sample_size: int):
    """Run benchmark on sample of tracks."""
    print(f"Sampling {sample_size} tracks from {music_dir}...")

    audio_files = get_audio_files(music_dir, sample_size)
    print(f"Found {len(audio_files)} tracks to analyze\n")

    # Track accuracy for each estimate method
    accuracy_counts = {}
    total_analyzed = 0
    no_match_count = 0
    skipped_count = 0

    for i, audio_file in enumerate(audio_files, 1):
        print(f"[{i}/{len(audio_files)}] Analyzing: {audio_file.name}")

        result = analyze_track(audio_file)

        if result is None:
            print(f"  → Skipped (no ID3 BPM data)\n")
            skipped_count += 1
            continue

        total_analyzed += 1
        id3_bpm = result['id3_bpm']
        estimates = result['estimates']

        # Get unique estimate values
        unique_estimates = sorted(set(estimates.values()))
        estimates_str = ', '.join(str(int(v)) for v in unique_estimates)

        # Check which estimates match
        matches = []
        for estimate_name, estimate_value in estimates.items():
            if estimate_value == id3_bpm:
                matches.append(estimate_name)
                accuracy_counts[estimate_name] = accuracy_counts.get(estimate_name, 0) + 1

        if matches:
            print(f"  → ID3 BPM: {id3_bpm} | Estimates: [{estimates_str}] | Matches: {', '.join(matches)}\n")
        else:
            print(f"  → ID3 BPM: {id3_bpm} | Estimates: [{estimates_str}] | NO MATCHES\n")
            no_match_count += 1

    return {
        'total_tracks': len(audio_files),
        'analyzed': total_analyzed,
        'skipped': skipped_count,
        'no_match_count': no_match_count,
        'accuracy_counts': accuracy_counts
    }


def print_results(results: dict):
    """Print benchmark results."""
    print(f"\n{'='*80}")
    print(f"BPM Detection Accuracy Benchmark")
    print(f"{'='*80}")
    print(f"Total tracks sampled: {results['total_tracks']}")
    print(f"Tracks analyzed: {results['analyzed']}")
    print(f"Tracks skipped (no ID3 BPM): {results['skipped']}")
    print(f"Tracks with no matching estimates: {results['no_match_count']}")

    print(f"\n{'Estimate Method':<40} {'Accurate':>10}  {'Accuracy %':>12}")
    print(f"{'-'*80}")

    # All possible methods
    all_methods = [
        'full_detected_snap',
        'full_mean_snap',
        'trimmed_detected_snap',
        'trimmed_mean_snap',
        'chunks_median_detected_snap',
        'chunks_median_mean_snap',
        'chunks_mode_detected_snap',
        'chunks_mode_mean_snap',
    ]

    # Get counts for all methods (0 if not present)
    method_counts = [(m, results['accuracy_counts'].get(m, 0)) for m in all_methods]

    # Sort by accuracy count (descending)
    sorted_methods = sorted(method_counts, key=lambda x: x[1], reverse=True)

    for method, count in sorted_methods:
        accuracy_pct = (count / results['analyzed']) * 100 if results['analyzed'] > 0 else 0
        print(f"{method:<40} {count:>10}  {accuracy_pct:>11.1f}%")

    print(f"{'='*80}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Benchmark BPM detection accuracy"
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=20,
        help="Number of random tracks to sample (default: 20)"
    )
    parser.add_argument(
        "--music-dir",
        type=str,
        default=str(Path.home() / "Music" / "Tracks"),
        help="Music directory path (default: ~/Music/Tracks)"
    )
    parser.add_argument(
        "--json",
        action='store_true',
        help="Output results as JSON"
    )

    args = parser.parse_args()

    music_dir = Path(args.music_dir)
    if not music_dir.exists():
        print(f"Error: Music directory not found: {music_dir}")
        return 1

    # Run benchmark
    results = run_benchmark(music_dir, args.samples)

    # Output
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_results(results)

    return 0


if __name__ == '__main__':
    exit(main())
