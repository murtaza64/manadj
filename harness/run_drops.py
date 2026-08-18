"""Run the drop-detection shootout (structure-analysis 01).

Reads the sandbox DB (tracks with a slot-4 Hot Cue — the Drop anchor by
convention — plus Beatgrid and Waveform blob), runs every candidate in
harness.drop_candidates, scores against slot 4, and writes
data/drop_results.json for harness.drop_report.

Headline metric (PRD structure-analysis): drop hit rate — detected drop
within ±1 bar of slot 4, measured in bars via the Track's own Beatgrid.

Rankings: "raw" (candidate score order) and "early" (earliest-strong
re-ranking, drop_candidates.early_rerank — slot 4 is the first drop by
convention, so earlier strong hypotheses win). --sweep prints hit@1 per
alpha instead of writing results.

Usage:
    uv run -m harness.run_drops [--limit N] [--alpha A] [--sweep]
"""

from __future__ import annotations

import argparse
import base64
import json
import sqlite3
import time
from pathlib import Path

import numpy as np

from backend.beatgrid_utils import calculate_beats_from_tempo_changes
from backend.waveform_data import decode_blob
from harness.drop_candidates import CANDIDATES, early_rerank

DB = Path("data/library.db")
OUT = Path("data/drop_results.json")

DEFAULT_ALPHA = 0.6  # earliest-strong threshold (picked by --sweep, 787 tracks)

STRIP_COLS = 700  # display strip resolution (columns) for the report
STRIP_GROUPS = [(0, 2), (2, 5), (5, 8)]  # low / mid / high band aggregates


def load_corpus(limit: int | None) -> list[sqlite3.Row]:
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    q = """
      SELECT t.id, t.filename, t.duration_secs, t.bpm,
             h.time_seconds AS gt,
             b.tempo_changes_json, b.origin AS grid_origin,
             w.data_blob
      FROM tracks t
      JOIN hotcues h   ON h.track_id = t.id AND h.slot_number = 4
      JOIN beatgrids b ON b.track_id = t.id
      JOIN waveforms w ON w.track_id = t.id AND w.data_blob IS NOT NULL
      WHERE t.archived_at IS NULL
      ORDER BY t.id
    """
    rows = db.execute(q).fetchall()
    return rows[:limit] if limit else rows


