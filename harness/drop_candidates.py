"""Drop detection candidates (structure-analysis 01, shootout harness).

Each candidate consumes the decoded v2 waveform blob (8-band RMS amplitudes,
backend.waveform_data) plus the Track's Beatgrid lattice, and returns ranked
drop-time hypotheses. No audio decode: the blob is the feature source, which
keeps a full-corpus run under a couple of minutes.

Candidate interface:
    detect(bands_amp, frame_times, downbeats) -> list[(time_seconds, score)]
ranked best-first, at most MAX_HYPOTHESES entries.

bands_amp: float32 [frames, 8], linear amplitude (gamma undone).
frame_times: float32 [frames], seconds (frame centers).
downbeats: list[float], bar-start times from the Beatgrid.
"""

from __future__ import annotations

import numpy as np

MAX_HYPOTHESES = 5

# Band indices into the 8-band blob (edges 20/60/150/400/1000/2500/6000/12000/20000 Hz)
BASS = [0, 1]  # 20-150 Hz: kick + sub, the drop's signature energy


def _band_mean(bands: np.ndarray, idx: list[int]) -> np.ndarray:
    return bands[:, idx].mean(axis=1)


def _window_mean(curve: np.ndarray, times: np.ndarray, t0: float, t1: float) -> float:
    """Mean of curve over [t0, t1); nan if the window is empty/out of range."""
    i0, i1 = np.searchsorted(times, [t0, t1])
    if i1 <= i0:
        return float("nan")
    return float(curve[i0:i1].mean())


def _greedy_peaks(
    scored: list[tuple[float, float]], min_separation: float
) -> list[tuple[float, float]]:
    """Best-first selection with a minimum time separation."""
    out: list[tuple[float, float]] = []
    for t, s in sorted(scored, key=lambda x: -x[1]):
        if all(abs(t - u) >= min_separation for u, _ in out):
            out.append((t, s))
        if len(out) >= MAX_HYPOTHESES:
            break
    return out


def _bar_duration(downbeats: list[float]) -> float:
    if len(downbeats) < 2:
        return 2.0
    return float(np.median(np.diff(downbeats)))


def _z(x: np.ndarray) -> np.ndarray:
    x = np.nan_to_num(x, nan=0.0)
    sd = x.std()
    return (x - x.mean()) / sd if sd > 1e-9 else np.zeros_like(x)


def bass_jump(
    bands: np.ndarray, times: np.ndarray, downbeats: list[float]
) -> list[tuple[float, float]]:
    """Snapped 4-bar bass-energy jump.

    Score each downbeat by bass amplitude in the following 4 bars minus the
    preceding 4 bars (Zehren 2024: energy novelty is the top-ranked feature;
    low-band onset is the standard EDM drop signature).
    """
    bass = _band_mean(bands, BASS)
    bar = _bar_duration(downbeats)
    scored = []
    for d in downbeats:
        after = _window_mean(bass, times, d, d + 4 * bar)
        before = _window_mean(bass, times, d - 4 * bar, d)
        if np.isnan(after) or np.isnan(before):
            continue
        scored.append((d, after - before))
    return _greedy_peaks(scored, min_separation=8 * bar)


def phrase_bass_drop(
    bands: np.ndarray, times: np.ndarray, downbeats: list[float]
) -> list[tuple[float, float]]:
    """Lattice + buildup-aware bass onset.

    Per-downbeat features: 1-bar bass onset, 8-bar bass sustain, preceding
    buildup (bass suppressed before the boundary), and an 8-bar phrase-phase
    bonus (the phase class that maximizes summed onset — manadj's 8/16-bar
    lattice prior). Sum of z-scores.
    """
    bass = _band_mean(bands, BASS)
    bar = _bar_duration(downbeats)
    med_bass = float(np.median(bass))

    usable: list[float] = []
    onset, sustain, buildup = [], [], []
    for d in downbeats:
        a1 = _window_mean(bass, times, d, d + bar)
        b1 = _window_mean(bass, times, d - bar, d)
        a8 = _window_mean(bass, times, d, d + 8 * bar)
        b8 = _window_mean(bass, times, d - 8 * bar, d)
        if any(np.isnan(v) for v in (a1, b1, a8, b8)):
            continue
        usable.append(d)
        onset.append(a1 - b1)
        sustain.append(a8 - med_bass)
        buildup.append(max(med_bass - b8, 0.0))
    if not usable:
        return []

    onset_a, sustain_a, buildup_a = map(np.asarray, (onset, sustain, buildup))
    # Dominant 8-bar phrase phase: the residue class with the largest summed
    # positive onset. Bar index is position in the downbeat lattice.
    bar_idx = np.array([downbeats.index(d) for d in usable])
    phase_sums = [
        onset_a[bar_idx % 8 == p].clip(min=0).sum() for p in range(8)
    ]
    best_phase = int(np.argmax(phase_sums))
    phrase_bonus = (bar_idx % 8 == best_phase).astype(float)

    score = _z(onset_a) + 0.5 * _z(sustain_a) + 0.5 * _z(buildup_a) + 0.5 * phrase_bonus
    scored = list(zip(usable, score.tolist()))
    return _greedy_peaks(scored, min_separation=8 * bar)


