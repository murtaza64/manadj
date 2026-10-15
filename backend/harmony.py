"""Harmony analysis (chord-match #387): a Track's drop chord loop.

Per-bar 12-bin chroma synced to the Beatgrid, the drop region, and the drop
folded into an 8-bar chord loop (8 x 12). Chord match (#388) compares loops.
Algorithm per the chord-match spike (.editspace/handoffs/chord-match-spike.md):

- chroma: HPCP (frame 8192, hop 4096, squared-cosine weighting, 1-semitone
  window, peaks only) — a numpy port of essentia's HPCP (the app never
  imports essentia). `other` stem 80-5000 Hz + 0.5 x `bass` stem 30-400 Hz,
  each normalised per bar, C-based.
- drop: bars whose drum energy > 0.6 x p90; runs merged across gaps <= 2
  bars; runs >= 16 bars; the longer of the first two; start snapped to an
  8-bar boundary.
- loop: the drop folded into 8 bars (mean over repeats). `movement` = 1 -
  mean cos(bar, loop mean): 0 = static drone, >= MOVEMENT_MIN = has a
  progression.

Source: current stems (other/bass/drums), else the full mix — the mix
supplies both chroma bands, and its 30-150 Hz energy (kick + sub) stands in
for the drum stem when finding the drop.

Numpy only; audio decodes through our ffmpeg (same lineage as stems).
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .beatgrid_utils import calculate_beats_from_tempo_changes

HARMONY_VERSION = 1
"""Analyzer version: bump to invalidate stored rows (the sweep re-runs them)."""

SR = 44100
FRAME = 8192
HOP = 4096
LOOP_BARS = 8
MIN_DROP_BARS = 16
DROP_GAP_BARS = 2
DROP_LEVEL = 0.6  # x p90 of per-bar drum energy
MOVEMENT_MIN = 0.12  # spike: ~30% of the library has a progression above this

OTHER_BAND = (80.0, 5000.0)
BASS_BAND = (30.0, 400.0)
KICK_BAND = (30.0, 150.0)  # full-mix drop proxy
BASS_WEIGHT = 0.5

MAX_PEAKS = 60
PEAK_THRESHOLD = 1e-5
_CHUNK = 256  # frames per FFT batch (bounds memory)


def _norm(x: np.ndarray) -> np.ndarray:
    return x / (np.linalg.norm(x, axis=-1, keepdims=True) + 1e-9)


# ---------------------------------------------------------------- audio


def decode_mono(path: Path | str) -> np.ndarray:
    """Mono float32 at 44.1 kHz via our ffmpeg."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "-"],
        capture_output=True, check=False,
    )
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-1000:]
        raise RuntimeError(f"ffmpeg decode failed for {path}: {tail}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def _frames(audio: np.ndarray) -> np.ndarray:
    """(n, FRAME) view, frames starting at 0, last frame zero-padded."""
    n = max(1, int(np.ceil(len(audio) / HOP)))
    padded = np.zeros((n - 1) * HOP + FRAME, dtype=np.float32)
    padded[: len(audio)] = audio
    return np.lib.stride_tricks.sliding_window_view(padded, FRAME)[::HOP][:n]


def frame_times(n_frames: int) -> np.ndarray:
    """Frame centre times (s)."""
    return (np.arange(n_frames) * HOP + FRAME / 2) / SR


def _window() -> np.ndarray:
    """Blackman-Harris 92 dB (essentia blackmanharris62 coefficients),
    normalised like essentia's Windowing (area 1, x 2)."""
    a = (0.35875, 0.48829, 0.14128, 0.01168)
    n = np.arange(FRAME)
    w = (a[0] - a[1] * np.cos(2 * np.pi * n / (FRAME - 1))
         + a[2] * np.cos(4 * np.pi * n / (FRAME - 1))
         - a[3] * np.cos(6 * np.pi * n / (FRAME - 1)))
    return (2 * w / w.sum()).astype(np.float32)


def hpcp_from_spectrum(mag: np.ndarray, fmin: float, fmax: float) -> np.ndarray:
    """HPCP (12 bins, C-based) per frame from magnitude spectra (frames, bins).

    Spectral peaks in [fmin, fmax] (local maxima, top MAX_PEAKS by magnitude,
    parabolic interpolation), each adding cos^2(pi d) * mag^2 to its nearest
    pitch class, d = distance in semitones (essentia HPCP: windowSize 1,
    squaredCosine, no harmonics, no normalisation).
    """
    n_bins = mag.shape[1]
    bin_hz = SR / FRAME
    lo = max(1, int(np.ceil(fmin / bin_hz)))
    hi = min(n_bins - 2, int(np.floor(fmax / bin_hz)))
    left, mid, right = mag[:, lo - 1 : hi], mag[:, lo : hi + 1], mag[:, lo + 1 : hi + 2]
    is_peak = (mid > left) & (mid >= right) & (mid > PEAK_THRESHOLD)
    score = np.where(is_peak, mid, 0.0)
    k = min(MAX_PEAKS, score.shape[1])
    top = np.argpartition(-score, k - 1, axis=1)[:, :k]
    rows = np.arange(mag.shape[0])[:, None]
    b = mid[rows, top]
    valid = score[rows, top] > 0
    a, c = left[rows, top], right[rows, top]
    denom = a - 2 * b + c
    p = np.where(np.abs(denom) > 1e-12, 0.5 * (a - c) / np.where(denom == 0, 1, denom), 0.0)
    freq = (top + lo + p) * bin_hz
    peak_mag = b - 0.25 * (a - c) * p
    valid &= (freq >= fmin) & (freq <= fmax)
    pitch = 12 * np.log2(np.maximum(freq, 1e-6) / 440.0)  # A-based semitones
    nearest = np.round(pitch)
    w = np.cos(np.pi * (pitch - nearest)) ** 2 * peak_mag**2 * valid
    out = np.zeros((mag.shape[0], 12))
    pc = ((nearest.astype(int) % 12) + 9) % 12  # A-based -> C-based
    np.add.at(out, (np.broadcast_to(rows, pc.shape), pc), w)
    return out


@dataclass
class FrameFeatures:
    other: np.ndarray  # (n, 12) chroma
    bass: np.ndarray  # (n, 12) chroma
    energy: np.ndarray  # (n,) drop-finding energy


def _spectra(audio: np.ndarray):
    win = _window()
    frames = _frames(audio)
    for i in range(0, len(frames), _CHUNK):
        chunk = frames[i : i + _CHUNK]
        yield chunk, np.abs(np.fft.rfft(chunk * win, axis=1))


def chroma_frames(audio: np.ndarray, band: tuple[float, float]) -> np.ndarray:
    return np.concatenate(
        [hpcp_from_spectrum(mag, *band) for _, mag in _spectra(audio)]
    ) if len(audio) else np.zeros((0, 12))


def rms_frames(audio: np.ndarray) -> np.ndarray:
    return np.sqrt(np.mean(_frames(audio).astype(np.float64) ** 2, axis=1))


def stem_features(other: np.ndarray, bass: np.ndarray, drums: np.ndarray) -> FrameFeatures:
    o, b, d = chroma_frames(other, OTHER_BAND), chroma_frames(bass, BASS_BAND), rms_frames(drums)
    n = min(len(o), len(b), len(d))
    return FrameFeatures(o[:n], b[:n], d[:n])


def mix_features(mix: np.ndarray) -> FrameFeatures:
    other, bass, energy = [], [], []
    bin_hz = SR / FRAME
    klo, khi = int(KICK_BAND[0] / bin_hz), int(KICK_BAND[1] / bin_hz) + 1
    for _, mag in _spectra(mix):
        other.append(hpcp_from_spectrum(mag, *OTHER_BAND))
        bass.append(hpcp_from_spectrum(mag, *BASS_BAND))
        energy.append(np.sqrt(np.sum(mag[:, klo:khi].astype(np.float64) ** 2, axis=1)))
    return FrameFeatures(np.concatenate(other), np.concatenate(bass), np.concatenate(energy))


# ---------------------------------------------------------------- bars


def downbeats(tempo_changes: list[dict], duration: float) -> np.ndarray:
    return np.asarray(calculate_beats_from_tempo_changes(tempo_changes, duration)[1])


def bar_features(
    feats: FrameFeatures, bar_starts: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Per-bar chroma (bars, 12; unit norm, zeros for empty bars) and per-bar
    mean energy. Bar i spans [bar_starts[i], bar_starts[i+1]); the last bar
    reuses the previous bar length."""
    t = frame_times(len(feats.energy))
    n = len(bar_starts)
    if n == 0:
        return np.zeros((0, 12)), np.zeros(0)
    last = bar_starts[-1] + (bar_starts[-1] - bar_starts[-2] if n > 1 else 2.0)
    edges = np.append(bar_starts, last)
    idx = np.searchsorted(edges, t, side="right") - 1  # bar index per frame
    chroma = np.zeros((n, 12))
    energy = np.zeros(n)
    for i in range(n):
        m = idx == i
        if not m.any():
            continue
        chroma[i] = _norm(feats.other[m].mean(0)) + BASS_WEIGHT * _norm(feats.bass[m].mean(0))
        energy[i] = feats.energy[m].mean()
    return _norm(chroma) * (np.linalg.norm(chroma, axis=1, keepdims=True) > 0), energy


def drop_runs(active: np.ndarray, max_gap: int = DROP_GAP_BARS, min_len: int = MIN_DROP_BARS
              ) -> list[tuple[int, int]]:
    """[start, end) runs of active bars, bridging gaps <= max_gap bars, kept
    when >= min_len bars."""
    runs: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(list(active) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i))
            start = None
    merged: list[tuple[int, int]] = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= max_gap:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    return [r for r in merged if r[1] - r[0] >= min_len]


def find_drop(bar_energy: np.ndarray) -> tuple[int, int] | None:
    """The drop region [start, end) in bars, or None.

    The longer of the first two qualifying runs; start snapped forward to an
    8-bar boundary when at least MIN_DROP_BARS remain."""
    if len(bar_energy) == 0 or not np.any(bar_energy > 0):
        return None
    active = bar_energy > DROP_LEVEL * np.percentile(bar_energy, 90)
    runs = drop_runs(active)
    if not runs:
        return None
    s, e = max(runs[:2], key=lambda r: r[1] - r[0])
    snapped = s + (-s) % LOOP_BARS
    if e - snapped >= MIN_DROP_BARS:
        s = snapped
    return s, e


@dataclass
class Loop:
    loop: np.ndarray  # (8, 12) unit-norm bars
    reps: int
    consistency: float  # mean cos of each repeat to the loop
    movement: float  # 1 - mean cos(bar, loop mean)


def fold_loop(bars: np.ndarray) -> Loop | None:
    """Fold a run of per-bar chroma into an 8-bar loop."""
    reps = len(bars) // LOOP_BARS
    if reps == 0:
        return None
    blocks = bars[: reps * LOOP_BARS].reshape(reps, LOOP_BARS, 12)
    loop = _norm(blocks.mean(0))
    consistency = float(np.mean([np.sum(_norm(b) * loop, -1).mean() for b in blocks]))
    return Loop(loop, reps, consistency, movement(loop))


def movement(loop: np.ndarray) -> float:
    return float(1 - np.sum(loop * _norm(loop.mean(0)), -1).mean())


# ---------------------------------------------------------------- whole track


@dataclass
class HarmonyResult:
    source: str  # "stems" | "mix"
    bar_starts: np.ndarray  # downbeat times (s)
    bar_chroma: np.ndarray  # (bars, 12)
    drop: tuple[int, int] | None  # [start, end) bars
    loop: Loop | None


def analyze_features(
    feats: FrameFeatures, tempo_changes: list[dict], source: str
) -> HarmonyResult:
    duration = float(frame_times(len(feats.energy))[-1]) if len(feats.energy) else 0.0
    starts = downbeats(tempo_changes, duration)
    chroma, energy = bar_features(feats, starts)
    drop = find_drop(energy)
    loop = fold_loop(chroma[drop[0] : drop[1]]) if drop else None
    return HarmonyResult(source, starts, chroma, drop, loop)


STEM_FILES = ("other", "bass", "drums")


def analyze_track_audio(
    tempo_changes: list[dict], mix_path: Path | str, stems_dir: Path | None
) -> HarmonyResult:
    """Analyze from stems when `stems_dir` is given (current stems), else
    from the full mix."""
    if stems_dir is not None:
        other, bass, drums = (decode_mono(stems_dir / f"{n}.m4a") for n in STEM_FILES)
        return analyze_features(stem_features(other, bass, drums), tempo_changes, "stems")
    return analyze_features(mix_features(decode_mono(mix_path)), tempo_changes, "mix")


# ---------------------------------------------------------------- display

_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _templates() -> list[tuple[str, np.ndarray]]:
    out = []
    for r in range(12):
        for q, third in (("", 4), ("m", 3)):
            v = np.zeros(12)
            v[[r, (r + third) % 12, (r + 7) % 12]] = [1.0, 0.8, 0.8]
            out.append((_NAMES[r] + q, v / np.linalg.norm(v)))
    return out


_TEMPLATES = _templates()


def chord_label(bar: np.ndarray) -> str:
    """Nearest major/minor triad (spot checks and debugging only)."""
    return max(_TEMPLATES, key=lambda t: float(bar @ t[1]))[0]


def progression(loop: np.ndarray) -> str:
    return " ".join(chord_label(b) for b in loop)


# ---------------------------------------------------------------- chord match wire


def chord_residual(loop: np.ndarray) -> np.ndarray:
    """The loop's progression without its drone: subtract the loop's mean
    chroma, normalise per bar. Chord match (#388) = mean per-bar dot of two
    residuals, max over the 8 bar rotations."""
    return _norm(loop - loop.mean(0))


def encode_residual(loop: np.ndarray) -> bytes:
    """int8 quantised residual (8 x 12 = 96 bytes) for the bulk wire."""
    return np.round(chord_residual(loop) * 127).astype(np.int8).tobytes()


def chord_match(a: np.ndarray, b: np.ndarray) -> float:
    """Reference implementation of the frontend's chordMatch (loops in)."""
    ra, rb = chord_residual(a), chord_residual(b)
    return max(float(np.sum(ra * np.roll(rb, -r, 0), -1).mean()) for r in range(LOOP_BARS))
