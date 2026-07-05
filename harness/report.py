"""One-shot shootout comparison report (issue 06).

Aggregates grid results (data/grid_results_*.json) and key results
(data/key_results.json) into a single markdown report, and prepares the
disputed-tier verification sample: for each sampled disputed track, the
Engine value, the Rekordbox value, and a third opinion from the leading
candidates — priors for verification by ear, never a verdict.

Usage:
    uv run -m harness.report [--corpus data/corpus.json]
        [--sample 15] [--third-opinion] [--out data/shootout_report.md]
"""

from __future__ import annotations

import argparse
import glob
import json
import random
import sys
from pathlib import Path

from harness.corpus import CorpusEntry, load_corpus

GRID_RESULTS_GLOB = "data/grid_results_*.json"
KEY_RESULTS = Path("data/key_results.json")


def grid_table(results: list[dict]) -> list[str]:
    lines = [
        "| candidate | n | ok | bail | half/double | wrong | error | phase med (ms) | ≤10ms | ≤25ms |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in sorted(results, key=lambda r: -_rate(r, "ok")):
        s = r["summary"]
        o = s["outcomes"]
        n = sum(o.values())
        ph = s["phase"]
        scored = ph["scored"] or 1
        lines.append(
            f"| {r['candidate']} | {n} "
            f"| {_pct(o.get('ok', 0), n)} | {_pct(o.get('bail', 0), n)} "
            f"| {_pct(o.get('half_double', 0), n)} | {_pct(o.get('wrong', 0), n)} "
            f"| {_pct(o.get('error', 0), n)} "
            f"| {ph['median_ms']} | {_pct(ph['within_10ms'], scored)} "
            f"| {_pct(ph['within_25ms'], scored)} |"
        )
    return lines


def key_table(report: dict) -> list[str]:
    lines = [
        "| candidate | n | mixable | weighted | exact | fifth | relative | parallel | other | undet/err |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    rows = sorted(report.items(), key=lambda kv: -(kv[1]["summary"]["mixable_rate"] or 0))
    for name, data in rows:
        s = data["summary"]
        n = s["n"]
        if not n:
            continue
        c = s["classes"]
        lines.append(
            f"| {name} | {n} | {s['mixable_rate']:.1%} | {s['weighted_score']:.3f} "
            f"| {_pct(c.get('exact', 0), n)} | {_pct(c.get('fifth', 0), n)} "
            f"| {_pct(c.get('relative', 0), n)} | {_pct(c.get('parallel', 0), n)} "
            f"| {_pct(c.get('other', 0), n)} "
            f"| {c.get('undetected', 0) + c.get('error', 0)} |"
        )
    return lines


def winner_failures(results: list[dict], top: str) -> list[str]:
    r = next((x for x in results if x["candidate"] == top), None)
    if r is None:
        return []
    fails = [s for s in r["scores"] if s["outcome"] not in ("ok", "no_truth")]
    lines = [f"### {top} failures ({len(fails)})", ""]
    for s in fails:
        detail = s["evidence"].get("reason", "") if s["evidence"] else ""
        fit_bpm = s.get("fit_bpm")
        lines.append(
            f"- `{s['outcome']}` {Path(s['filename']).name}"
            f" — fit={fit_bpm} {detail}"
        )
    return lines


def disputed_sample_data(
    entries: list[CorpusEntry], n: int, seed: int, third_opinion: bool
) -> list[dict]:
    disputed = [
        e
        for e in entries
        if (e.key.tier == "disputed" or e.bpm.tier == "disputed")
        and Path(e.filename).exists()
    ]
    sample = random.Random(seed).sample(disputed, min(n, len(disputed)))

    key_opinion = {}
    bpm_opinion = {}
    if third_opinion:
        from harness.fit import fit_constant_grid
        from harness.grid_candidates import GRID_CANDIDATES
        from harness.key_candidates import KEY_CANDIDATES

        keycnn = KEY_CANDIDATES["madmom_keycnn"]
        dbn = GRID_CANDIDATES["madmom_dbn"]
        for e in sample:
            print(f"third opinion: {Path(e.filename).name}", file=sys.stderr)
            if e.key.tier == "disputed":
                try:
                    k, _ = keycnn.key(e.filename)
                    key_opinion[e.filename] = k.openkey if k else "?"
                except Exception:
                    key_opinion[e.filename] = "error"
            if e.bpm.tier == "disputed":
                try:
                    fit = fit_constant_grid(dbn.ticks(e.filename), dbn.fit_params)
                    bpm_opinion[e.filename] = fit.bpm if not fit.bailed else "bail"
                except Exception:
                    bpm_opinion[e.filename] = "error"

    rows: list[dict] = []
    for e in sample:
        if e.key.tier == "disputed":
            rows.append(
                {
                    "filename": e.filename,
                    "field": "key",
                    "engine": e.key.engine.openkey,
                    "rb": e.key.rb.openkey,
                    "third": key_opinion.get(e.filename),
                }
            )
        if e.bpm.tier == "disputed":
            rows.append(
                {
                    "filename": e.filename,
                    "field": "bpm",
                    "engine": e.bpm.engine,
                    "rb": e.bpm.rb,
                    "third": bpm_opinion.get(e.filename),
                }
            )
    return rows


def disputed_sample_lines(rows: list[dict]) -> list[str]:
    lines = [
        "Verify by ear; record verdicts in "
        "`.scratch/native-analysis-accuracy/overrides.toml` (full path, "
        "`key`/`bpm`), then rebuild the corpus.",
        "",
        "| track | field | Engine | Rekordbox | 3rd opinion |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {Path(r['filename']).name} | {r['field']} | {r['engine']} "
            f"| {r['rb']} | {r['third'] if r['third'] is not None else ''} |"
        )
    lines += ["", "Full paths for the overrides file:", ""]
    lines += [f"- `{f}`" for f in dict.fromkeys(r["filename"] for r in rows)]
    return lines


def _rate(r: dict, outcome: str) -> float:
    o = r["summary"]["outcomes"]
    n = sum(o.values())
    return o.get(outcome, 0) / n if n else 0.0


def _pct(x: int, n: int) -> str:
    return f"{x / n:.1%}" if n else "-"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=Path("data/corpus.json"))
    parser.add_argument("--sample", type=int, default=15)
    parser.add_argument("--sample-seed", type=int, default=1991)
    parser.add_argument(
        "--third-opinion",
        action="store_true",
        help="run leading candidates on the disputed sample (slow)",
    )
    parser.add_argument("--out", type=Path, default=Path("data/shootout_report.md"))
    args = parser.parse_args()

    grid_results = [json.loads(Path(p).read_text()) for p in sorted(glob.glob(GRID_RESULTS_GLOB))]
    key_report = json.loads(KEY_RESULTS.read_text()) if KEY_RESULTS.exists() else {}
    entries = load_corpus(args.corpus)

    lines = ["# Shootout report", ""]
    lines += ["## Grid candidates (gold-tier BPM truth; phase vs Engine)", ""]
    lines += grid_table(grid_results)
    if grid_results:
        top = max(grid_results, key=lambda r: _rate(r, "ok"))["candidate"]
        lines += ["", *winner_failures(grid_results, top)]
    lines += ["", "## Key candidates (gold-tier key truth)", ""]
    lines += key_table(key_report)
    lines += ["", "## Disputed verification sample", ""]
    rows = disputed_sample_data(entries, args.sample, args.sample_seed, args.third_opinion)
    lines += disputed_sample_lines(rows)
    Path("data/disputed_sample.json").write_text(json.dumps(rows, indent=2))

    args.out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines[: len(lines) - 0]))
    print(f"\nreport -> {args.out}")


if __name__ == "__main__":
    main()
