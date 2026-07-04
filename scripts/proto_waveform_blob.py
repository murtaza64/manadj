#!/usr/bin/env -S uv run --script
"""PROTOTYPE — wipe me.

Generates new-format waveform blobs (.wfb) for a handful of tracks, per the
waveform-overhaul PRD (.scratch/waveform-overhaul/PRD.md) and ADR 0014.
Writes to frontend/public/proto-waveforms/ for the prototype page.

This is throwaway: it will be absorbed into the real generation module.

Usage:
  uv run scripts/proto_waveform_blob.py --auto
  uv run scripts/proto_waveform_blob.py --ids 404,241,672

Format v1 (little-endian):
  magic       4s   b"MWF1"
  version     u16  1
  reserved    u16  0
  sample_rate u32
  duration    f64  seconds
  peak_hop    u32  samples per peak bin
  band_hop    u32  samples per band frame
  stft_window u32  n_fft (band frame f is centered at f*band_hop + stft_window/2)
  n_bands     u8 + 3 pad bytes
  gamma       f32  quantization gamma (stored = amp**gamma * 255)
  band_edges  f32 * (n_bands + 1)
  peak_count  u32
  band_count  u32  (frames)
  peaks       u8 * peak_count
  bands       u8 * band_count * n_bands   (frame-major)
"""

import argparse
import json
import random
import shutil
import sqlite3
import struct
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
DB_PATH = REPO / "data" / "library.db"
OUT_DIR = REPO / "frontend" / "public" / "proto-waveforms"

SAMPLE_RATE = 44100
PEAK_HOP = 128
BAND_HOP = 512
N_FFT = 2048  # header value; also the alignment anchor: frame f is centered at f*BAND_HOP + N_FFT/2
GAMMA = 0.5
BAND_EDGES = [20.0, 60.0, 150.0, 400.0, 1000.0, 2500.0, 6000.0, 12000.0, 20000.0]
N_BANDS = len(BAND_EDGES) - 1
BLOCK_SECONDS = 10.0
ALIGN = N_FFT // 2  # shared frame-center offset in samples

# Multi-resolution (format v2): per-band-group STFT windows, all on the same
# hop-512 grid with shared frame centers. Each band gets the sharpest window
# its frequency range allows (time-frequency uncertainty): bass needs ~46ms
# to measure at all; hats can be honest at ~6ms.
WINDOW_GROUPS: list[tuple[int, list[int]]] = [
    (2048, [0, 1]),      # 20-150 Hz
    (1024, [2, 3, 4]),   # 150 Hz - 2.5 kHz
    (256, [5, 6, 7]),    # 2.5 kHz +
]


def pooling_matrix(sr: int, n_fft: int, band_indices: list[int]) -> np.ndarray:
    """[n_rfft_bins x len(band_indices)] 0/1 matrix mapping FFT bins to bands."""
    n_bins = n_fft // 2 + 1
    freqs = np.arange(n_bins) * sr / n_fft
    m = np.zeros((n_bins, len(band_indices)), dtype=np.float32)
    for col, b in enumerate(band_indices):
        m[(freqs >= BAND_EDGES[b]) & (freqs < BAND_EDGES[b + 1]), col] = 1.0
    return m


def quantize(amp: np.ndarray) -> np.ndarray:
    return (np.clip(amp, 0.0, 1.0) ** GAMMA * 255.0 + 0.5).astype(np.uint8)


class _WindowGroup:
    """Streaming STFT for one window size, frames centered at f*BAND_HOP + ALIGN."""

    def __init__(self, n_fft: int, band_indices: list[int]):
        self.n_fft = n_fft
        self.bands = band_indices
        self.hann = np.hanning(n_fft).astype(np.float32)
        self.rms_w = float(np.sqrt(np.mean(self.hann**2)))
        self.pool = pooling_matrix(SAMPLE_RATE, n_fft, band_indices)
        self.next_f = 0  # next frame index to compute
        self.chunks: list[np.ndarray] = []

    def window_start(self, f: int) -> int:
        return f * BAND_HOP + ALIGN - self.n_fft // 2

    def consume(self, buf: np.ndarray, buf_start: int) -> None:
        start = self.window_start(self.next_f) - buf_start
        avail = len(buf) - start - self.n_fft
        if start < 0 or avail < 0:
            return
        n = avail // BAND_HOP + 1
        frames = np.lib.stride_tricks.sliding_window_view(buf, self.n_fft)[start::BAND_HOP][:n]
        spec = np.fft.rfft(frames * self.hann, axis=1)
        power = (spec.real**2 + spec.imag**2).astype(np.float32) @ self.pool
        # amp of a full-scale sine in-band ≈ 1.0 (Parseval + Hann RMS).
        self.chunks.append(2.0 * np.sqrt(power) / (self.n_fft * self.rms_w))
        self.next_f += n


