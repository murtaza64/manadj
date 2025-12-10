#!/usr/bin/env python3
"""
Visualize beat detection results with histogram.

Usage:
    uv run scripts/visualize_beats.py <audio_file>
    uv run scripts/visualize_beats.py <audio_file> --save output.png
"""

import argparse
import sys
from pathlib import Path
import numpy as np
import essentia.standard as es

try:
    import matplotlib.pyplot as plt
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False
    print("Warning: matplotlib not installed. Install with: uv add matplotlib")


def analyze_beats(audio_path: str):
    """Analyze beats and return detailed information."""
    # Load audio
    loader = es.MonoLoader(filename=audio_path, sampleRate=44100)
    audio = loader()

    # Extract rhythm features
    rhythm_extractor = es.RhythmExtractor2013(method="multifeature")
    bpm, beats, confidence, estimates, bpm_intervals = rhythm_extractor(audio)

    return {
        'audio': audio,
        'sample_rate': 44100,
        'bpm': float(bpm),
        'beats': beats,
        'confidence': float(confidence),
        'estimates': estimates,
        'bpm_intervals': bpm_intervals,
        'duration': len(audio) / 44100
    }


def plot_beat_histogram(results: dict, audio_path: str, save_path: str = None):
    """Create beat histogram visualization."""
    if not HAS_MATPLOTLIB:
        print("Cannot create plot: matplotlib not installed")
        return

    beats = results['beats']
    bpm_intervals = results['bpm_intervals']
    audio = results['audio']
    sample_rate = results['sample_rate']

    # Create figure with subplots (large size for high resolution)
    fig, axes = plt.subplots(3, 1, figsize=(24, 16))
    fig.suptitle(f"Beat Analysis: {Path(audio_path).name}", fontsize=18, fontweight='bold')

    # Plot 1: Waveform with beat markers
    time = np.arange(len(audio)) / sample_rate
    axes[0].plot(time, audio, color='#89b4fa', linewidth=0.5, alpha=0.7)
    axes[0].vlines(beats, audio.min(), audio.max(), color='#f38ba8', linewidth=1.5, alpha=0.8, label='Beats')
    axes[0].set_xlabel('Time (seconds)', fontsize=10)
    axes[0].set_ylabel('Amplitude', fontsize=10)
    axes[0].set_title('Waveform with Detected Beats', fontsize=11)
    axes[0].legend(loc='upper right')
    axes[0].grid(True, alpha=0.3)
    axes[0].set_facecolor('#1e1e2e')

    # Plot 2: Beat interval histogram
    if len(bpm_intervals) > 0:
        # Convert intervals to BPM for each interval
        interval_bpms = 60.0 / bpm_intervals

        axes[1].hist(interval_bpms, bins=50, color='#a6e3a1', alpha=0.7, edgecolor='#313244')
        axes[1].axvline(results['bpm'], color='#f38ba8', linewidth=2, linestyle='--',
                       label=f"Detected BPM: {results['bpm']:.2f}")
        axes[1].set_xlabel('BPM', fontsize=10)
        axes[1].set_ylabel('Count', fontsize=10)
        axes[1].set_title('Beat Interval Histogram', fontsize=11)
        axes[1].legend(loc='upper right')
        axes[1].grid(True, alpha=0.3, axis='y')
        axes[1].set_facecolor('#1e1e2e')

        # Add statistics text
        mean_bpm = np.mean(interval_bpms)
        std_bpm = np.std(interval_bpms)
        stats_text = f'Mean: {mean_bpm:.2f} BPM\nStd Dev: {std_bpm:.2f} BPM'
        axes[1].text(0.02, 0.98, stats_text, transform=axes[1].transAxes,
                    verticalalignment='top', bbox=dict(boxstyle='round', facecolor='#313244', alpha=0.8),
                    fontsize=9, color='#cdd6f4')

    # Plot 3: Beat intervals over time
    if len(bpm_intervals) > 0:
        beat_times = beats[1:]  # Skip first beat since intervals are between beats
        interval_bpms = 60.0 / bpm_intervals

        axes[2].plot(beat_times, interval_bpms, color='#89dceb', linewidth=1, marker='o',
                    markersize=3, alpha=0.7)
        axes[2].axhline(results['bpm'], color='#f38ba8', linewidth=2, linestyle='--',
                       label=f"Overall BPM: {results['bpm']:.2f}", alpha=0.8)
        axes[2].set_xlabel('Time (seconds)', fontsize=10)
        axes[2].set_ylabel('BPM', fontsize=10)
        axes[2].set_title('BPM Variation Over Time', fontsize=11)
        axes[2].legend(loc='upper right')
        axes[2].grid(True, alpha=0.3)
        axes[2].set_facecolor('#1e1e2e')

        # Add tempo stability indicator
        tempo_std = np.std(interval_bpms)
        stability = "Very Stable" if tempo_std < 1 else "Stable" if tempo_std < 3 else "Variable"
        stability_color = '#a6e3a1' if tempo_std < 1 else '#f9e2af' if tempo_std < 3 else '#f38ba8'
        axes[2].text(0.98, 0.98, f'Tempo: {stability}', transform=axes[2].transAxes,
                    verticalalignment='top', horizontalalignment='right',
                    bbox=dict(boxstyle='round', facecolor=stability_color, alpha=0.8),
                    fontsize=9, color='#1e1e2e', fontweight='bold')

    # Style all plots
    fig.patch.set_facecolor('#1e1e2e')
    for ax in axes:
        ax.spines['bottom'].set_color('#45454f')
        ax.spines['top'].set_color('#45454f')
        ax.spines['left'].set_color('#45454f')
        ax.spines['right'].set_color('#45454f')
        ax.tick_params(colors='#cdd6f4')
        ax.xaxis.label.set_color('#cdd6f4')
        ax.yaxis.label.set_color('#cdd6f4')
        ax.title.set_color('#cdd6f4')

    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=300, facecolor='#1e1e2e', bbox_inches='tight')
        print(f"Plot saved to: {save_path}")
    else:
        plt.show()


