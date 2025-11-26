"""Add low_peaks_json, mid_peaks_json, high_peaks_json columns to waveforms table."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "library.db"

def migrate():
    """Add band columns to waveforms table."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(waveforms)")
        columns = [row[1] for row in cursor.fetchall()]

        # Add columns if they don't exist
        if 'low_peaks_json' not in columns:
            cursor.execute("ALTER TABLE waveforms ADD COLUMN low_peaks_json TEXT")
            print("Added low_peaks_json column")

        if 'mid_peaks_json' not in columns:
            cursor.execute("ALTER TABLE waveforms ADD COLUMN mid_peaks_json TEXT")
            print("Added mid_peaks_json column")

        if 'high_peaks_json' not in columns:
            cursor.execute("ALTER TABLE waveforms ADD COLUMN high_peaks_json TEXT")
            print("Added high_peaks_json column")

        conn.commit()
        print("Migration completed successfully")

    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}")
        raise

    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