def analyze(filepath: str) -> tuple[np.ndarray, np.ndarray, float]:
    """Stream-decode via ffmpeg; return (peaks_u8, bands_u8[frames, N_BANDS], duration)."""
    groups = [_WindowGroup(w, idx) for w, idx in WINDOW_GROUPS]
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", filepath,
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    assert proc.stdout is not None

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
        keep_from = min(g.window_start(g.next_f) for g in groups)
        keep_from = max(keep_from, buf_start)
        buf = buf[keep_from - buf_start:]
        buf_start = keep_from

    err = proc.stderr.read().decode() if proc.stderr else ""
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg failed: {err.strip()}")

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
        bands[:, g.bands] = arr[:n_frames]
    duration = total_samples / SAMPLE_RATE
    return quantize(peaks), quantize(bands), duration


def write_blob(path: Path, peaks: np.ndarray, bands: np.ndarray, duration: float) -> None:
    # v2 = multi-resolution band windows (layout identical to v1; stft_window
    # remains the alignment anchor: frame centers at f*band_hop + stft_window/2).
    header = struct.pack(
        "<4sHHIdIIIB3xf",
        b"MWF1", 2, 0, SAMPLE_RATE, duration, PEAK_HOP, BAND_HOP, N_FFT, N_BANDS, GAMMA,
    )
    header += struct.pack(f"<{N_BANDS + 1}f", *BAND_EDGES)
    header += struct.pack("<II", len(peaks), bands.shape[0])
    path.write_bytes(header + peaks.tobytes() + bands.tobytes())


def pick_tracks(con: sqlite3.Connection, ids: list[int] | None, auto: bool) -> list[sqlite3.Row]:
    rows = con.execute(
        "select id, filename, title, artist, duration_secs, codec from tracks "
        "where duration_secs is not null"
    ).fetchall()
    by_id = {r["id"]: r for r in rows}
    if ids:
        return [by_id[i] for i in ids]
    if auto:
        picked: dict[int, sqlite3.Row] = {}
        longest = max(rows, key=lambda r: r["duration_secs"])
        picked[longest["id"]] = longest
        m4a = [r for r in rows if r["filename"].lower().endswith(".m4a")]
        if m4a:
            picked.setdefault(m4a[0]["id"], m4a[0])
        for r in random.Random(42).sample(rows, 4):
            picked.setdefault(r["id"], r)
        return list(picked.values())[:6]
    raise SystemExit("pass --ids or --auto")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="comma-separated track ids")
    ap.add_argument("--auto", action="store_true", help="pick a diverse handful")
    ap.add_argument("--audio", action="store_true",
                    help="copy source audio next to blobs (gitignored) for playback")
    ap.add_argument("--db", default=str(DB_PATH), help="library DB path")
    args = ap.parse_args()
    ids = [int(s) for s in args.ids.split(",")] if args.ids else None

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    tracks = pick_tracks(con, ids, args.auto)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "README.md").write_text("PROTOTYPE — wipe me. Generated by scripts/proto_waveform_blob.py\n")

    manifest = []
    for t in tracks:
        if not Path(t["filename"]).exists():
            print(f"skip {t['id']}: file missing", file=sys.stderr)
            continue
        t0 = time.perf_counter()
        peaks, bands, duration = analyze(t["filename"])
        elapsed = time.perf_counter() - t0
        out = OUT_DIR / f"track_{t['id']}.wfb"
        write_blob(out, peaks, bands, duration)
        print(
            f"track {t['id']:>4}  {duration:7.1f}s audio  {elapsed:6.2f}s gen "
            f"({duration / elapsed:6.1f}x realtime)  {out.stat().st_size / 1024:7.1f} KB  "
            f"[{t['codec']}] {t['title'] or Path(t['filename']).name}"
        )
        entry = {
            "id": t["id"],
            "title": t["title"] or Path(t["filename"]).stem,
            "artist": t["artist"] or "",
            "duration": duration,
            "codec": t["codec"],
            "file": out.name,
            "genSeconds": round(elapsed, 3),
        }
        if args.audio:
            audio_name = f"audio_{t['id']}{Path(t['filename']).suffix.lower()}"
            shutil.copy2(t["filename"], OUT_DIR / audio_name)
            entry["audioFile"] = audio_name
        manifest.append(entry)

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nwrote {len(manifest)} blobs + manifest to {OUT_DIR}")


if __name__ == "__main__":
    main()
