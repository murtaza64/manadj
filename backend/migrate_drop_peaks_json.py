"""Drop peaks_json column and clear existing waveforms."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "library.db"

def migrate():
    """Drop peaks_json column and delete all waveforms."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Delete all existing waveforms (they need to be regenerated with multiband data)
        cursor.execute("DELETE FROM waveforms")
        print(f"Deleted all waveforms (they will regenerate with 3-band data)")

        # Check if peaks_json column exists
        cursor.execute("PRAGMA table_info(waveforms)")
        columns = [row[1] for row in cursor.fetchall()]

        # Drop peaks_json column if it exists
        if 'peaks_json' in columns:
            # SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
            print("Dropping peaks_json column...")

            # Create new table without peaks_json
            cursor.execute("""
                CREATE TABLE waveforms_new (
                    id INTEGER PRIMARY KEY,
                    track_id INTEGER NOT NULL UNIQUE,
                    sample_rate INTEGER NOT NULL,
                    duration REAL NOT NULL,
                    samples_per_peak INTEGER NOT NULL,
                    low_peaks_json TEXT NOT NULL,
                    mid_peaks_json TEXT NOT NULL,
                    high_peaks_json TEXT NOT NULL,
                    cue_point_time REAL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (track_id) REFERENCES tracks (id)
                )
            """)

            # Create indexes
            cursor.execute("CREATE INDEX idx_waveforms_track_id ON waveforms_new(track_id)")

            # Drop old table and rename new one
            cursor.execute("DROP TABLE waveforms")
            cursor.execute("ALTER TABLE waveforms_new RENAME TO waveforms")

            print("Dropped peaks_json column successfully")
        else:
            print("peaks_json column already removed")

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
