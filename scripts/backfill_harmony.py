#!/usr/bin/env python3
"""Harmony analysis backfill (chord-match #387).

Analyzes every active Track the startup sweep would (missing row, older
HARMONY_VERSION, or mix-analyzed with stems now current) in a process pool;
idempotent and interrupt-safe (rows commit as they finish). ~1-3 s per Track
per worker.

REAL-DB OPERATION after landing: run in the default workspace
(docs/agents/parallel-work.md). In a lane it targets the sandbox DB.

Usage:
    uv run scripts/backfill_harmony.py [--workers N] [--limit N] [--all]
"""

import argparse
import json
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import models
from backend.database import SessionLocal
from backend.harmony import analyze_track_audio
from backend.harmony_tasks import current_stems_dir, store_result, tracks_needing_harmony


def _work(tempo_changes, filename, stems):
    return analyze_track_audio(tempo_changes, filename, stems)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--all", action="store_true", help="re-analyze every active Track")
    args = parser.parse_args()

    db = SessionLocal()
    if args.all:
        tracks = (
            db.query(models.Track)
            .join(models.Beatgrid, models.Beatgrid.track_id == models.Track.id)
            .filter(models.Track.is_active)
            .all()
        )
    else:
        tracks = tracks_needing_harmony(db)
    tracks = tracks[: args.limit] if args.limit else tracks
    grids = {
        g.track_id: json.loads(g.tempo_changes_json)
        for g in db.query(models.Beatgrid).filter(
            models.Beatgrid.track_id.in_([t.id for t in tracks])
        )
    }
    print(f"{len(tracks)} tracks to analyze", flush=True)
    t0 = time.time()
    done = loops = stems = failed = 0
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(_work, grids[t.id], t.filename, current_stems_dir(t)): t.id
            for t in tracks
        }
        for fut in as_completed(futures):
            track_id = futures[fut]
            done += 1
            try:
                result = fut.result()
            except Exception as err:  # noqa: BLE001 - report and continue
                failed += 1
                print(f"  FAIL track {track_id}: {err}", flush=True)
                continue
            store_result(db, track_id, result)
            loops += result.loop is not None
            stems += result.source == "stems"
            if done % 50 == 0:
                print(f"  {done}/{len(tracks)} ({time.time() - t0:.0f}s)", flush=True)
    db.close()
    print(
        f"done: {done} analyzed, {loops} with a loop, {stems} from stems, "
        f"{failed} failed, {time.time() - t0:.0f}s"
    )


if __name__ == "__main__":
    main()
