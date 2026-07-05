"""Constant-tempo fit: beat-tracker ticks -> (BPM, phase) or bail (ADR 0020).

Ticks are evidence, never the grid. The fit assumes a Quantized track and
refuses to describe anything else: poor fit means bail, not a wobbly
variable grid.

Ported homework (Mixxx BeatUtils::retrieveConstRegions, adapted): real beat
trackers wander in phase even on machine-quantized music, so a single global
line fit fails on good tracks. Instead:

1. Walk intervals into *const regions* (consecutive intervals within a
   relative tolerance of the region's running mean).
2. Group regions by tempo; the dominant group's beat coverage is the
   quantization test — low coverage means variable tempo (or tracker
   confusion): bail.
3. Tempo = beats-weighted period over the dominant group; integer BPM only
   when within the snap threshold (conditional snapping, ADR 0020).
4. Phase = circular mean of all ticks mod the beat period — robust to
   dropped ticks and local wander; the circular spread is the residual.

Pure: stdlib only.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass(frozen=True)
class FitParams:
    min_ticks: int = 16
    # An interval extends a region while within this fraction of the
    # region's running mean interval.
    region_tolerance: float = 0.05
    # Regions whose mean periods differ relatively less than this are the
    # same tempo.
    group_tolerance: float = 0.005
    # Bail when the dominant tempo covers less than this fraction of beats.
    min_coverage: float = 0.6
    # Bail when the circular spread of tick phases exceeds this.
    max_residual_ms: float = 35.0
    # Snap to integer BPM when within this of it (0 disables snapping).
    snap_bpm: float = 0.05


@dataclass(frozen=True)
class GridFit:
    """Result of fitting a constant grid. Bailed => bpm/phase are None."""

    bpm: float | None
    phase: float | None  # time of a beat, normalized into [0, period)
    residual_ms: float | None
    bailed: bool
    evidence: dict = field(default_factory=dict)


@dataclass(frozen=True)
class _Region:
    start_tick: int  # index into ticks of the region's first tick
    n_intervals: int
    mean_period: float


def _bail(reason: str, **extra) -> GridFit:
    return GridFit(
        bpm=None,
        phase=None,
        residual_ms=None,
        bailed=True,
        evidence={"reason": reason, **extra},
    )


def _const_regions(ticks: list[float], tolerance: float) -> list[_Region]:
    regions: list[_Region] = []
    start = 0
    total = 0.0
    count = 0
    for i in range(1, len(ticks)):
        interval = ticks[i] - ticks[i - 1]
        mean = total / count if count else interval
        if interval <= 0 or abs(interval - mean) > tolerance * mean:
            if count:
                regions.append(_Region(start, count, total / count))
            start = i - 1 if interval > 0 else i
            total = interval if interval > 0 else 0.0
            count = 1 if interval > 0 else 0
        else:
            total += interval
            count += 1
    if count:
        regions.append(_Region(start, count, total / count))
    return regions


# Beat trackers oscillate between metrical levels on EDM (a half-time
# section of a Quantized track still supports the same grid, every other
# beat). A region at factor f of the base period contributes n*f base beats.
_HARMONIC_FACTORS = (0.5, 1.0, 2.0)


@dataclass(frozen=True)
class _Group:
    """Regions supporting one base tempo, harmonics included."""

    base: list[_Region]  # regions at the base period
    harmonic: list[_Region]  # regions at 0.5x / 2x the base period
    base_beats: float  # total support, in base-level beats


def _dominant_group(regions: list[_Region], tolerance: float) -> _Group | None:
    """The base tempo with the most support in base-level beats.

    Maximizing base-level beats naturally prefers the faster metrical level
    when support is equal — for DnB that's 174, not 87."""
    best: _Group | None = None
    for anchor in regions:
        base: list[_Region] = []
        harmonic: list[_Region] = []
        beats = 0.0
        for r in regions:
            for f in _HARMONIC_FACTORS:
                target = anchor.mean_period * f
                if abs(r.mean_period - target) <= tolerance * target:
                    (base if f == 1.0 else harmonic).append(r)
                    beats += r.n_intervals * f
                    break
        if best is None or beats > best.base_beats:
            best = _Group(base=base, harmonic=harmonic, base_beats=beats)
    return best


