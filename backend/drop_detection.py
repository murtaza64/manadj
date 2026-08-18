"""Drop detection (structure-analysis 02): possible-drop hypotheses.

Pure function of the two stored analysis artifacts — the Waveform blob's
8-band amplitudes and the Beatgrid's downbeat lattice — so hypotheses are
recomputed on request (~ms) instead of persisted; re-analysis is free and
grid edits move the drops automatically. An analysis opinion only: never
written to cue slots (the slot-4 Drop cue stays curated, PRD
structure-analysis).

Detector: the shootout winner from the harness (structure-analysis 01) —
per-downbeat bass-onset scoring with buildup/sustain/phrase priors
(phrase_bass_drop), re-ranked earliest-strong (slot 4 marks the FIRST
drop; raw scores favor the biggest). Numpy-only: safe to import anywhere
(no heavy analysis deps).
"""

from __future__ import annotations

import numpy as np

from .beatgrid_utils import calculate_beats_from_tempo_changes
from .waveform_data import decode_blob

MAX_HYPOTHESES = 5

# Band indices into the 8-band blob (edges 20/60/150/400/1000/2500/6000/12000 Hz):
BASS = [0, 1]  # 20-150 Hz: kick + sub, the drop's signature energy

EARLY_ALPHA = 0.6  # earliest-strong threshold (harness --sweep, 787 tracks)


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


def phrase_bass_drop(
    bands: np.ndarray, times: np.ndarray, downbeats: list[float]
) -> list[tuple[float, float]]:
    """Lattice + buildup-aware bass onset, ranked by raw score.

    Per-downbeat features: 1-bar bass onset, 8-bar bass sustain, preceding
    buildup (bass suppressed before the boundary), and an 8-bar phrase-phase
    bonus (the phase class that maximizes summed onset — the 8/16-bar
    lattice prior). Sum of z-scores.
    """
    bass = bands[:, BASS].mean(axis=1)
    bar = _bar_duration(downbeats)
    med_bass = float(np.median(bass))

    usable: list[float] = []
    usable_idx: list[int] = []
    onset, sustain, buildup = [], [], []
    for i, d in enumerate(downbeats):
        a1 = _window_mean(bass, times, d, d + bar)
        b1 = _window_mean(bass, times, d - bar, d)
        a8 = _window_mean(bass, times, d, d + 8 * bar)
        b8 = _window_mean(bass, times, d - 8 * bar, d)
        if any(np.isnan(v) for v in (a1, b1, a8, b8)):
            continue
        usable.append(d)
        usable_idx.append(i)
        onset.append(a1 - b1)
        sustain.append(a8 - med_bass)
        buildup.append(max(med_bass - b8, 0.0))
    if not usable:
        return []

    onset_a, sustain_a, buildup_a = map(np.asarray, (onset, sustain, buildup))
    # Dominant 8-bar phrase phase: the residue class with the largest summed
    # positive onset. Bar index is position in the downbeat lattice.
    bar_idx = np.asarray(usable_idx)
    phase_sums = [onset_a[bar_idx % 8 == p].clip(min=0).sum() for p in range(8)]
    best_phase = int(np.argmax(phase_sums))
    phrase_bonus = (bar_idx % 8 == best_phase).astype(float)

    score = _z(onset_a) + 0.5 * _z(sustain_a) + 0.5 * _z(buildup_a) + 0.5 * phrase_bonus
    return _greedy_peaks(list(zip(usable, score.tolist())), min_separation=8 * bar)


def early_rerank(hyps: list[tuple[float, float]], alpha: float) -> list[int]:
    """Earliest-strong re-ranking: index permutation of hyps.

    Min-max-normalize scores within the hypothesis list; every hypothesis
    with norm >= alpha is "strong" and strong ones re-order by time
    (earliest first), weak ones follow by score.
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


def detect_drops(
    blob: bytes, tempo_changes: list[dict], duration: float, alpha: float = EARLY_ALPHA
) -> list[dict]:
    """Possible drops from a Waveform blob + Beatgrid tempo changes.

    Returns [{"time", "strength"}] ranked earliest-strong-first; strength is
    the min-max-normalized detector score in [0, 1]. Empty when the lattice
    is too short to score (gridless tracks never reach here: no Beatgrid,
    no drops).
    """
    wf = decode_blob(blob)
    bands_amp = (wf["bands"].astype(np.float32) / 255.0) ** (1.0 / wf["gamma"])
    times = (
        np.arange(len(bands_amp), dtype=np.float64) * wf["band_hop"]
        + wf["stft_window"] / 2
    ) / wf["sample_rate"]

    _, downbeats = calculate_beats_from_tempo_changes(tempo_changes, duration)
    if len(downbeats) < 4:
        return []

    hyps = phrase_bass_drop(bands_amp, times, downbeats)
    if not hyps:
        return []
    scores = np.array([s for _, s in hyps], dtype=float)
    lo, hi = float(scores.min()), float(scores.max())
    span = hi - lo if hi - lo > 1e-12 else 1.0
    order = early_rerank(hyps, alpha)
    return [
        {"time": round(hyps[i][0], 3), "strength": round((hyps[i][1] - lo) / span, 4)}
        for i in order
    ]
