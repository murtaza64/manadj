"""Score a grid candidate against the Ground truth corpus (issue 02).

Runs a beat-tracker candidate over corpus tracks, fits a constant grid to
its ticks, and scores BPM (0.05 tolerance, half/double as its own class)
and phase (mod beat, vs Engine's grid). Ticks are cached per candidate so
fit parameters can be re-tuned without re-running audio analysis.

Usage:
    uv run -m harness.run_grid --candidate essentia_rhythm2013
        [--corpus data/corpus.json] [--limit N] [--sample-seed N]
        [--out data/grid_results_<candidate>.json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from pathlib import Path

from harness.corpus import CorpusEntry, load_corpus
from harness.fit import FitParams, fit_constant_grid
from harness.grid_candidates import GRID_CANDIDATES
from harness.grid_scoring import TrackScore, failures, score_track, summarize_scores

DEFAULT_CORPUS = Path("data/corpus.json")
TICK_CACHE_DIR = Path("data/ticks")


def cached_ticks(candidate_name: str, audio_path: str) -> list[float] | None:
    p = _cache_path(candidate_name, audio_path)
    if p.exists():
        return json.loads(p.read_text())["ticks"]
    return None


def store_ticks(candidate_name: str, audio_path: str, ticks: list[float]) -> None:
    p = _cache_path(candidate_name, audio_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"audio_path": audio_path, "ticks": ticks}))


def _cache_path(candidate_name: str, audio_path: str) -> Path:
    digest = hashlib.sha256(audio_path.encode()).hexdigest()[:24]
    return TICK_CACHE_DIR / candidate_name / f"{digest}.json"


def scoreable(entries: list[CorpusEntry]) -> list[CorpusEntry]:
    """The headline set: gold-tier BPM truth with the audio present
    (disputed and single-source tiers are excluded from headline scores)."""
    return [
        e
        for e in entries
        if e.bpm.tier == "gold" and e.bpm.truth is not None and Path(e.filename).exists()
    ]


def run(
    candidate_name: str,
    entries: list[CorpusEntry],
    params: FitParams = FitParams(),
    progress=lambda msg: None,
) -> list[TrackScore]:
    candidate = GRID_CANDIDATES[candidate_name]
    scores: list[TrackScore] = []
    for i, e in enumerate(entries):
        ticks = cached_ticks(candidate_name, e.filename)
        if ticks is None:
            try:
                ticks = candidate.ticks(e.filename)
            except Exception as exc:  # one bad decode must not kill the run
                progress(f"[{i + 1}/{len(entries)}] ERROR {Path(e.filename).name}: {exc}")
                scores.append(TrackScore(e.filename, "error"))
                continue
            store_ticks(candidate_name, e.filename, ticks)
        fit = fit_constant_grid(ticks, params)
        scores.append(score_track(e.filename, fit, e.bpm.truth, e.grid))
        progress(f"[{i + 1}/{len(entries)}] {Path(e.filename).name}: {scores[-1].outcome}")
    return scores


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True, choices=sorted(GRID_CANDIDATES))
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--sample-seed", type=int, default=1991)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    entries = scoreable(load_corpus(args.corpus))
    if args.limit is not None and args.limit < len(entries):
        entries = random.Random(args.sample_seed).sample(entries, args.limit)

    scores = run(args.candidate, entries, progress=lambda m: print(m, file=sys.stderr))

    summary = summarize_scores(scores)
    out = args.out or Path(f"data/grid_results_{args.candidate}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "candidate": args.candidate,
                "summary": summary,
                "scores": [
                    {
                        "filename": s.filename,
                        "outcome": s.outcome,
                        "bpm_error": s.bpm_error,
                        "phase_error_ms": s.phase_error_ms,
                        "fit_bpm": s.fit.bpm if s.fit else None,
                        "evidence": s.fit.evidence if s.fit else None,
                    }
                    for s in scores
                ],
            },
            indent=2,
        )
    )

    print(f"\n== {args.candidate} over {len(scores)} gold-tier tracks ==")
    print(f"outcomes:      {summary['outcomes']}")
    br = summary["bail_rate"]
    print(f"bail rate:     {br:.1%}" if br is not None else "bail rate:     n/a")
    acc = summary["bpm_accuracy"]
    print(f"bpm accuracy:  {acc:.1%}" if acc is not None else "bpm accuracy:  n/a")
    ph = summary["phase"]
    print(
        f"phase:         {ph['scored']} scored, median {ph['median_ms']}ms, "
        f"<=10ms: {ph['within_10ms']}, <=25ms: {ph['within_25ms']}"
    )
    fails = failures(scores)
    if fails:
        print(f"\nfailures ({len(fails)}):")
        for s in fails:
            detail = f"fit={s.fit.bpm}" if s.fit and s.fit.bpm else (
                s.fit.evidence.get("reason", "") if s.fit else ""
            )
            print(f"  {s.outcome:12} {detail:18} {s.filename}")
    print(f"\nresults -> {out}")


if __name__ == "__main__":
    main()
