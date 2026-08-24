#!/usr/bin/env -S uv run --script
"""Run the Routine miner over every Session in a library DB and report
(routines 157 validation).

Usage: uv run scripts/routine_miner_report.py [data/library.db] [--session N]

Prints per-session candidates (cast as playlist positions where the cast
lives in a playlist, plus track ids and windows) and the corpus-wide
practice-discrimination tally. Expected on the 2026-08-24 real corpus:
s19's finale yields chained candidates at relentless groove positions
#17–20 and #20–23, and the practice tally sits in the 128/144
neighborhood (the prototype's numbers were computed with a playlist-20
filter; production mines every track, so small drift is expected).
"""

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.routine_miner import mine_session  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("db", nargs="?", default="data/library.db")
    ap.add_argument("--session", type=int, default=None, help="only this session id")
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    orderings_by_playlist: dict[int, dict[int, int]] = defaultdict(dict)
    for r in con.execute("select playlist_id, track_id, position from playlist_tracks"):
        orderings_by_playlist[r["playlist_id"]][r["track_id"]] = r["position"]
    orderings = list(orderings_by_playlist.values())
    playlist_names = dict(con.execute("select id, name from playlists"))
    playlist_ids = list(orderings_by_playlist.keys())

    def describe_cast(cast: list[int]) -> str:
        best = None
        for pl_id, ordering in zip(playlist_ids, orderings):
            if all(tid in ordering for tid in cast):
                pos = [ordering[tid] + 1 for tid in cast]  # 1-based like the protos
                contiguous = sorted(pos) == list(range(min(pos), max(pos) + 1))
                desc = f"{playlist_names[pl_id]} #{min(pos)}-{max(pos)} (entry order {pos})"
                if contiguous:
                    return desc
                best = best or desc + " [non-contiguous]"
        return best or "(cast in no playlist)"

    sessions = con.execute(
        "select id, uuid, started_at from sessions order by started_at"
    ).fetchall()

    total_returns = total_practice = total_candidates = 0
    for s in sessions:
        if args.session is not None and s["id"] != args.session:
            continue
        events = []
        for (ej,) in con.execute(
            "select events_json from session_chunks where session_id=? order by seq",
            (s["id"],),
        ):
            events.extend(json.loads(ej))
        if not events:
            continue
        result = mine_session(events, orderings)
        total_returns += result.n_returns
        total_practice += result.n_practice_returns
        total_candidates += len(result.candidates)
        if result.candidates or result.n_returns:
            print(
                f"s{s['id']} {(s['started_at'] or '')[:10]}: "
                f"{len(result.candidates)} candidates, "
                f"{result.n_practice_returns}/{result.n_returns} returns practice"
            )
        for c in result.candidates:
            print(
                f"    @{c.window_start_s:.0f} dur {c.window_end_s - c.window_start_s:.0f}s"
                f"  cast {c.cast}  ev(ret={c.n_returns}, tri={c.n_triples})"
                f"  {describe_cast(c.cast)}"
            )

    print(
        f"\ncorpus: {total_candidates} candidates; "
        f"{total_practice}/{total_returns} returns practice-flagged"
    )


if __name__ == "__main__":
    main()
