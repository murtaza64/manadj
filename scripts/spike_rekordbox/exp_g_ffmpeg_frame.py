"""Experiment G: ffmpeg's decode frame per container class, vs the flac.

Decodes each same-content transcode with manadj's exact ffmpeg invocation
(waveform_data.py: -ac 1 -ar 44100 -f f32le) and cross-correlates a span
against the decoded flac. offset > 0 means the same audio event sits
LATER in the transcode's ffmpeg timeline than in the flac's.

Final manadj->RB export offset per class =
    exp_F(RB vs flac) - exp_G(ffmpeg vs flac).

Read-only; no Rekordbox involvement.
"""

import subprocess
from pathlib import Path

import numpy as np

SR = 44100
DIR = Path.home() / "Music/spike-offset"
FLAC = next(Path.home().glob("Music/Tracks/*Stars (2025)*.flac"))
SPAN = (30.0, 40.0)  # correlate 10 s
MAX_LAG_MS = 200

FILES = [
    ("mp3 A (no Xing)", "stars caseA nox.mp3"),
    ("mp3 B (no LAME)", "stars caseX ffmpeg.mp3"),
    ("mp3 C (bad CRC)", "stars caseC badcrc.mp3"),
    ("mp3 D (LAME+CRC)", "stars caseD lame.mp3"),
    ("m4a Lavf no-SMPB", "stars m4a lavf.m4a"),
    ("m4a CoreAudio SMPB", "stars m4a coreaudio.m4a"),
]


def decode(path: Path, start: float, dur: float) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ss", f"{start:.6f}",
         "-t", f"{dur:.6f}", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32)


def xcorr_offset_ms(ref: np.ndarray, sig: np.ndarray) -> tuple[float, float]:
    """Lag (ms) maximizing correlation of sig against ref, + peak ratio."""
    max_lag = int(SR * MAX_LAG_MS / 1000)
    n = min(len(ref), len(sig))
    ref = ref[:n] - ref[:n].mean()
    sig = sig[:n] - sig[:n].mean()
    lags = np.arange(-max_lag, max_lag + 1)
    # FFT cross-correlation
    size = 1 << int(np.ceil(np.log2(2 * n)))
    R = np.fft.rfft(ref, size)
    S = np.fft.rfft(sig, size)
    cc = np.fft.irfft(S * np.conj(R), size)
    cc = np.concatenate([cc[-max_lag:], cc[:max_lag + 1]])
    best = int(lags[int(np.argmax(cc))])
    peak = cc.max() / (np.abs(cc).mean() + 1e-12)
    # sign verified empirically: mp3-without-Xing (ffmpeg cannot trim
    # priming, event lands LATER) must come out positive
    return best / SR * 1000, peak


def main() -> None:
    ref = decode(FLAC, *[SPAN[0], SPAN[1] - SPAN[0]])
    print(f"{'class':<20} {'ffmpeg_vs_flac_ms':>18} {'peak_ratio':>11}")
    for label, name in FILES:
        sig = decode(DIR / name, SPAN[0], SPAN[1] - SPAN[0])
        off, peak = xcorr_offset_ms(ref, sig)
        print(f"{label:<20} {off:>+18.2f} {peak:>11.0f}")


if __name__ == "__main__":
    main()
