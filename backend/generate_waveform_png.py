"""
Standalone script to generate PNG waveform from audio file.

Usage:
    uv run backend/generate_waveform_png.py <audio_file> [OPTIONS]

Options:
    --height HEIGHT              Height per band in pixels (default: 60)
    --samples-per-peak N         Audio samples per data point (default: 2048)
    --pixels-per-point N         Horizontal pixels per data point (default: 1)
    --output PATH                Output PNG path
"""

import argparse
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from waveform_utils import generate_multiband_waveform_data


def generate_waveform_png(
    audio_path: str,
    output_path: str,
    height_per_band: int = 60,
    samples_per_peak: int = 2048,
    pixels_per_point: int = 1,
    layout: str = 'stacked'
) -> None:
    """
    Generate a PNG waveform with 3 frequency bands.

    Args:
        audio_path: Path to audio file
        output_path: Path to save PNG
        height_per_band: Height in pixels for each band (default 60)
        samples_per_peak: Audio samples per data point (default 2048)
        pixels_per_point: Horizontal pixels per data point, enables interpolation (default 1)
        layout: 'stacked' for vertical bands or 'overlayed' for combined (default 'stacked')
    """
    # Generate waveform data using existing function
    waveform_data = generate_multiband_waveform_data(audio_path, samples_per_peak)

    # Extract band data
    low = waveform_data["bands"]["low"]
    mid = waveform_data["bands"]["mid"]
    high = waveform_data["bands"]["high"]

    # Calculate dimensions
    num_points = len(low)  # Each point is a single symmetrical peak
    width = num_points * pixels_per_point

    if layout == 'overlayed':
        total_height = height_per_band
    else:  # stacked
        total_height = height_per_band * 3

    # Create image with dark background
    if layout == 'overlayed':
        # Use RGBA mode for transparency support
        img = Image.new('RGBA', (width, total_height), color=(17, 17, 17, 255))
    else:
        img = Image.new('RGB', (width, total_height), color='#111111')

    # Define colors for each band
    if layout == 'overlayed':
        # Use semi-transparent colors for overlayed view
        colors = {
            'low': '#0055e2',     # Blue - bass (opaque, drawn first)
            'mid': (242, 170, 60, 153),     # Orange - mids (60% opacity)
            'high': (255, 255, 255, 102)    # White - highs (40% opacity)
        }
    else:
        # Use solid colors for stacked view
        colors = {
            'low': '#0055e2',     # Blue - bass
            'mid': '#f2aa3c',     # Orange - mids
            'high': '#ffffff'     # White - highs
        }

    # Render each band
    if layout == 'overlayed':
        # All bands overlay at y_offset=0
        bands = [
            ('low', low, 0),
            ('mid', mid, 0),
            ('high', high, 0)
        ]
    else:  # stacked
        bands = [
            ('low', low, 0),
            ('mid', mid, height_per_band),
            ('high', high, height_per_band * 2)
        ]

    for band_name, peaks, y_offset in bands:
        render_band(img, peaks, y_offset, height_per_band, colors[band_name], pixels_per_point, layout == 'overlayed')

    # Save PNG
    img.save(output_path)
    print(f"Generated waveform PNG: {output_path}")
    print(f"  Dimensions: {width}x{total_height}")
    print(f"  Data points: {num_points}")
    print(f"  Samples per peak: {samples_per_peak}")
    print(f"  Pixels per point: {pixels_per_point}")
    print(f"  Duration: {waveform_data['duration']:.2f}s")


def render_band(
    img: Image.Image,
    peaks: list[float],
    y_offset: int,
    height: int,
    color: str | tuple,
    pixels_per_point: int = 1,
    use_alpha: bool = False
) -> None:
    """
    Render a single frequency band to the image with optional interpolation.
    Renders symmetrically around the center line.

    Args:
        img: PIL Image to draw on
        peaks: Array of [peak, peak, peak, ...] (symmetrical amplitude values)
        y_offset: Vertical offset for this band
        height: Height of this band
        color: Hex color string or RGBA tuple
        pixels_per_point: Horizontal pixels per data point (enables interpolation if > 1)
        use_alpha: Whether to use alpha blending (for overlayed mode)
    """
    draw = ImageDraw.Draw(img, 'RGBA' if use_alpha else 'RGB')
    center_y = y_offset + height // 2

    # Convert hex color to RGB/RGBA tuple
    if isinstance(color, str):
        color_rgb = tuple(int(color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
        if use_alpha:
            color_rgb = color_rgb + (255,)  # Add full opacity
    else:
        color_rgb = color

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

    # Draw filled polygon
    if len(points) > 2:
        draw.polygon(points, fill=color_rgb)


def main():
    parser = argparse.ArgumentParser(
        description='Generate PNG waveform from audio file'
    )
    parser.add_argument(
        'audio_file',
        help='Path to audio file'
    )
    parser.add_argument(
        '--height',
        type=int,
        default=60,
        help='Height per band in pixels (default: 60)'
    )
    parser.add_argument(
        '--samples-per-peak',
        type=int,
        default=2048,
        help='Audio samples per data point (default: 2048)'
    )
    parser.add_argument(
        '--pixels-per-point',
        type=int,
        default=1,
        help='Horizontal pixels per data point for interpolation (default: 1)'
    )
    parser.add_argument(
        '--layout',
        choices=['stacked', 'overlayed'],
        default='stacked',
        help='Layout mode: stacked (3 bands vertically) or overlayed (combined) (default: stacked)'
    )
    parser.add_argument(
        '--output',
        help='Output PNG path (default: <audio_file>_waveform.png)'
    )

    args = parser.parse_args()

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        audio_path = Path(args.audio_file)
        output_path = audio_path.parent / f"{audio_path.stem}_waveform.png"

    # Generate PNG
    generate_waveform_png(
        args.audio_file,
        str(output_path),
        args.height,
        args.samples_per_peak,
        args.pixels_per_point,
        args.layout
    )


if __name__ == '__main__':
    main()
