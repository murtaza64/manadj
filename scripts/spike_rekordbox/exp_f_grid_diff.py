"""Experiment F: decode-frame offsets via RB grids on same-content transcodes.

All 'stars *' files are transcodes of the same flac. RB analyzed each in
its own decode frame; identical audio means identical analyzer phase
decisions, so

    offset(class) = median(PQTZ times of transcode) - median(... of flac)

per matching beat index. Sub-ms, no onset detection. Read-only.
"""

from pathlib import Path

import numpy as np
from pyrekordbox.db6 import Rekordbox6Database

RB_DIR = Path.home() / "Library/Pioneer/rekordbox"

VERSIONS = [
    ("flac (reference)", "Stars (2025)"),  # original import, title from tags
    ("mp3 A (no Xing)", "caseA"),
    ("mp3 B (no LAME)", "caseX"),
    ("mp3 C (bad CRC)", "caseC"),
    ("mp3 D (LAME+CRC)", "caseD"),
    ("m4a Lavf no-SMPB", "lavf"),
    ("m4a CoreAudio SMPB", "coreaudio"),
]


def grid_times(db, content) -> np.ndarray:
    files = db.read_anlz_files(content.ID)
    dat = next(f for p, f in files.items() if str(p).endswith(".DAT"))
    tags = dat.getall_tags("PQTZ")
    return np.array(list(tags[0].times), dtype=float) if tags else np.array([])


def main() -> None:
    db = Rekordbox6Database(db_dir=RB_DIR, path=RB_DIR / "master.db")
    contents = db.get_content().all()

    grids: dict[str, np.ndarray] = {}
    for label, needle in VERSIONS:
        matches = [c for c in contents
                   if needle.lower() in ((c.Title or "") + " " + (c.FileNameL or "")).lower()]
        if len(matches) != 1:
            print(f"{label:<20} !! {len(matches)} matches for {needle!r}")
            continue
        grids[label] = grid_times(db, matches[0])

    ref_label = "flac (reference)"
    ref = grids.get(ref_label)
    if ref is None or not len(ref):
        print("no reference grid; aborting")
        return

    print(f"{'class':<20} {'beats':>6} {'offset_ms':>10} {'spread_ms':>10}")
    for label, times in grids.items():
        if not len(times):
            print(f"{label:<20} {'0':>6}  (no grid)")
            continue
        n = min(len(times), len(ref))
        deltas = (times[:n] - ref[:n]) * 1000
        print(f"{label:<20} {n:>6} {np.median(deltas):>+10.2f} "
              f"{np.percentile(deltas, 95) - np.percentile(deltas, 5):>10.2f}")


if __name__ == "__main__":
    main()
