"""
Migration script to add beatgrids table for beat marker visualization.

Stores tempo changes in Rekordbox format to support variable-tempo tracks.
For constant-tempo tracks, stores single tempo point with track BPM.

Usage:
    uv run backend/migrations/add_beatgrid.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "library.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS beatgrids (
                id INTEGER PRIMARY KEY,
                track_id INTEGER NOT NULL UNIQUE,
                tempo_changes_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (track_id) REFERENCES tracks (id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_beatgrids_track_id ON beatgrids(track_id)")
        conn.commit()
        print("✓ Created beatgrids table")
    except Exception as e:
        conn.rollback()
        print(f"✗ Migration failed: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
