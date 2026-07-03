"""Backfill file facts (codec/bitrate/filesize/duration) for library Tracks.

Usage:
    uv run scripts/backfill_file_facts.py            # fill missing only
    uv run scripts/backfill_file_facts.py --force    # recompute everything
                                                     # (out-of-band file edits)
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import SessionLocal  # noqa: E402
from backend.track_metadata.file_facts import refresh_file_facts  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="recompute every track")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        updated = refresh_file_facts(db, force=args.force)
        print(f"updated {updated} tracks")
    finally:
        db.close()


if __name__ == "__main__":
    main()
