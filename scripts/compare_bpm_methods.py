#!/usr/bin/env python3
"""Compare all Essentia BPM detection methods on a single file."""

import sys
from pathlib import Path
from analyze_bpm_essentia import (
    detect_bpm_rhythm_extractor,
    detect_bpm_percival,
    detect_bpm_simple,
    compare_with_id3
)

def compare_methods(audio_path: str):
    """Run all BPM detection methods and compare results."""

    print(f"\n{'='*70}")
    print(f"Comparing BPM Detection Methods")
    print(f"{'='*70}")
    print(f"File: {Path(audio_path).name}\n")

    methods = {
        'RhythmExtractor2013': detect_bpm_rhythm_extractor,
        'Percival2014': detect_bpm_percival,
        'Simple': detect_bpm_simple,
    }

    results = {}

    for name, method_func in methods.items():
        try:
            print(f"Running {name}...", end=' ')
            result = method_func(audio_path)
            bpm = result.get('bpm')
            results[name] = bpm
            print(f"BPM: {bpm:.2f}" if bpm else "Failed")
        except Exception as e:
            print(f"Error: {e}")
            results[name] = None

    # Get ID3 BPM for comparison
    try:
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from backend.track_metadata import read_file_metadata
        metadata = read_file_metadata(audio_path)
        id3_bpm = metadata.bpm if metadata else None
    except:
        id3_bpm = None

    # Summary table
    print(f"\n{'─'*70}")
    print(f"{'Method':<25} {'BPM':<12} {'Diff from ID3':<20}")
    print(f"{'─'*70}")

    if id3_bpm:
        print(f"{'ID3 Tag':<25} {id3_bpm:<12.2f} {'(reference)':<20}")
        print(f"{'─'*70}")

    for name, bpm in results.items():
        if bpm:
            if id3_bpm:
                diff = abs(bpm - id3_bpm)
                diff_percent = (diff / id3_bpm) * 100
                diff_str = f"{diff:+.2f} ({diff_percent:.1f}%)"
            else:
                diff_str = "N/A"
            print(f"{name:<25} {bpm:<12.2f} {diff_str:<20}")
        else:
            print(f"{name:<25} {'Failed':<12} {'N/A':<20}")

    print(f"{'='*70}\n")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: uv run scripts/compare_bpm_methods.py <audio_file>")
        sys.exit(1)

    compare_methods(sys.argv[1])
