"""Waveform data (ADR 0014): style-agnostic v2 blob generation.

One binary blob per Track: broadband max-abs peaks on a fine grid plus 8
log-spaced band RMS amplitudes on a coarser grid, uint8 with sqrt-gamma.
Band energies use multi-resolution STFT windows (v2): each band group gets
the sharpest window its frequency range allows, all on a shared hop grid
with shared frame centers, so the layout is window-agnostic.

Blob layout (little-endian):
  magic       4s   b"MWF1"
  version     u16  2
  reserved    u16  0
  sample_rate u32
  duration    f64  seconds
  peak_hop    u32  samples per peak bin
  band_hop    u32  samples per band frame
  stft_window u32  alignment anchor: frame f is centered at f*band_hop + stft_window/2
  n_bands     u8 + 3 pad bytes
  gamma       f32  quantization gamma (stored = amp**gamma * 255)
  band_edges  f32 * (n_bands + 1)
  peak_count  u32
  band_count  u32  (frames)
  peaks       u8 * peak_count
  bands       u8 * band_count * n_bands   (frame-major)

Rendering must never bake aesthetics into this data (ADR 0014/0015).
"""

from __future__ import annotations

import shutil
import struct
import subprocess
import threading
from dataclasses import dataclass, field
from typing import IO, Callable

import numpy as np

SAMPLE_RATE = 44100
PEAK_HOP = 128
BAND_HOP = 512
STFT_WINDOW = 2048  # header value and alignment anchor (frame centers at f*BAND_HOP + STFT_WINDOW/2)
GAMMA = 0.5
BAND_EDGES = [20.0, 60.0, 150.0, 400.0, 1000.0, 2500.0, 6000.0, 12000.0, 20000.0]
N_BANDS = len(BAND_EDGES) - 1
BLOCK_SECONDS = 10.0
FORMAT_VERSION = 2
_ALIGN = STFT_WINDOW // 2

# Multi-resolution window groups (format v2, ADR 0014): (window_size, band indices).
WINDOW_GROUPS: list[tuple[int, list[int]]] = [
    (2048, [0, 1]),      # 20-150 Hz
    (1024, [2, 3, 4]),   # 150 Hz - 2.5 kHz
    (256, [5, 6, 7]),    # 2.5 kHz +
]

_HEADER_FMT = "<4sHHIdIIIB3xf"


