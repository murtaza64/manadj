"""
Migration script to add png_path column to waveforms table.
This script is idempotent - safe to run multiple times.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "library.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("ALTER TABLE waveforms ADD COLUMN png_path VARCHAR")
        conn.commit()
        print("✓ Added png_path column to waveforms table")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower():
            print("✓ png_path column already exists")
        else:
            raise
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
