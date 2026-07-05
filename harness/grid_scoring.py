"""Scoring grid fits against the Ground truth corpus (ADR 0020).

Pure functions. BPM correct within tolerance; half/double-time is its own
error class (an octave mistake, not jitter); phase error is circular,
mod one beat, and only scored when the BPM is right and the truth grid is
constant (phase truth is Engine-only).
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Literal

from harness.corpus import GridTruth
from harness.fit import GridFit

BPM_TOLERANCE = 0.05
_EPS = 1e-9
# Half/double-time confusions only (the spec's error class); a 3x confusion
# is just "wrong".
_OCTAVE_FACTORS = (2.0, 0.5)

Outcome = Literal["ok", "half_double", "wrong", "bail", "error", "no_truth"]


@dataclass(frozen=True)
class TrackScore:
    filename: str
    outcome: Outcome
    bpm_error: float | None = None  # |fit - truth|, only when outcome == "ok"
    phase_error_ms: float | None = None
    fit: GridFit | None = None


def _bpm_matches(fit_bpm: float, truth_bpm: float) -> bool:
    return abs(fit_bpm - truth_bpm) <= BPM_TOLERANCE + _EPS


def _phase_error_ms(fit_bpm: float, fit_phase: float, truth: GridTruth) -> float | None:
    if not truth.constant:
        return None
    first_beat = truth.tempo_changes[0]["start_time"]
    period = 60.0 / fit_bpm
    delta = (fit_phase - first_beat) % period
    return min(delta, period - delta) * 1000.0


def score_track(
    filename: str,
    fit: GridFit,
    truth_bpm: float | None,
    truth_grid: GridTruth | None,
) -> TrackScore:
    if fit.bailed:
        return TrackScore(filename, "bail", fit=fit)
    if truth_bpm is None:
        return TrackScore(filename, "no_truth", fit=fit)
    assert fit.bpm is not None and fit.phase is not None

    if _bpm_matches(fit.bpm, truth_bpm):
        phase_err = _phase_error_ms(fit.bpm, fit.phase, truth_grid) if truth_grid else None
        return TrackScore(
            filename,
            "ok",
            bpm_error=abs(fit.bpm - truth_bpm),
            phase_error_ms=phase_err,
            fit=fit,
        )
    if any(_bpm_matches(fit.bpm * f, truth_bpm) for f in _OCTAVE_FACTORS):
        return TrackScore(filename, "half_double", fit=fit)
    return TrackScore(filename, "wrong", fit=fit)


def summarize_scores(scores: list[TrackScore]) -> dict:
    outcomes: dict[str, int] = {}
    for s in scores:
        outcomes[s.outcome] = outcomes.get(s.outcome, 0) + 1

    scored = [s for s in scores if s.outcome != "no_truth"]
    ok = outcomes.get("ok", 0)
    phase_errs = [s.phase_error_ms for s in scores if s.phase_error_ms is not None]

    return {
        "outcomes": outcomes,
        "bpm_accuracy": ok / len(scored) if scored else None,
        "bail_rate": outcomes.get("bail", 0) / len(scored) if scored else None,
        "phase": {
            "scored": len(phase_errs),
            "median_ms": round(median(phase_errs), 3) if phase_errs else None,
            "within_10ms": sum(1 for e in phase_errs if e <= 10.0),
            "within_25ms": sum(1 for e in phase_errs if e <= 25.0),
        },
    }


def failures(scores: list[TrackScore]) -> list[TrackScore]:
    """The per-track failure list: everything that isn't a clean ok."""
    return [s for s in scores if s.outcome in ("half_double", "wrong", "bail", "error")]