def print_beat_statistics(results: dict):
    """Print detailed beat statistics."""
    print(f"\n{'='*60}")
    print(f"Beat Detection Statistics")
    print(f"{'='*60}")
    print(f"Duration: {results['duration']:.2f} seconds")
    print(f"Detected BPM: {results['bpm']:.2f}")
    print(f"Confidence: {results['confidence']:.3f}")
    print(f"Total beats: {len(results['beats'])}")

    if len(results['bpm_intervals']) > 0:
        interval_bpms = 60.0 / results['bpm_intervals']
        print(f"\nBeat Interval Statistics:")
        print(f"  Mean BPM: {np.mean(interval_bpms):.2f}")
        print(f"  Std Dev: {np.std(interval_bpms):.2f}")
        print(f"  Min BPM: {np.min(interval_bpms):.2f}")
        print(f"  Max BPM: {np.max(interval_bpms):.2f}")
        print(f"  Median BPM: {np.median(interval_bpms):.2f}")

        # Calculate tempo stability
        tempo_std = np.std(interval_bpms)
        if tempo_std < 1:
            stability = "Very Stable (consistent tempo)"
        elif tempo_std < 3:
            stability = "Stable (minor variations)"
        else:
            stability = "Variable (significant tempo changes)"
        print(f"  Tempo Stability: {stability}")

    if len(results['estimates']) > 1:
        print(f"\nAlternative BPM Estimates:")
        for i, est in enumerate(results['estimates'][:5]):
            print(f"  Estimate {i+1}: {est:.2f} BPM")

    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Visualize beat detection with histogram"
    )
    parser.add_argument(
        "audio_file",
        type=str,
        help="Path to audio file"
    )
    parser.add_argument(
        "--save",
        type=str,
        help="Save plot to file instead of displaying"
    )
    parser.add_argument(
        "--stats-only",
        action='store_true',
        help="Print statistics without creating plot"
    )

    args = parser.parse_args()

    # Validate audio file
    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        print(f"Error: File not found: {audio_path}")
        return 1

    print(f"Analyzing: {audio_path.name}")

    # Analyze beats
    try:
        results = analyze_beats(str(audio_path))
    except Exception as e:
        print(f"Error during analysis: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Print statistics
    print_beat_statistics(results)

    # Create visualization
    if not args.stats_only:
        if not HAS_MATPLOTLIB:
            print("\nTo create visualizations, install matplotlib:")
            print("  uv add matplotlib")
            return 1

        plot_beat_histogram(results, str(audio_path), args.save)

    return 0


if __name__ == '__main__':
    exit(main())
