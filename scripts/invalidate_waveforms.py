#!/usr/bin/env python3
"""Script to invalidate all waveforms - clears database and deletes PNG files."""

import sqlite3
from pathlib import Path
import shutil

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
DB_PATH = PROJECT_ROOT / "data" / "library.db"
WAVEFORMS_DIR = PROJECT_ROOT / "waveforms"


def invalidate_waveforms():
    """Clear waveform database entries and delete PNG files."""

    # Delete database entries
    print("Clearing waveforms from database...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM waveforms")
    count = cursor.fetchone()[0]
    print(f"  Found {count} waveform(s) in database")

    cursor.execute("DELETE FROM waveforms")
    conn.commit()
    conn.close()
    print(f"  ✓ Deleted {count} waveform(s) from database")

    # Delete PNG files
    print("\nDeleting PNG files...")
    if WAVEFORMS_DIR.exists():
        png_files = list(WAVEFORMS_DIR.glob("*.png"))
        print(f"  Found {len(png_files)} PNG file(s)")

        for png_file in png_files:
            png_file.unlink()
            print(f"  ✓ Deleted {png_file.name}")
    else:
        print("  Waveforms directory does not exist")

    print("\n✓ All waveforms invalidated - they will be regenerated on next request")


if __name__ == "__main__":
    invalidate_waveforms()
