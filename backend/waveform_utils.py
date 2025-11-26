"""Utilities for generating waveform data from audio files."""

import librosa
import numpy as np
import json
from typing import Dict, Optional
from scipy import signal
from pathlib import Path
from PIL import Image, ImageDraw


def generate_multiband_waveform_data(
    filepath: str,
    samples_per_peak: int = 128
) -> Dict:
    """
    Generate 3-band frequency waveform data from an audio file.

    Splits audio into three frequency bands:
    - Low: 20-250 Hz (bass)
    - Mid: 250-4000 Hz (midrange)
    - High: 4000-20000 Hz (treble)

    Args:
        filepath: Absolute path to the audio file
        samples_per_peak: Number of audio samples to aggregate into each peak
                         Default 128 (~2.9ms at 44.1kHz) provides high detail for zoom

    Returns:
        Dictionary with keys:
        - sample_rate: int
        - duration: float (seconds)
        - samples_per_peak: int
        - bands: dict with keys 'low', 'mid', 'high', each containing
          list of floats [peak, peak, peak, ...] representing symmetrical amplitude

    Raises:
        Exception: If file cannot be loaded or processed
    """
    try:
        # Load audio file (mono, with original sample rate)
        y, sr = librosa.load(filepath, sr=None, mono=True)

        # Calculate duration
        duration = len(y) / sr

        # Define frequency bands
        # Note: Nyquist frequency is sr/2, so we cap high frequencies there
        # Using 600 Hz cutoff (industry standard) for unified bass representation
        nyquist = sr / 2
        bands_config = {
            'low': (20, min(600, nyquist)),      # Bass unified: kick + bass
            'mid': (600, min(4000, nyquist)),    # Midrange: vocals + snares
            'high': (4000, min(20000, nyquist))  # Highs: cymbals + air
        }

        # Generate peaks for each frequency band
        bands_data = {}

        # Amplitude scaling to emphasize bass (low stays at 1.0, reduce mid/high)
        band_scaling = {
            'low': 1.0,
            'mid': 0.7,
            'high': 0.5
        }

        for band_name, (low_freq, high_freq) in bands_config.items():
            # Skip band if frequency range is invalid
            if low_freq >= high_freq or low_freq >= nyquist:
                bands_data[band_name] = []
                continue

            # Design bandpass filter
            # Using 5th order Butterworth filter
            sos = signal.butter(5, [low_freq, high_freq], btype='bandpass', fs=sr, output='sos')

            # Apply filter (filtfilt for zero-phase filtering)
            y_filtered = signal.sosfiltfilt(sos, y)

            # Generate symmetrical peaks for this band
            # Take the maximum absolute value (larger of max or |min|)
            peaks = []
            for i in range(0, len(y_filtered), samples_per_peak):
                chunk = y_filtered[i:i + samples_per_peak]
                if len(chunk) > 0:
                    max_val = float(np.max(chunk))
                    min_val = float(np.min(chunk))
                    # Use the larger absolute value for symmetrical rendering
                    peak = max(abs(max_val), abs(min_val))
                    # Apply band-specific amplitude scaling
                    peak *= band_scaling[band_name]
                    peaks.append(peak)

            bands_data[band_name] = peaks

        return {
            "sample_rate": int(sr),
            "duration": float(duration),
            "samples_per_peak": int(samples_per_peak),
            "bands": bands_data
        }

    except Exception as e:
        raise Exception(f"Failed to generate multiband waveform data: {str(e)}")


def multiband_waveform_to_json(band_peaks: list) -> str:
    """Convert a single band's peaks array to JSON string for storage."""
    return json.dumps(band_peaks)


def json_to_band_peaks(json_str: Optional[str]) -> Optional[list]:
    """Parse JSON string back to band peaks array."""
    if json_str is None:
        return None
    return json.loads(json_str)