def foote_novelty_snap(
    bands: np.ndarray, times: np.ndarray, downbeats: list[float]
) -> list[tuple[float, float]]:
    """Foote checkerboard novelty on the 8-band self-similarity matrix,
    peaks snapped to the nearest downbeat (Foote 2000; librosa recipe)."""
    # Mean-pool to ~2 frames/sec to keep the SSM small.
    step = max(1, int(round(0.5 / max(times[1] - times[0], 1e-6))))
    n = (len(bands) // step) * step
    if n == 0:
        return []
    pooled = bands[:n].reshape(-1, step, bands.shape[1]).mean(axis=1)
    ptimes = times[:n:step]

    feats = np.log1p(pooled * 100.0)
    norms = np.linalg.norm(feats, axis=1, keepdims=True)
    feats = feats / np.maximum(norms, 1e-9)
    ssm = feats @ feats.T

    # Checkerboard kernel, ~16 s per quadrant side.
    half = max(4, int(round(16.0 / max(ptimes[1] - ptimes[0], 1e-6))))
    k = np.ones((2 * half, 2 * half))
    k[:half, half:] = -1
    k[half:, :half] = -1
    k *= np.outer(*(2 * [np.hanning(2 * half)]))

    m = len(pooled)
    novelty = np.zeros(m)
    for i in range(half, m - half):
        patch = ssm[i - half : i + half, i - half : i + half]
        novelty[i] = (patch * k).sum()

    if not downbeats:
        return []
    bar = _bar_duration(downbeats)
    db = np.asarray(downbeats)
    scored: list[tuple[float, float]] = []
    order = np.argsort(novelty)[::-1]
    for i in order:
        if novelty[i] <= 0:
            break
        snapped = float(db[np.abs(db - ptimes[i]).argmin()])
        if all(abs(snapped - u) >= 8 * bar for u, _ in scored):
            scored.append((snapped, float(novelty[i])))
        if len(scored) >= MAX_HYPOTHESES:
            break
    return scored


def rms_rise_unsnapped(
    bands: np.ndarray, times: np.ndarray, downbeats: list[float]
) -> list[tuple[float, float]]:
    """Control: broadband energy rise, no grid snapping.

    Shows what the lattice buys: same energy-novelty idea as bass_jump but
    over all bands and free-running in time.
    """
    broad = bands.mean(axis=1)
    dt = max(float(times[1] - times[0]), 1e-6)
    w = max(1, int(round(8.0 / dt)))  # 8 s windows
    kernel = np.concatenate([-np.ones(w), np.ones(w)]) / w
    rise = np.convolve(broad, kernel[::-1], mode="same")
    rise[: w] = 0
    rise[-w:] = 0
    scored = list(zip(times.tolist(), rise.tolist()))
    # Thin before greedy selection: local maxima only.
    maxima = [
        (t, s)
        for i, (t, s) in enumerate(scored[1:-1], start=1)
        if s > 0 and rise[i] >= rise[i - 1] and rise[i] >= rise[i + 1]
    ]
    return _greedy_peaks(maxima, min_separation=20.0)


def early_rerank(hyps: list[tuple[float, float]], alpha: float) -> list[int]:
    """Earliest-strong re-ranking: index permutation of hyps.

    Slot 4 marks the *first* drop by convention, but raw scores favor the
    *biggest* boundary. Min-max-normalize scores within the hypothesis list;
    every hypothesis with norm >= alpha is "strong" and strong ones are
    re-ordered by time (earliest first), weak ones follow by score.
    """
    if len(hyps) <= 1:
        return list(range(len(hyps)))
    scores = np.array([s for _, s in hyps], dtype=float)
    lo, hi = float(scores.min()), float(scores.max())
    norm = (scores - lo) / (hi - lo) if hi - lo > 1e-12 else np.ones(len(hyps))
    strong = [i for i in range(len(hyps)) if norm[i] >= alpha]
    weak = [i for i in range(len(hyps)) if norm[i] < alpha]
    strong.sort(key=lambda i: hyps[i][0])
    weak.sort(key=lambda i: -hyps[i][1])
    return strong + weak


CANDIDATES = {
    "bass_jump": bass_jump,
    "phrase_bass_drop": phrase_bass_drop,
    "foote_novelty_snap": foote_novelty_snap,
    "rms_rise_unsnapped": rms_rise_unsnapped,
}
