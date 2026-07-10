"""Experiment D: measure Rekordbox's decode-frame offset per container class.

Method: the user placed hot cue A precisely on a sharp transient in RB
(zoomed waveform) for one file per class. We locate the same transient in
the ffmpeg-decoded frame (manadj's frame: waveform_data.py decodes with
`ffmpeg -ac 1 -ar 44100 -f f32le`) and report

    delta_ms = RB cue InMsec - onset ms in ffmpeg frame

Positive delta => RB places the same audio LATER on its timeline than
ffmpeg does (RB skipped less priming/delay), i.e. manadj->RB export must
ADD delta to positions. Classes (mixxx-utils encoder_tools.py): mp3 by
Xing/LAME/CRC case A-D; m4a; lossless control.

Read-only. Onset detection: amplitude envelope (5 ms RMS windows, 1 ms
hop) over a +/-300 ms window around the cue; onset = steepest envelope
rise, plus a 10%-of-peak threshold crossing (backtracked) as a check.
"""

import subprocess
import sys
from pathlib import Path

import numpy as np
from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent, DjmdCue

RB_DIR = Path.home() / "Library/Pioneer/rekordbox"
SR = 44100
WINDOW_S = 0.3  # each side of the cue

TRACKS = [
    ("mp3 A (no Xing)", "Get Dirty"),
    ("mp3 B (no LAME)", "Embers"),
    ("mp3 C (bad CRC)", "All That’s Left"),
    ("mp3 D (LAME+CRC)", "FUNKONAUT"),
    ("m4a (Lavf AAC)", "Full Send"),
    ("flac (control)", "Stars"),
]


def decode_window(path: str, center_s: float) -> tuple[np.ndarray, float]:
    """Mono f32 samples for [center-WINDOW, center+WINDOW], start time."""
    start = max(0.0, center_s - WINDOW_S)
    dur = center_s - start + WINDOW_S
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ss", f"{start:.6f}",
         "-t", f"{dur:.6f}", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32), start


def envelope(x: np.ndarray, win_ms: float = 5.0, hop_ms: float = 1.0):
    win = int(SR * win_ms / 1000)
    hop = int(SR * hop_ms / 1000)
    n = (len(x) - win) // hop
    return np.array([np.sqrt(np.mean(x[i * hop:i * hop + win] ** 2))
                     for i in range(max(n, 0))]), hop


def rise_candidates(x: np.ndarray, k: int = 3) -> list[tuple[float, float]]:
    """Top-k envelope rises as (ms_in_window, rise_strength), separated
    by >=30 ms so one transient doesn't fill all slots."""
    env, hop = envelope(x)
    if len(env) < 3:
        return []
    d = np.diff(env)
    order = np.argsort(d)[::-1]
    picked: list[int] = []
    for i in order:
        if all(abs(int(i) - j) * hop / SR * 1000 >= 30 for j in picked):
            picked.append(int(i))
        if len(picked) == k:
            break
    return [(i * hop / SR * 1000, float(d[i])) for i in picked]


def main() -> None:
    db = Rekordbox6Database(db_dir=RB_DIR, path=RB_DIR / "master.db")
    contents = db.get_content().all()
    print(f"{'class':<18} top rise candidates as delta = rb_ms - onset_ms "
          f"(positive: RB later than ffmpeg)")
    for label, needle in TRACKS:
        matches = [c for c in contents if needle.lower() in (c.Title or "").lower()]
        if len(matches) != 1:
            print(f"{label:<18} !! {len(matches)} matches for {needle!r}")
            continue
        c = matches[0]
        cue = (db.session.query(DjmdCue)
               .filter(DjmdCue.ContentID == c.ID, DjmdCue.Kind == 1)
               .one_or_none())
        if cue is None:
            print(f"{label:<18} !! no hot cue A on {c.Title!r}")
            continue
        rb_ms = cue.InMsec
        samples, start_s = decode_window(c.FolderPath, rb_ms / 1000)
        cands = rise_candidates(samples)
        cand_str = "  ".join(
            f"d={rb_ms - (start_s * 1000 + ms):+7.1f} (str {s:.4f})"
            for ms, s in cands
        )
        print(f"{label:<18} rb={rb_ms:>8}  {cand_str}")


if __name__ == "__main__":
    main()