def ensure_ffmpeg() -> None:
    """Raise with a clear message if ffmpeg is not on PATH (startup check)."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError(
            "ffmpeg not found on PATH — waveform generation requires it. "
            "Install with: brew install ffmpeg"
        )


def _drain(stream: IO[bytes], sink: list[bytes], cap: int = 65536) -> None:
    """Consume a pipe fully, keeping at most `cap` bytes for error reporting."""
    kept = 0
    while True:
        chunk = stream.read(8192)
        if not chunk:
            return
        if kept < cap:
            sink.append(chunk[: cap - kept])
            kept += len(sink[-1])


def _pooling_matrix(sr: int, n_fft: int, band_indices: list[int]) -> np.ndarray:
    """[n_rfft_bins x len(band_indices)] 0/1 matrix mapping FFT bins to bands."""
    n_bins = n_fft // 2 + 1
    freqs = np.arange(n_bins) * sr / n_fft
    m = np.zeros((n_bins, len(band_indices)), dtype=np.float32)
    for col, b in enumerate(band_indices):
        m[(freqs >= BAND_EDGES[b]) & (freqs < BAND_EDGES[b + 1]), col] = 1.0
    return m


def _quantize(amp: np.ndarray) -> np.ndarray:
    return (np.clip(amp, 0.0, 1.0) ** GAMMA * 255.0 + 0.5).astype(np.uint8)


@dataclass
class _WindowGroup:
    """Streaming STFT for one window size, frames centered at f*BAND_HOP + _ALIGN."""

    n_fft: int
    bands: list[int]
    hann: np.ndarray = field(init=False)
    rms_w: float = field(init=False)
    pool: np.ndarray = field(init=False)
    next_f: int = 0
    chunks: list[np.ndarray] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.hann = np.hanning(self.n_fft).astype(np.float32)
        self.rms_w = float(np.sqrt(np.mean(self.hann**2)))
        self.pool = _pooling_matrix(SAMPLE_RATE, self.n_fft, self.bands)

    def window_start(self, f: int) -> int:
        return f * BAND_HOP + _ALIGN - self.n_fft // 2

    def consume(self, buf: np.ndarray, buf_start: int) -> None:
        start = self.window_start(self.next_f) - buf_start
        avail = len(buf) - start - self.n_fft
        if start < 0 or avail < 0:
            return
        n = avail // BAND_HOP + 1
        frames = np.lib.stride_tricks.sliding_window_view(buf, self.n_fft)[start::BAND_HOP][:n]
        spec = np.fft.rfft(frames * self.hann, axis=1)
        power = (spec.real**2 + spec.imag**2).astype(np.float32) @ self.pool
        # Amplitude of a full-scale in-band sine ≈ 1.0 (Parseval + Hann RMS).
        self.chunks.append(2.0 * np.sqrt(power) / (self.n_fft * self.rms_w))
        self.next_f += n


def analyze(
    filepath: str,
    on_progress: Callable[[float], None] | None = None,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Stream-decode via ffmpeg; return (peaks_u8, bands_u8[frames, N_BANDS], duration).

    Constant memory for any file length. `on_progress` receives seconds of
    audio processed so far (callers with a known duration derive a percentage).
    """
    groups = [_WindowGroup(w, idx) for w, idx in WINDOW_GROUPS]
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", filepath,
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    assert proc.stdout is not None
    assert proc.stderr is not None

    # Drain stderr concurrently. A file with per-frame decode warnings can
    # emit hundreds of KB of stderr while still decoding fine; if nobody
    # reads it, ffmpeg blocks once the 64KB pipe fills and the read loop
    # below deadlocks (wedged the whole task queue on a real library m4a).
    stderr_chunks: list[bytes] = []
    stderr_thread = threading.Thread(
        target=_drain, args=(proc.stderr, stderr_chunks), daemon=True
    )
    stderr_thread.start()

    peak_carry = np.empty(0, dtype=np.float32)
    peak_chunks: list[np.ndarray] = []
    buf = np.empty(0, dtype=np.float32)
    buf_start = 0  # absolute sample index of buf[0]
    total_samples = 0
    block_bytes = int(BLOCK_SECONDS * SAMPLE_RATE) * 4

    while True:
        raw = proc.stdout.read(block_bytes)
        if not raw:
            break
        x = np.frombuffer(raw, dtype=np.float32)
        total_samples += len(x)

        # Peaks: vectorized max-abs per PEAK_HOP.
        pbuf = np.concatenate([peak_carry, x])
        n = len(pbuf) // PEAK_HOP * PEAK_HOP
        if n:
            peak_chunks.append(np.abs(pbuf[:n]).reshape(-1, PEAK_HOP).max(axis=1))
        peak_carry = pbuf[n:]

        # Bands: each window group consumes as many aligned frames as fit.
        buf = np.concatenate([buf, x])
        for g in groups:
            g.consume(buf, buf_start)
        keep_from = max(buf_start, min(g.window_start(g.next_f) for g in groups))
        buf = buf[keep_from - buf_start:]
        buf_start = keep_from

        if on_progress is not None:
            on_progress(total_samples / SAMPLE_RATE)

    stderr_thread.join(timeout=10)
    err = b"".join(stderr_chunks).decode(errors="replace")
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for {filepath}: {err.strip()}")
    if total_samples == 0:
        raise RuntimeError(f"ffmpeg produced no audio for {filepath}: {err.strip()}")

    if peak_carry.size:
        peak_chunks.append(np.array([np.abs(peak_carry).max()], dtype=np.float32))
    peaks = np.concatenate(peak_chunks) if peak_chunks else np.zeros(1, np.float32)

    # Assemble [frames x N_BANDS]; groups may differ by a few trailing frames.
    per_group = [
        np.concatenate(g.chunks) if g.chunks else np.zeros((0, len(g.bands)), np.float32)
        for g in groups
    ]
    n_frames = max(1, min(a.shape[0] for a in per_group))
    bands = np.zeros((n_frames, N_BANDS), dtype=np.float32)
    for g, arr in zip(groups, per_group):
        bands[:n_frames, g.bands] = arr[:n_frames]
    duration = total_samples / SAMPLE_RATE
    return _quantize(peaks), _quantize(bands), duration


def build_blob(peaks: np.ndarray, bands: np.ndarray, duration: float) -> bytes:
    """Pack analysis output into the versioned binary blob."""
    header = struct.pack(
        _HEADER_FMT,
        b"MWF1", FORMAT_VERSION, 0, SAMPLE_RATE, duration,
        PEAK_HOP, BAND_HOP, STFT_WINDOW, N_BANDS, GAMMA,
    )
    header += struct.pack(f"<{N_BANDS + 1}f", *BAND_EDGES)
    header += struct.pack("<II", len(peaks), bands.shape[0])
    return header + peaks.tobytes() + bands.tobytes()


def generate_blob(
    filepath: str,
    on_progress: Callable[[float], None] | None = None,
) -> bytes:
    """Analyze an audio file and return its Waveform data blob."""
    peaks, bands, duration = analyze(filepath, on_progress=on_progress)
    return build_blob(peaks, bands, duration)


def decode_blob(blob: bytes) -> dict:
    """Decode a blob into header fields + numpy arrays (tests and tooling)."""
    magic, version, _, sr, duration, peak_hop, band_hop, stft_window, n_bands, gamma = (
        struct.unpack_from(_HEADER_FMT, blob, 0)
    )
    if magic != b"MWF1":
        raise ValueError(f"bad magic: {magic!r}")
    off = struct.calcsize(_HEADER_FMT)
    edges = struct.unpack_from(f"<{n_bands + 1}f", blob, off)
    off += 4 * (n_bands + 1)
    peak_count, band_count = struct.unpack_from("<II", blob, off)
    off += 8
    peaks = np.frombuffer(blob, np.uint8, peak_count, off)
    bands = np.frombuffer(blob, np.uint8, band_count * n_bands, off + peak_count)
    return {
        "version": version,
        "sample_rate": sr,
        "duration": duration,
        "peak_hop": peak_hop,
        "band_hop": band_hop,
        "stft_window": stft_window,
        "n_bands": n_bands,
        "gamma": gamma,
        "band_edges": list(edges),
        "peaks": peaks,
        "bands": bands.reshape(band_count, n_bands),
    }
