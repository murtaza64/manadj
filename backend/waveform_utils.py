"""Utilities for generating waveform data from audio files."""

import librosa
import numpy as np
import json
from typing import Dict


def generate_waveform_data(
    filepath: str,
    target_width_px: int = 2000,
    bar_width_px: int = 2,
    bar_gap_px: int = 1
) -> Dict:
    """
    Generate waveform data from an audio file using librosa.

    Args:
        filepath: Absolute path to the audio file
        target_width_px: Desired width in pixels for the full waveform
        bar_width_px: Width of each bar (matches frontend: 2px)
        bar_gap_px: Gap between bars (matches frontend: 1px)

    Returns:
        Dictionary with keys:
        - sample_rate: int
        - duration: float (seconds)
        - peaks: list of floats [max, min, max, min, ...]
        - samples_per_peak: int

    Raises:
        Exception: If file cannot be loaded or processed
    """
    try:
        # Load audio file (mono, with original sample rate)
        y, sr = librosa.load(filepath, sr=None, mono=True)

        # Calculate duration
        duration = len(y) / sr

        # Calculate how many bars we need
        bar_plus_gap = bar_width_px + bar_gap_px
        num_bars = target_width_px // bar_plus_gap

        # Calculate samples per bar (this is our downsampling factor)
        samples_per_peak = max(1, len(y) // num_bars)

        # Generate peaks by splitting audio into chunks
        peaks = []
        for i in range(0, len(y), samples_per_peak):
            chunk = y[i:i + samples_per_peak]
            if len(chunk) > 0:
                # Store max and min for this chunk
                peaks.append(float(np.max(chunk)))
                peaks.append(float(np.min(chunk)))

        return {
            "sample_rate": int(sr),
            "duration": float(duration),
            "peaks": peaks,
            "samples_per_peak": int(samples_per_peak)
        }

    except Exception as e:
        raise Exception(f"Failed to generate waveform data: {str(e)}")


def waveform_data_to_json(waveform_data: Dict) -> str:
    """Convert waveform peaks array to JSON string for storage."""
    return json.dumps(waveform_data["peaks"])


def json_to_waveform_peaks(json_str: str) -> list:
    """Parse JSON string back to peaks array."""
    return json.loads(json_str)
