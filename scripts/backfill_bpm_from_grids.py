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

from backend.beatgrid_ops import (  # noqa: E402
    backfill_bpm_from_grids,
    cleanup_placeholder_rows,
)
from backend.database import SessionLocal  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="commit the changes")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        changed = backfill_bpm_from_grids(db)
        deleted, kept = cleanup_placeholder_rows(db)
        if kept:
            print(f"kept {len(kept)} diverged placeholder rows (reconcile the "
                  f"column by hand, then re-run): tracks {kept}")
        if args.apply:
            db.commit()
            print(f"reconciled {changed} tracks; deleted {deleted} pure-derivation placeholder rows")
        else:
            db.rollback()
            print(f"would reconcile {changed} tracks and delete {deleted} "
                  "pure-derivation placeholder rows (dry run; use --apply)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
