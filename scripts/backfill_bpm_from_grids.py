"""Backfill the internal centibpm column from real Beatgrids (ADR 0027 §2).

One-time data reconcile: for every track with a real (non-generated) grid,
column := the grid's dominant tempo (the served projection). Data script,
not alembic.

HAZARD (issue 01): rows whose GRID is wrong (analysis-curation 02) would
have correct columns overwritten with wrong-grid tempos. Hand-verify those
grids before running.

Usage:
    uv run scripts/backfill_bpm_from_grids.py            # report only
    uv run scripts/backfill_bpm_from_grids.py --apply    # write changes
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.beatgrid_ops import backfill_bpm_from_grids  # noqa: E402
from backend.database import SessionLocal  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="commit the changes")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        changed = backfill_bpm_from_grids(db)
        if args.apply:
            db.commit()
            print(f"reconciled {changed} tracks")
        else:
            db.rollback()
            print(f"would reconcile {changed} tracks (dry run; use --apply)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
