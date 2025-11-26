"""
Migration script to convert BPM to centiBPM (BPM * 100) for fractional precision.
Stores BPM as integer (e.g., 128.5 BPM -> 12850) to support fractional BPM values.
This script is idempotent - safe to run multiple times.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "library.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Check if migration has already been run by looking at the data
        cursor.execute("SELECT bpm FROM tracks WHERE bpm IS NOT NULL LIMIT 1")
        result = cursor.fetchone()

        if result and result[0] is not None:
            # If values are < 500, they're likely not yet converted (assuming no one has BPM > 500)
            if result[0] < 500:
                # Convert all BPM values: multiply by 100
                cursor.execute("""
                    UPDATE tracks
                    SET bpm = bpm * 100
                    WHERE bpm IS NOT NULL
                """)

                rows_updated = cursor.rowcount
                conn.commit()
                print(f"✓ Converted {rows_updated} BPM values to centiBPM (BPM * 100)")
            else:
                print("✓ BPM values already converted to centiBPM")
        else:
            print("✓ No BPM values to migrate")

    except Exception as e:
        conn.rollback()
        print(f"✗ Migration failed: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
