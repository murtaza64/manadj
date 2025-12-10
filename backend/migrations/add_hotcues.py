"""
Migration script to add hotcues table for DJ hot cue markers.

Stores 8 hot cue slots per track with beat-quantized positions.
Each hot cue can be set, triggered for playback/preview, and deleted.

Usage:
    uv run backend/migrations/add_hotcues.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "library.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS hotcues (
                id INTEGER PRIMARY KEY,
                track_id INTEGER NOT NULL,
                slot_number INTEGER NOT NULL,
                time_seconds REAL NOT NULL,
                label TEXT,
                color TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE CASCADE,
                UNIQUE(track_id, slot_number)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_hotcues_track_id ON hotcues(track_id)")
        conn.commit()
        print("✓ Created hotcues table")
    except Exception as e:
        conn.rollback()
        print(f"✗ Migration failed: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
