"""Experiment B: write hot cues / memory cues / key into the Rekordbox DB.

WRITES. Refuses to run unless the live library carries the test marker
(.manadj-test-library), i.e. rblib.sh use-test is in effect.

Row shapes mimic rows observed in a real RB7 library (rbstate.py dump,
2026-07-10):
  memory cue: Kind=0, OutMsec=-1, Color=-1, ColorTableIndex/ActiveLoop/
              Comment/BeatLoopSize/CueMicrosec NULL
  hot cue:    Kind=slot(1-8), Color=255, ColorTableIndex=<palette idx>,
              ActiveLoop=0, Comment='', BeatLoopSize=0, CueMicrosec=0
  both:       InFrame = InMsec * 150/1000, ContentUUID = content.UUID,
              fresh UUID per row

Usage (from repo root, rekordbox CLOSED):
    uv run python scripts/spike_rekordbox/exp_b_cues.py add-pair --track X --ms 30000 --slot 3
    uv run python scripts/spike_rekordbox/exp_b_cues.py move --cue-id N --ms 45000
    uv run python scripts/spike_rekordbox/exp_b_cues.py delete --cue-id N [--soft]
    uv run python scripts/spike_rekordbox/exp_b_cues.py set-key --track X --key 10B
"""

import argparse
import sys
import uuid
from pathlib import Path

from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent, DjmdCue, DjmdKey

RB_DIR = Path.home() / "Library/Pioneer/rekordbox"
MARKER = RB_DIR / ".manadj-test-library"


def open_db_guarded() -> Rekordbox6Database:
    if not MARKER.is_file():
        sys.exit("refusing: live rekordbox library is not marked as test "
                 "(run rblib.sh use-test / mark-test first)")
    return Rekordbox6Database(db_dir=RB_DIR, path=RB_DIR / "master.db")


def find_content(db: Rekordbox6Database, needle: str) -> DjmdContent:
    matches = [c for c in db.get_content().all()
               if needle.lower() in (c.Title or "").lower()]
    if len(matches) != 1:
        sys.exit(f"track {needle!r}: {len(matches)} matches (need exactly 1)")
    return matches[0]


def frames(ms: int) -> int:
    return int(ms * 150 / 1000)


def base_cue_fields(db: Rekordbox6Database, content: DjmdContent, ms: int) -> dict:
    return dict(
        ID=str(db.generate_unused_id(DjmdCue)),
        ContentID=content.ID,
        InMsec=ms,
        InFrame=frames(ms),
        InMpegFrame=0,
        InMpegAbs=0,
        OutMsec=-1,
        OutFrame=0,
        OutMpegFrame=0,
        OutMpegAbs=0,
        ContentUUID=content.UUID,
        UUID=str(uuid.uuid4()),
        rb_data_status=0,
        rb_local_data_status=0,
        rb_local_deleted=0,
        rb_local_synced=0,
    )


def cmd_add_pair(db: Rekordbox6Database, args) -> None:
    # RB7-authored rows (observed test-baseline 2026-07-10): hot cue ==
    # memory cue shape (Color=-1, extras NULL), only Kind differs.
    content = find_content(db, args.track)
    extras: dict = {}
    if args.comment:
        extras["Comment"] = args.comment
    if args.color_index is not None:
        extras["ColorTableIndex"] = args.color_index
        extras["Color"] = 255
    hot = DjmdCue(
        **base_cue_fields(db, content, args.ms),
        Kind=args.slot,
        **({"Color": -1} | extras),
    )
    db.session.add(hot)
    mem = DjmdCue(
        **base_cue_fields(db, content, args.ms),
        Kind=0,
        Color=-1,
    )
    db.session.add(mem)
    db.commit()
    print(f"added hot cue slot {args.slot} (ID {hot.ID}) + memory cue "
          f"(ID {mem.ID}) at {args.ms} ms on {content.Title!r}")


def cmd_move(db: Rekordbox6Database, args) -> None:
    cue = db.session.query(DjmdCue).filter(DjmdCue.ID == str(args.cue_id)).one()
    cue.InMsec = args.ms
    cue.InFrame = frames(args.ms)
    db.commit()
    print(f"moved cue {cue.ID} (Kind {cue.Kind}) to {args.ms} ms")


def cmd_delete(db: Rekordbox6Database, args) -> None:
    cue = db.session.query(DjmdCue).filter(DjmdCue.ID == str(args.cue_id)).one()
    if args.soft:
        cue.rb_local_deleted = 1
        print(f"soft-deleted cue {cue.ID} (rb_local_deleted=1)")
    else:
        db.session.delete(cue)
        print(f"hard-deleted cue {cue.ID}")
    db.commit()


def cmd_set_key(db: Rekordbox6Database, args) -> None:
    content = find_content(db, args.track)
    key = (db.session.query(DjmdKey)
           .filter(DjmdKey.ScaleName == args.key).one_or_none())
    if key is None:
        # RB7-authored djmdKey rows carry Seq=None (observed test library)
        key = DjmdKey(
            ID=str(db.generate_unused_id(DjmdKey)),
            ScaleName=args.key,
            Seq=None,
            UUID=str(uuid.uuid4()),
            rb_data_status=0,
            rb_local_data_status=0,
            rb_local_deleted=0,
            rb_local_synced=0,
        )
        db.session.add(key)
        print(f"created djmdKey {key.ID} ScaleName={args.key!r}")
    content.KeyID = key.ID
    db.commit()
    print(f"set KeyID={key.ID} ({args.key}) on {content.Title!r}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add-pair")
    p.add_argument("--track", required=True)
    p.add_argument("--ms", type=int, required=True)
    p.add_argument("--slot", type=int, required=True, help="hot cue slot 1-8")
    p.add_argument("--comment", default="")
    p.add_argument("--color-index", type=int, default=None)

    p = sub.add_parser("move")
    p.add_argument("--cue-id", required=True)
    p.add_argument("--ms", type=int, required=True)

    p = sub.add_parser("delete")
    p.add_argument("--cue-id", required=True)
    p.add_argument("--soft", action="store_true")

    p = sub.add_parser("set-key")
    p.add_argument("--track", required=True)
    p.add_argument("--key", required=True, help="ScaleName, e.g. 10B or Gm")

    args = ap.parse_args()
    db = open_db_guarded()
    {"add-pair": cmd_add_pair, "move": cmd_move,
     "delete": cmd_delete, "set-key": cmd_set_key}[args.cmd](db, args)


if __name__ == "__main__":
    main()
