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
3. Seed a grid from the longest base-tempo region (never the track start,
   where trackers wander), then conform-and-refit: keep every tick in the
   track that lands on that grid, least-squares the keepers for the
   full-track lever arm, and gate again on the conforming fraction.
4. Integer BPM only when within the snap threshold (conditional snapping,
   ADR 0020); phase is the fitted anchor mod period; residual is the RMS
   deviation of conforming ticks from the grid.

Pure: stdlib only.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FitParams:
    min_ticks: int = 16
    # An interval extends a region while within this fraction of the
    # region's running mean interval. Tight by default — regions exist to
    # seed a clean grid; a coarse-quantizing tracker (beat_this: 50fps)
    # overrides this per candidate.
    region_tolerance: float = 0.05
    # Regions whose mean periods differ relatively less than this are the
    # same tempo.
    group_tolerance: float = 0.005
    # Bail when the dominant tempo covers less than this fraction of beats.
    min_coverage: float = 0.6
    # A tick conforms to the fitted grid when within this fraction of the
    # beat period of a beat.
    conform_tolerance: float = 0.15
    # Bail when the RMS deviation of conforming ticks from the fitted grid
    # exceeds this.
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


def _least_squares(indexed: list[tuple[int, float]]) -> tuple[float, float]:
    """Fit t ~= a + b*n. Returns (a, b)."""
    n = len(indexed)
    mean_i = sum(i for i, _ in indexed) / n
    mean_t = sum(t for _, t in indexed) / n
    var = sum((i - mean_i) ** 2 for i, _ in indexed)
    cov = sum((i - mean_i) * (t - mean_t) for i, t in indexed)
    b = cov / var if var > 0 else 0.0
    return mean_t - b * mean_i, b


def _conforming(
    ticks: list[float], anchor: float, period: float, tolerance: float
) -> list[tuple[int, float]]:
    """Ticks that land on the grid (anchor, period), as (beat index, time);
    one tick per beat, closest wins. Trackers wander in intros/outros — a
    tick that doesn't conform is excluded, not averaged in."""
    best: dict[int, float] = {}
    for t in ticks:
        i = round((t - anchor) / period)
        dev = abs(t - (anchor + i * period))
        if dev <= tolerance * period and (
            i not in best or dev < abs(best[i] - (anchor + i * period))
        ):
            best[i] = t
    return sorted(best.items())


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
            "not constant-tempo (region coverage)",
            n_ticks=len(ticks),
            coverage=round(min(coverage, 1.0), 4),
            longest_region=longest,
        )

    # Refine from the longest base region outward — never anchored on the
    # track start, where trackers wander. Least-squares over the region's
    # consecutive ticks nails the period; then grow: keep every tick in the
    # track that conforms to that grid and refit on the keepers for the
    # full-track lever arm. (A start-anchored walk was measurably biased by
    # intro wander: 0.1% period error smears phase across a long region.)
    best = max(group.base, key=lambda r: r.n_intervals)
    region_ticks = ticks[best.start_tick : best.start_tick + best.n_intervals + 1]
    anchor, period = _least_squares(list(enumerate(region_ticks)))
    # Two conform-refit passes, the second tighter: the first finds the
    # grid, the second sheds barely-conforming drift (intro ticks a few ms
    # off pull the anchor otherwise). If the tighter pass keeps too little,
    # stand on the first pass rather than refit on scraps.
    kept = _conforming(ticks, anchor, period, params.conform_tolerance)
    if len(kept) < params.min_ticks:
        return _bail(
            "too few conforming ticks",
            n_ticks=len(ticks),
            n_conforming=len(kept),
        )
    anchor, period = _least_squares(kept)
    tighter = _conforming(ticks, anchor, period, params.conform_tolerance / 2)
    if len(tighter) >= params.min_ticks:
        anchor2, period2 = _least_squares(tighter)
        if period2 > 0:
            kept, anchor, period = tighter, anchor2, period2

    # Second quantization gate, on the *final* grid: the fraction of the
    # track's beats that have a conforming tick. Catches tempo steps small
    # enough (e.g. 174 -> 180) to slip through the running-mean regions.
    total_beats = round((ticks[-1] - ticks[0]) / period)
    conform_coverage = len(kept) / total_beats if total_beats > 0 else 0.0
    if conform_coverage < params.min_coverage:
        return _bail(
            "not constant-tempo (conform coverage)",
            n_ticks=len(ticks),
            coverage=round(min(conform_coverage, 1.0), 4),
            longest_region=longest,
        )

    raw_bpm = 60.0 / period
    bpm = raw_bpm
    snapped = False
    if params.snap_bpm > 0 and abs(raw_bpm - round(raw_bpm)) <= params.snap_bpm:
        bpm = float(round(raw_bpm))
        period = 60.0 / bpm
        snapped = True
        # Re-anchor with the snapped period fixed.
        anchor = sum(t - period * i for i, t in kept) / len(kept)

    residuals = [t - (anchor + period * i) for i, t in kept]
    residual_ms = (sum(r * r for r in residuals) / len(residuals)) ** 0.5 * 1000.0
    if residual_ms > params.max_residual_ms:
        return _bail(
            "residual too high",
            n_ticks=len(ticks),
            coverage=round(min(conform_coverage, 1.0), 4),
            residual_ms=round(residual_ms, 3),
            raw_bpm=round(raw_bpm, 4),
        )

    return GridFit(
        bpm=bpm,
        phase=anchor % period,
        residual_ms=residual_ms,
        bailed=False,
        evidence={
            "n_ticks": len(ticks),
            "coverage": round(min(coverage, 1.0), 4),
            "longest_region": longest,
            "n_conforming": len(kept),
            "raw_bpm": round(raw_bpm, 4),
            "snapped": snapped,
        },
    )
