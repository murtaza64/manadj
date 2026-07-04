#!/usr/bin/env python3
"""Invalidate all Waveform data: clears the waveforms table.

The task-system sweep re-enqueues generation for every Track at the next
backend startup (waveform-overhaul issue 02). Full regeneration of a
~1000-track library takes minutes (~0.3s/track).
"""

import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DB_PATH = PROJECT_ROOT / "data" / "library.db"


def invalidate_waveforms():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM waveforms")
    count = cursor.fetchone()[0]
    cursor.execute("DELETE FROM waveforms")
    conn.commit()
    conn.close()
    print(f"Deleted {count} waveform(s); restart the backend to regenerate.")


if __name__ == "__main__":
    invalidate_waveforms()
