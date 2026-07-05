"""Score key candidates against the Ground truth corpus (issue 03).

Runs each candidate over gold-tier corpus tracks and reports the MIREX
breakdown per candidate, headline = mixable rate. Estimates are cached per
candidate so re-scoring is free.

Usage:
    uv run -m harness.run_key [--candidates a,b,...] [--limit N]
        [--corpus data/corpus.json] [--out data/key_results.json]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

from backend.key import Key
from harness.corpus import CorpusEntry, load_corpus
from harness.key_candidates import KEY_CANDIDATES
from harness.key_scoring import classify, summarize_key_scores

DEFAULT_CORPUS = Path("data/corpus.json")
KEY_CACHE_DIR = Path("data/keys")


def scoreable(entries: list[CorpusEntry]) -> list[CorpusEntry]:
    """Gold-tier key truth with the audio present — the headline set."""
    return [
        e
        for e in entries
        if e.key.tier == "gold" and e.key.truth is not None and Path(e.filename).exists()
    ]


def _cache_file(candidate_name: str) -> Path:
    return KEY_CACHE_DIR / f"{candidate_name}.json"


def _load_cache(candidate_name: str) -> dict[str, str | None]:
    p = _cache_file(candidate_name)
    return json.loads(p.read_text()) if p.exists() else {}


def _store_cache(candidate_name: str, cache: dict[str, str | None]) -> None:
    p = _cache_file(candidate_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cache, indent=0))


def run_candidate(
    candidate_name: str,
    entries: list[CorpusEntry],
    progress=lambda msg: None,
) -> list[dict]:
    """Per-track results: filename, estimate (openkey), truth, class."""
    candidate = KEY_CANDIDATES[candidate_name]
    cache = _load_cache(candidate_name)
    results: list[dict] = []
    dirty = False
    for i, e in enumerate(entries):
        if e.filename in cache:
            raw = cache[e.filename]
            estimate = Key.from_openkey(raw) if raw else None
        else:
            try:
                estimate, _conf = candidate.key(e.filename)
            except Exception as exc:  # one bad decode must not kill the run
                progress(f"[{i + 1}/{len(entries)}] ERROR {Path(e.filename).name}: {exc}")
                results.append(
                    {"filename": e.filename, "estimate": None,
                     "truth": e.key.truth.openkey, "class": "error"}
                )
                continue
            cache[e.filename] = estimate.openkey if estimate else None
            dirty = True
        # An abstaining detector still counts against the denominator.
        cls = classify(estimate, e.key.truth) if estimate else "undetected"
        results.append(
            {
                "filename": e.filename,
                "estimate": estimate.openkey if estimate else None,
                "truth": e.key.truth.openkey,
                "class": cls,
            }
        )
        progress(f"[{i + 1}/{len(entries)}] {Path(e.filename).name}: {cls}")
        if dirty and (i + 1) % 25 == 0:
            _store_cache(candidate_name, cache)
    if dirty:
        _store_cache(candidate_name, cache)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--candidates",
        default=",".join(sorted(KEY_CANDIDATES)),
        help="comma-separated candidate names (default: all)",
    )
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--sample-seed", type=int, default=1991)
    parser.add_argument("--out", type=Path, default=Path("data/key_results.json"))
    args = parser.parse_args()

    names = [n.strip() for n in args.candidates.split(",") if n.strip()]
    unknown = [n for n in names if n not in KEY_CANDIDATES]
    if unknown:
        raise SystemExit(f"Unknown candidates: {unknown}; have {sorted(KEY_CANDIDATES)}")

    entries = scoreable(load_corpus(args.corpus))
    if args.limit is not None and args.limit < len(entries):
        entries = random.Random(args.sample_seed).sample(entries, args.limit)

    report: dict[str, dict] = {}
    for name in names:
        print(f"\n-- {name} --", file=sys.stderr)
        results = run_candidate(name, entries, progress=lambda m: print(m, file=sys.stderr))
        summary = summarize_key_scores([r["class"] for r in results])
        report[name] = {
            "summary": summary,
            "failures": [r for r in results if r["class"] not in ("exact", "fifth", "relative")],
        }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))

    print(f"\n== key shootout over {len(entries)} gold-tier tracks ==")
    print(f"{'candidate':22} {'mixable':>8} {'weighted':>9} {'exact':>6} classes")
    for name in names:
        s = report[name]["summary"]
        if not s["n"]:
            print(f"{name:22} (no results)")
            continue
        exact_rate = s["classes"].get("exact", 0) / s["n"]
        print(
            f"{name:22} {s['mixable_rate']:8.1%} {s['weighted_score']:9.3f} "
            f"{exact_rate:6.1%} {s['classes']}"
        )
    print(f"\nresults -> {args.out}")


if __name__ == "__main__":
    main()