def display_strip(bands_amp: np.ndarray) -> dict:
    """Downsample the band matrix to a 3-row (low/mid/high) uint8 strip."""
    n = len(bands_amp)
    cols = min(STRIP_COLS, n)
    idx = (np.arange(cols + 1) * n // cols).astype(int)
    rows = []
    for lo, hi in STRIP_GROUPS:
        curve = bands_amp[:, lo:hi].mean(axis=1)
        pooled = np.array([curve[idx[i] : idx[i + 1]].max(initial=0.0) for i in range(cols)])
        rows.append(pooled)
    strip = np.stack(rows)  # [3, cols]
    strip = strip / max(strip.max(), 1e-9)
    strip_u8 = (np.sqrt(strip) * 255).astype(np.uint8)  # gamma for visibility
    return {
        "cols": cols,
        "b64": base64.b64encode(strip_u8.tobytes()).decode(),
    }


def bar_duration_at(downbeats: list[float], t: float) -> float:
    db = np.asarray(downbeats)
    if len(db) < 2:
        return 2.0
    i = int(np.clip(np.abs(db - t).argmin(), 0, len(db) - 2))
    return float(db[i + 1] - db[i])


def rank_metrics(hyps: list, order: list[int], gt: float, bar: float) -> dict:
    errs = [abs(hyps[i][0] - gt) / bar for i in order]
    return {
        "err_bars_top1": round(errs[0], 3) if errs else None,
        "hit1_1bar": bool(errs and errs[0] <= 1.0),
        "hit3_1bar": bool(any(e <= 1.0 for e in errs[:3])),
        "hit5_1bar": bool(any(e <= 1.0 for e in errs[:5])),
        "hit1_2bar": bool(errs and errs[0] <= 2.0),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--alpha", type=float, default=DEFAULT_ALPHA)
    ap.add_argument("--sweep", action="store_true",
                    help="print hit@1 per earliest-strong alpha, write nothing")
    args = ap.parse_args()

    corpus = load_corpus(args.limit)
    print(f"corpus: {len(corpus)} tracks (slot-4 + grid + blob)")

    all_hyps: list[dict] = []  # per track: {name: (hyps, gt, bar)}
    tracks_out = []
    t0 = time.time()
    for n, row in enumerate(corpus, 1):
        wf = decode_blob(row["data_blob"])
        bands_u8 = wf["bands"].astype(np.float32) / 255.0
        bands_amp = bands_u8 ** (1.0 / wf["gamma"])  # undo storage gamma
        frames = len(bands_amp)
        times = (
            np.arange(frames, dtype=np.float64) * wf["band_hop"]
            + wf["stft_window"] / 2
        ) / wf["sample_rate"]

        tempo_changes = json.loads(row["tempo_changes_json"])
        duration = row["duration_secs"] or wf["duration"]
        _, downbeats = calculate_beats_from_tempo_changes(tempo_changes, duration)
        if len(downbeats) < 4:
            continue

        gt = float(row["gt"])
        bar = bar_duration_at(downbeats, gt)

        track_hyps = {name: (fn(bands_amp, times, downbeats), gt, bar)
                      for name, fn in CANDIDATES.items()}
        all_hyps.append(track_hyps)
        if args.sweep:
            if n % 100 == 0:
                print(f"  {n}/{len(corpus)}  ({time.time() - t0:.0f}s)")
            continue

        preds = {}
        for name, (hyps, _, _) in track_hyps.items():
            order = early_rerank(hyps, args.alpha)
            preds[name] = {
                "hyps": [[round(t, 3), round(s, 4)] for t, s in hyps],
                "early_order": order,
                "m": {
                    "raw": rank_metrics(hyps, list(range(len(hyps))), gt, bar),
                    "early": rank_metrics(hyps, order, gt, bar),
                },
            }

        tracks_out.append(
            {
                "id": row["id"],
                "path": row["filename"],
                "name": Path(row["filename"]).name,
                "bpm": (row["bpm"] or 0) / 100.0,
                "grid_origin": row["grid_origin"],
                "duration": duration,
                "gt": round(gt, 3),
                "bar": round(bar, 4),
                "phrase_ticks": [round(d, 2) for d in downbeats[::8]],
                "strip": display_strip(bands_amp),
                "preds": preds,
            }
        )
        if n % 100 == 0:
            print(f"  {n}/{len(corpus)}  ({time.time() - t0:.0f}s)")

    if args.sweep:
        alphas = [0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9]
        print(f"\nhit@1 ±1 bar by earliest-strong alpha ({len(all_hyps)} tracks)")
        print(f"{'candidate':24} {'raw':>7} " + "".join(f"{a:>7}" for a in alphas))
        for name in CANDIDATES:
            cells = []
            for a in alphas:
                hits = sum(
                    rank_metrics(h[name][0], early_rerank(h[name][0], a),
                                 h[name][1], h[name][2])["hit1_1bar"]
                    for h in all_hyps
                )
                cells.append(hits / len(all_hyps))
            raw = sum(
                rank_metrics(h[name][0], list(range(len(h[name][0]))),
                             h[name][1], h[name][2])["hit1_1bar"]
                for h in all_hyps
            ) / len(all_hyps)
            print(f"{name:24} {raw:>7.1%} " + "".join(f"{c:>7.1%}" for c in cells))
        return

    summary = {}
    for ranking in ("raw", "early"):
        summary[ranking] = {}
        for name in CANDIDATES:
            rows = [t["preds"][name]["m"][ranking] for t in tracks_out]
            errs = [r["err_bars_top1"] for r in rows if r["err_bars_top1"] is not None]
            summary[ranking][name] = {
                "hit1_1bar": round(sum(r["hit1_1bar"] for r in rows) / len(rows), 4),
                "hit3_1bar": round(sum(r["hit3_1bar"] for r in rows) / len(rows), 4),
                "hit5_1bar": round(sum(r["hit5_1bar"] for r in rows) / len(rows), 4),
                "hit1_2bar": round(sum(r["hit1_2bar"] for r in rows) / len(rows), 4),
                "median_err_bars": round(float(np.median(errs)), 3) if errs else None,
            }

    OUT.write_text(
        json.dumps(
            {
                "n_tracks": len(tracks_out),
                "candidates": list(CANDIDATES),
                "alpha": args.alpha,
                "summary": summary,
                "tracks": tracks_out,
            }
        )
    )
    print(f"\nresults -> {OUT}  ({time.time() - t0:.0f}s)  alpha={args.alpha}")
    for ranking in ("raw", "early"):
        print(f"\n[{ranking}]")
        print(f"{'candidate':24} {'hit@1 ±1bar':>12} {'hit@3':>7} {'hit@5':>7} {'±2bar':>7} {'med err':>8}")
        for name, s in summary[ranking].items():
            print(
                f"{name:24} {s['hit1_1bar']:>12.1%} {s['hit3_1bar']:>7.1%} "
                f"{s['hit5_1bar']:>7.1%} {s['hit1_2bar']:>7.1%} {s['median_err_bars']:>8}"
            )


if __name__ == "__main__":
    main()
