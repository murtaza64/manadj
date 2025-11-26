#!/usr/bin/env python3
"""
Test script to generate PNG waveforms with various parameter combinations.

Usage:
    uv run backend/test_waveform_generation.py <audio_file>
"""

import sys
import subprocess
from pathlib import Path

# Test configurations
TESTS = [
    {
        "name": "1x_default",
        "params": [],
        "description": "Default settings (2048 samples/peak, 1 pixel/point)"
    },
    {
        "name": "2x_interpolated",
        "params": ["--pixels-per-point", "2"],
        "description": "2x resolution with interpolation"
    },
    {
        "name": "3x_interpolated",
        "params": ["--pixels-per-point", "3"],
        "description": "3x resolution with interpolation"
    },
    {
        "name": "4x_interpolated",
        "params": ["--pixels-per-point", "4"],
        "description": "4x resolution with interpolation"
    },
    {
        "name": "higher_detail_1024spp",
        "params": ["--samples-per-peak", "1024"],
        "description": "Higher detail (1024 samples/peak, 1 pixel/point)"
    },
    {
        "name": "higher_detail_1024spp_2x",
        "params": ["--samples-per-peak", "1024", "--pixels-per-point", "2"],
        "description": "Higher detail + 2x interpolation"
    },
    {
        "name": "lower_detail_4096spp",
        "params": ["--samples-per-peak", "4096"],
        "description": "Lower detail (4096 samples/peak, 1 pixel/point)"
    },
    {
        "name": "tall_bands",
        "params": ["--height", "80"],
        "description": "Taller bands (80px per band)"
    },
    {
        "name": "short_bands",
        "params": ["--height", "40"],
        "description": "Shorter bands (40px per band)"
    },
    {
        "name": "overlayed",
        "params": ["--layout", "overlayed"],
        "description": "Overlayed bands (all on top of each other)"
    },
    {
        "name": "overlayed_2x",
        "params": ["--layout", "overlayed", "--pixels-per-point", "2"],
        "description": "Overlayed with 2x interpolation"
    },
    {
        "name": "overlayed_tall",
        "params": ["--layout", "overlayed", "--height", "80"],
        "description": "Overlayed with taller band (80px)"
    },
]


def run_test(audio_file: str, test_config: dict, output_dir: Path):
    """Run a single test configuration."""
    output_file = output_dir / f"{test_config['name']}.png"

    cmd = [
        "uv", "run", "backend/generate_waveform_png.py",
        audio_file,
        "--output", str(output_file),
        *test_config["params"]
    ]

    print(f"\n{'='*60}")
    print(f"Test: {test_config['name']}")
    print(f"Description: {test_config['description']}")
    print(f"Command: {' '.join(cmd)}")
    print(f"{'='*60}")

    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(result.stdout)

        # Get file size
        if output_file.exists():
            size_kb = output_file.stat().st_size / 1024
            print(f"File size: {size_kb:.1f} KB")

        return True
    except subprocess.CalledProcessError as e:
        print(f"ERROR: {e}")
        print(f"STDERR: {e.stderr}")
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: uv run backend/test_waveform_generation.py <audio_file>")
        sys.exit(1)

    audio_file = sys.argv[1]
    audio_path = Path(audio_file)

    if not audio_path.exists():
        print(f"Error: Audio file not found: {audio_file}")
        sys.exit(1)

    # Create output directory
    output_dir = Path("waveform_tests")
    output_dir.mkdir(exist_ok=True)

    print(f"Testing waveform generation with: {audio_path.name}")
    print(f"Output directory: {output_dir.absolute()}")
    print(f"Running {len(TESTS)} tests...")

    # Run all tests
    results = []
    for test_config in TESTS:
        success = run_test(audio_file, test_config, output_dir)
        results.append((test_config["name"], success))

    # Summary
    print(f"\n{'='*60}")
    print("TEST SUMMARY")
    print(f"{'='*60}")

    passed = sum(1 for _, success in results if success)
    failed = len(results) - passed

    for name, success in results:
        status = "✓ PASS" if success else "✗ FAIL"
        print(f"{status}: {name}")

    print(f"\nTotal: {passed} passed, {failed} failed out of {len(results)} tests")
    print(f"Output files in: {output_dir.absolute()}")


if __name__ == "__main__":
    main()
