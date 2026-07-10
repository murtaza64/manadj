"""Experiment C: rewrite the beatgrid (PQTZ) in a track's ANLZ .DAT file.

WRITES. Refuses without the test-library marker.

v1 scope: MUTATE existing PQTZ entries (shift all beat times / set uniform
BPM) — pyrekordbox 0.4.4 cannot add/remove beats, so grid reshaping from
manadj tempo_changes is a later step (hand-built construct containers).
This version answers: does the RB UI honor an out-of-band PQTZ edit?

Optionally updates DjmdContent.BPM (RB stores BPM*100) to match, since
manadj treats BPM as a projection of the grid (ADR 0016).

Usage (rekordbox CLOSED):
    uv run python scripts/spike_rekordbox/exp_c_grid.py --track X --shift-ms 200
    uv run python scripts/spike_rekordbox/exp_c_grid.py --track X --bpm 172 --set-content-bpm
"""

import argparse
import sys
from pathlib import Path

from pyrekordbox.db6 import Rekordbox6Database

RB_DIR = Path.home() / "Library/Pioneer/rekordbox"
MARKER = RB_DIR / ".manadj-test-library"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", required=True)
    ap.add_argument("--shift-ms", type=int, default=0, help="rigid shift of every beat")
    ap.add_argument("--bpm", type=float, help="set every entry's tempo")
    ap.add_argument("--set-content-bpm", action="store_true",
                    help="also write DjmdContent.BPM = bpm*100")
    args = ap.parse_args()

    if not MARKER.is_file():
        sys.exit("refusing: live rekordbox library is not marked as test")

    db = Rekordbox6Database(db_dir=RB_DIR, path=RB_DIR / "master.db")
    matches = [c for c in db.get_content().all()
               if args.track.lower() in (c.Title or "").lower()]
    if len(matches) != 1:
        sys.exit(f"track {args.track!r}: {len(matches)} matches (need exactly 1)")
    content = matches[0]

    files = db.read_anlz_files(content.ID)
    dat_path, dat = next(
        ((p, f) for p, f in files.items() if str(p).endswith(".DAT")), (None, None)
    )
    if dat is None:
        sys.exit("no .DAT ANLZ file found")
    pqtz_tags = dat.getall_tags("PQTZ")
    if not pqtz_tags:
        sys.exit("no PQTZ tag in .DAT")

    for tag in pqtz_tags:
        times = list(tag.times)  # seconds (floats)
        bpms = list(tag.bpms)
        print(f"PQTZ: {len(times)} beats, bpms={sorted(set(bpms))}, "
              f"first={times[:2]}, last={times[-1]}")
        if args.shift_ms:
            times = [t + args.shift_ms / 1000.0 for t in times]
            tag.set_times(times)
        if args.bpm is not None:
            tag.set_bpms([args.bpm] * len(bpms))

    dat.save(dat_path)  # build + write in place
    print(f"wrote {dat_path}")

    if args.set_content_bpm:
        if args.bpm is None:
            sys.exit("--set-content-bpm needs --bpm")
        content.BPM = int(round(args.bpm * 100))
        db.commit()
        print(f"DjmdContent.BPM = {content.BPM}")


if __name__ == "__main__":
    main()
