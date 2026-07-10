"""Experiment I: author a PQTZ beat grid FROM SCRATCH (new count, variable
tempo) and write it into a track's ANLZ .DAT.

This is what a real manadj export needs: generate the full beat array
from manadj-style tempo_changes segments. pyrekordbox can only mutate
existing entries; the missing piece is rebuilding the construct
containers and fixing len_tag by hand (AbstractAnlzTag.update_len is a
no-op):

    tag.struct.content.entries = [...]
    tag.struct.content.entry_count = n
    tag.struct.len_tag = LEN_HEADER(24) + 8 * n

Writes only the .DAT PQTZ; .EXT's PQT2 is left stale on purpose — part
of the probe is finding out whether RB reads PQT2 anywhere visible.

WRITES. Refuses without the test-library marker.

Usage:
    uv run python scripts/spike_rekordbox/exp_i_author_grid.py --track Getaway
"""

import argparse
import sys
from pathlib import Path

from construct import Container
from pyrekordbox.db6 import Rekordbox6Database

RB_DIR = Path.home() / "Library/Pioneer/rekordbox"
MARKER = RB_DIR / ".manadj-test-library"

# manadj-style segments: (start_time_s, bpm, beats_per_bar)
# variable grid, visually unmistakable: halves tempo at 60 s
TEMPO_CHANGES = [
    (0.147, 172.0, 4),
    (60.0, 86.0, 4),
]


def generate_beats(tempo_changes, end_s: float) -> list[tuple[int, float, float]]:
    """(beat_in_bar, bpm, time_s) from segment list, downbeat at each
    segment start (manadj semantics: bar_position resets)."""
    out = []
    for i, (start, bpm, bpb) in enumerate(tempo_changes):
        seg_end = tempo_changes[i + 1][0] if i + 1 < len(tempo_changes) else end_s
        period = 60.0 / bpm
        t, beat = start, 1
        while t < seg_end - 1e-9:
            out.append((beat, bpm, t))
            beat = beat % bpb + 1
            t += period
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", required=True)
    args = ap.parse_args()
    if not MARKER.is_file():
        sys.exit("refusing: live rekordbox library is not marked as test")

    db = Rekordbox6Database(db_dir=RB_DIR, path=RB_DIR / "master.db")
    matches = [c for c in db.get_content().all()
               if args.track.lower() in (c.Title or "").lower()]
    if len(matches) != 1:
        sys.exit(f"{len(matches)} matches")
    content = matches[0]

    files = db.read_anlz_files(content.ID)
    dat_path, dat = next((p, f) for p, f in files.items() if str(p).endswith(".DAT"))
    tag = dat.getall_tags("PQTZ")[0]

    old_times = tag.get_times()
    end_s = float(old_times[-1]) if len(old_times) else 240.0
    beats = generate_beats(TEMPO_CHANGES, end_s)

    tag.struct.content.entries = [
        Container(beat=b, tempo=int(round(bpm * 100)), time=int(round(t * 1000)))
        for b, bpm, t in beats
    ]
    tag.struct.content.entry_count = len(beats)
    tag.struct.len_tag = tag.LEN_HEADER + 8 * len(beats)

    data = dat.build()  # raises BuildFileLengthError if lengths are wrong
    Path(dat_path).write_bytes(data)
    print(f"wrote {len(beats)} beats (was {len(old_times)}) to {dat_path}")

    # round-trip check with a fresh parse
    from pyrekordbox.anlz import AnlzFile
    reread = AnlzFile.parse_file(dat_path)
    t2 = reread.getall_tags("PQTZ")[0]
    print(f"round-trip: count={t2.count} bpms_unique={sorted(set(t2.get_bpms()))} "
          f"first={t2.get_times()[:2]} last={t2.get_times()[-1]}")


if __name__ == "__main__":
    main()
