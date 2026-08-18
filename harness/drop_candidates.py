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

# The winning detector and its primitives moved to backend.drop_detection
# (structure-analysis 02 ships them); the harness keeps the losing/control
# candidates and re-exports the shared pieces so there is one implementation.
from backend.drop_detection import (  # noqa: F401  (re-exported for run_drops)
    BASS,
    MAX_HYPOTHESES,
    _bar_duration,
    _greedy_peaks,
    _window_mean,
    early_rerank,
    phrase_bass_drop,
)


def _band_mean(bands: np.ndarray, idx: list[int]) -> np.ndarray:
    return bands[:, idx].mean(axis=1)


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


CANDIDATES = {
    "bass_jump": bass_jump,
    "phrase_bass_drop": phrase_bass_drop,
    "foote_novelty_snap": foote_novelty_snap,
    "rms_rise_unsnapped": rms_rise_unsnapped,
}
