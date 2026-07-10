"""Experiment E: decode-frame offset via RB's own beatgrid (no manual cues).

RB's PQTZ beat times are RB-frame positions computed by RB's analyzer.
Decode a span of each track in the ffmpeg frame (manadj's frame), build a
rectified onset-strength envelope, and score candidate offsets delta in
[-150, +150] ms: score(delta) = sum of envelope-rise at (beat_time +
delta). The argmax is the RB->ffmpeg frame offset plus a class-
independent "where the analyzer puts the beat relative to the kick
onset" bias — the flac control measures that bias, and per-class offset
= argmax(class) - argmax(flac).

Read-only.
"""

import subprocess
from pathlib import Path

import numpy as np
from pyrekordbox.db6 import Rekordbox6Database

RB_DIR = Path.home() / "Library/Pioneer/rekordbox"
SR = 44100
SPAN = (20.0, 80.0)  # analysis window in track seconds
DELTAS_MS = np.arange(-150, 151, 1)

TRACKS = [
    ("mp3 A (no Xing)", "Get Dirty"),
    ("mp3 B (no LAME)", "Embers"),
    ("mp3 C (bad CRC)", "All That’s Left"),
    ("mp3 D (LAME+CRC)", "FUNKONAUT"),
    ("m4a (Lavf AAC)", "Full Send"),
    ("flac (control)", "Stars"),
]


def decode(path: str, start: float, dur: float) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ss", f"{start:.6f}",
         "-t", f"{dur:.6f}", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32)


def onset_strength(x: np.ndarray, hop_ms: float = 1.0) -> np.ndarray:
    """Rectified rise of a 5 ms RMS envelope, 1 ms resolution."""
    win = int(SR * 0.005)
    hop = int(SR * hop_ms / 1000)
    n = (len(x) - win) // hop
    idx = np.arange(n)[:, None] * hop + np.arange(win)[None, :]
    env = np.sqrt(np.mean(np.asarray(x)[idx] ** 2, axis=1))
    d = np.diff(env, prepend=env[0])
    return np.maximum(d, 0.0)


def main() -> None:
    db = Rekordbox6Database(db_dir=RB_DIR, path=RB_DIR / "master.db")
    contents = db.get_content().all()
    results: dict[str, float] = {}
    for label, needle in TRACKS:
        matches = [c for c in contents if needle.lower() in (c.Title or "").lower()]
        if len(matches) != 1:
            print(f"{label:<18} !! {len(matches)} matches")
            continue
        c = matches[0]
        anlz_files = db.read_anlz_files(c.ID)
        dat = next(f for p, f in anlz_files.items() if str(p).endswith(".DAT"))
        pqtz = dat.getall_tags("PQTZ")[0]
        beat_times = np.array(list(pqtz.times), dtype=float)  # seconds, RB frame
        sel = beat_times[(beat_times >= SPAN[0]) & (beat_times <= SPAN[1])]
        if len(sel) < 32:
            print(f"{label:<18} !! only {len(sel)} beats in span")
            continue
        pad = 0.2
        x = decode(c.FolderPath, SPAN[0] - pad, SPAN[1] - SPAN[0] + 2 * pad)
        strength = onset_strength(x)
        base_ms = (SPAN[0] - pad) * 1000
        scores = []
        for delta in DELTAS_MS:
            pos = ((sel * 1000 + delta - base_ms)).astype(int)  # ms == index
            pos = pos[(pos >= 0) & (pos < len(strength))]
            scores.append(strength[pos].sum())
        scores = np.array(scores)
        best = int(DELTAS_MS[int(np.argmax(scores))])
        # peak sharpness: best vs median as a confidence hint
        conf = scores.max() / (np.median(scores) + 1e-9)
        results[label] = best
        print(f"{label:<18} beats={len(sel):>4}  best_delta={best:>+4} ms  "
              f"peak/median={conf:.1f}")

    if "flac (control)" in results:
        bias = results["flac (control)"]
        print(f"\nper-class offset (bias-corrected by flac {bias:+d} ms):")
        for label, best in results.items():
            print(f"  {label:<18} {best - bias:+d} ms")


if __name__ == "__main__":
    main()