def generate_waveform_png_file(
    audio_path: str,
    output_path: str,
    samples_per_peak: int = 1024,
    pixels_per_point: int = 2,
    height_per_band: int = 60
) -> Dict:
    """
    Generate PNG waveform file from audio file.

    Uses symmetrical rendering with higher detail settings optimized
    for the PNG-based waveform renderer.

    Args:
        audio_path: Path to audio file
        output_path: Path to save PNG file
        samples_per_peak: Audio samples per data point (default 1024 for higher detail)
        pixels_per_point: Horizontal pixels per data point for interpolation (default 2)
        height_per_band: Height in pixels for each band (default 60)

    Returns:
        Dictionary with:
        - width: PNG width in pixels
        - height: PNG height in pixels
        - path: Output file path
        - duration: Audio duration in seconds
        - data_points: Number of waveform data points
    """
    # Generate waveform data
    waveform_data = generate_multiband_waveform_data(audio_path, samples_per_peak)

    # Extract band data
    low = waveform_data["bands"]["low"]
    mid = waveform_data["bands"]["mid"]
    high = waveform_data["bands"]["high"]

    # Calculate dimensions
    num_points = len(low)  # Each point is a single symmetrical peak
    width = num_points * pixels_per_point
    total_height = 120  # Fixed height for overlayed waveform

    # Create base image with dark background
    img = Image.new('RGBA', (width, total_height), color=(17, 17, 17, 255))

    # Define colors (RGB) and alpha values separately for proper compositing
    bands = [
        ('low', low, (0, 85, 226), 255),        # Blue - bass (full opacity)
        ('mid', mid, (255, 80, 80), 180),       # Red - mids (70% opacity)
        ('high', high, (120, 255, 120), 140)    # Light green - highs (55% opacity)
    ]

    # Render each band on a separate layer and composite with proper alpha blending
    for band_name, peaks, color_rgb, alpha in bands:
        # Create a temporary layer for this band
        layer = Image.new('RGBA', (width, total_height), color=(0, 0, 0, 0))

        # Draw the band on the layer with full color
        color_full = (*color_rgb, 255)  # Full opacity for drawing
        _render_png_band(layer, peaks, 0, total_height, color_full, pixels_per_point)

        # Adjust the layer's overall alpha
        if alpha < 255:
            # Create an alpha mask
            alpha_layer = layer.split()[3]  # Get the alpha channel
            alpha_layer = alpha_layer.point(lambda p: int(p * alpha / 255))
            layer.putalpha(alpha_layer)

        # Composite this layer onto the base image
        img = Image.alpha_composite(img, layer)

    # Save PNG
    img.save(output_path)

    return {
        "width": width,
        "height": total_height,
        "path": output_path,
        "duration": waveform_data["duration"],
        "data_points": num_points
    }


def _render_png_band(
    img: Image.Image,
    peaks: list[float],
    y_offset: int,
    height: int,
    color: tuple[int, int, int, int],
    pixels_per_point: int = 1
) -> None:
    """
    Render a single frequency band to the PNG image with interpolation and transparency.
    Renders symmetrically around the center line.

    Args:
        img: PIL Image to draw on (must be RGBA mode)
        peaks: Array of symmetrical amplitude values
        y_offset: Vertical offset for this band
        height: Height of this band
        color: RGBA color tuple (R, G, B, A)
        pixels_per_point: Horizontal pixels per data point (enables interpolation if > 1)
    """
    draw = ImageDraw.Draw(img, 'RGBA')
    center_y = y_offset + height // 2

    # Build polygon points for filled symmetrical waveform
    points = []
    num_points = len(peaks)

    # Top edge (positive peaks) with interpolation
    for point_idx in range(num_points):
        peak_val = peaks[point_idx]

        # Get next point for interpolation (or use current if at end)
        next_peak_val = peaks[point_idx + 1] if point_idx + 1 < len(peaks) else peak_val

        # Generate interpolated pixels for this data point
        for pixel in range(pixels_per_point):
            if pixels_per_point == 1:
                # No interpolation needed
                x = point_idx
                interpolated_val = peak_val
            else:
                # Linear interpolation between current and next point
                t = pixel / pixels_per_point
                x = point_idx * pixels_per_point + pixel
                interpolated_val = peak_val + (next_peak_val - peak_val) * t

            y = center_y - int(interpolated_val * height / 2)
            points.append((x, y))

    # Bottom edge (negative peaks) in reverse with interpolation
    for point_idx in range(num_points - 1, -1, -1):
        peak_val = peaks[point_idx]

        # Get next point for interpolation (or use current if at end)
        next_peak_val = peaks[point_idx + 1] if point_idx + 1 < len(peaks) else peak_val

        # Generate interpolated pixels for this data point
        for pixel in range(pixels_per_point - 1, -1, -1):
            if pixels_per_point == 1:
                # No interpolation needed
                x = point_idx
                interpolated_val = peak_val
            else:
                # Linear interpolation between current and next point
                t = pixel / pixels_per_point
                x = point_idx * pixels_per_point + pixel
                interpolated_val = peak_val + (next_peak_val - peak_val) * t

            y = center_y + int(interpolated_val * height / 2)
            points.append((x, y))

    # Draw filled polygon with transparency support
    if len(points) > 2:
        draw.polygon(points, fill=color)