def _circular_phase(ticks: list[float], period: float) -> tuple[float, float, float]:
    """Circular mean of tick times mod period.

    Returns (phase in [0, period), resultant length R in [0, 1],
    circular std in seconds)."""
    n = len(ticks)
    sin_sum = sum(math.sin(2 * math.pi * (t % period) / period) for t in ticks)
    cos_sum = sum(math.cos(2 * math.pi * (t % period) / period) for t in ticks)
    r = math.hypot(sin_sum / n, cos_sum / n)
    angle = math.atan2(sin_sum / n, cos_sum / n) % (2 * math.pi)
    phase = angle / (2 * math.pi) * period
    # circular standard deviation, mapped back to seconds
    std = math.sqrt(max(0.0, -2.0 * math.log(r))) if r > 0 else math.inf
    return phase, r, std / (2 * math.pi) * period


def _walk_refine(ticks: list[float], period0: float, tolerance: float) -> float:
    """Assign absolute beat indices with a cumulative walk, keep ticks whose
    step lands near a whole number of beats, and least-squares the keepers.
    Falls back to the seed period when too few ticks survive."""
    kept: list[tuple[int, float]] = [(0, ticks[0])]
    period = period0
    for t in ticks[1:]:
        prev_i, prev_t = kept[-1]
        steps = (t - prev_t) / period
        dn = round(steps)
        if dn < 1 or abs(steps - dn) > tolerance * dn:
            continue
        i = prev_i + dn
        kept.append((i, t))
        if i > 0:
            period = (t - kept[0][1]) / i
    if len(kept) < 3:
        return period0
    n = len(kept)
    mean_i = sum(i for i, _ in kept) / n
    mean_t = sum(t for _, t in kept) / n
    var = sum((i - mean_i) ** 2 for i, _ in kept)
    cov = sum((i - mean_i) * (t - mean_t) for i, t in kept)
    return cov / var if var > 0 else period0


def fit_constant_grid(ticks: list[float], params: FitParams = FitParams()) -> GridFit:
    if len(ticks) < params.min_ticks:
        return _bail("too few ticks", n_ticks=len(ticks))

    regions = _const_regions(ticks, params.region_tolerance)
    if not regions:
        return _bail("no const regions", n_ticks=len(ticks))

    group = _dominant_group(regions, params.group_tolerance)
    if group is None or not group.base:
        return _bail("no dominant tempo", n_ticks=len(ticks))
    base_beats = sum(r.n_intervals for r in group.base)
    period = sum(r.n_intervals * r.mean_period for r in group.base) / base_beats
    total_beats = round((ticks[-1] - ticks[0]) / period)
    coverage = group.base_beats / total_beats if total_beats > 0 else 0.0
    longest = max(r.n_intervals for r in group.base)
    if coverage < params.min_coverage:
        return _bail(
            "not constant-tempo",
            n_ticks=len(ticks),
            coverage=round(min(coverage, 1.0), 4),
            longest_region=longest,
        )

    # Refine the period globally: walk ticks assigning absolute beat indices
    # with the dominant period (skipping ticks that don't land near a beat),
    # then least-squares the kept ticks. The full-track lever arm gives the
    # accuracy no single region has; slow phase wander averages out.
    period = _walk_refine(ticks, period, params.region_tolerance)

    raw_bpm = 60.0 / period
    bpm = raw_bpm
    snapped = False
    if params.snap_bpm > 0 and abs(raw_bpm - round(raw_bpm)) <= params.snap_bpm:
        bpm = float(round(raw_bpm))
        period = 60.0 / bpm
        snapped = True

    # Phase and residual come from the longest base-level region — the most
    # stable contiguous stretch (typically the drop). Trackers wander in
    # intros/outros even on Quantized tracks; that wander must not poison
    # the phase estimate or bail an honest grid.
    best = max(group.base, key=lambda r: r.n_intervals)
    region_ticks = ticks[best.start_tick : best.start_tick + best.n_intervals + 1]
    phase, r, std = _circular_phase(region_ticks, period)
    residual_ms = std * 1000.0
    if residual_ms > params.max_residual_ms:
        return _bail(
            "residual too high",
            n_ticks=len(ticks),
            coverage=round(min(coverage, 1.0), 4),
            residual_ms=round(residual_ms, 3),
            raw_bpm=round(raw_bpm, 4),
        )

    return GridFit(
        bpm=bpm,
        phase=phase,
        residual_ms=residual_ms,
        bailed=False,
        evidence={
            "n_ticks": len(ticks),
            "coverage": round(min(coverage, 1.0), 4),
            "longest_region": longest,
            "raw_bpm": round(raw_bpm, 4),
            "snapped": snapped,
            "phase_concentration": round(r, 4),
        },
    )
