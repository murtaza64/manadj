#!/usr/bin/env python3
"""Ladder-respecting analysis backfill (native-analysis-accuracy 11).

One bulk run over the whole library with the shootout winners (madmom_dbn
grid, madmom_keycnn key). The overwrite ladder protects Engine-imported and
hand-edited data; currency markers make re-runs skip already-current
analysis; bailed tracks land on the needs-attention worklist.

REAL-DB OPERATION: run in the default workspace after landing
(docs/agents/parallel-work.md). Expect madmom compute time per analyzed
track; protected/current tracks cost nothing.

Usage:
    uv run scripts/backfill_analysis.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.analysis_backfill import backfill_analysis  # noqa: E402
from backend.database import SessionLocal  # noqa: E402
from backend.grid_analysis import default_grid_analyzer  # noqa: E402
from backend.key_analysis import default_key_candidate  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        summary = backfill_analysis(
            db, default_grid_analyzer(), default_key_candidate()
        )
    finally:
        db.close()

    print()
    print(f"Backfill complete: {summary.total} tracks")
    print(f"  grid: {_fmt(summary.grid)}")
    print(f"  key:  {_fmt(summary.key)}")
    print(f"  errors: {summary.errors}")
    if summary.bailed_tracks:
        print()
        print(f"Bailed ({len(summary.bailed_tracks)}) — the needs-attention worklist:")
        for track_id, title in summary.bailed_tracks:
            print(f"  {track_id}: {title or '(untitled)'}")


def _fmt(side: dict[str, int]) -> str:
    order = ("written", "bailed", "undetected", "skipped_ladder", "skipped_current", "error")
    parts = [f"{k.replace('_', '-')} {side[k]}" for k in order if k in side]
    return ", ".join(parts) if parts else "nothing to do"


if __name__ == "__main__":
    main()
