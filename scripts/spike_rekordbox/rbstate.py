"""Dump Rekordbox library state (DB + ANLZ) for the performance-write spike.

Read-only. Safe to run against the real library.

Usage (from repo root):
    uv run python scripts/spike_rekordbox/rbstate.py                 # all tracks, summary
    uv run python scripts/spike_rekordbox/rbstate.py --track "name"  # one track, full detail
    uv run python scripts/spike_rekordbox/rbstate.py --json out.json # machine snapshot for diffing

The JSON snapshot is the before/after diff artifact for every experiment:
dump, mutate, relaunch RB, dump again, diff.
"""

import argparse
import json
import sys
from pathlib import Path

from pyrekordbox.db6 import Rekordbox6Database
from pyrekordbox.db6.tables import DjmdContent, DjmdCue, DjmdKey

RB_DIR = Path.home() / "Library/Pioneer/rekordbox"


def open_db() -> Rekordbox6Database:
    return Rekordbox6Database(db_dir=RB_DIR, path=RB_DIR / "master.db")


CUE_FIELDS = [
    "ID", "ContentID", "Kind", "InMsec", "InFrame", "InMpegFrame", "InMpegAbs",
    "OutMsec", "OutFrame", "OutMpegFrame", "OutMpegAbs", "Color",
    "ColorTableIndex", "ActiveLoop", "Comment", "BeatLoopSize", "CueMicrosec",
    "InPointSeekInfo", "OutPointSeekInfo", "ContentUUID", "UUID",
    "rb_data_status", "rb_local_data_status", "rb_local_deleted",
    "rb_local_synced", "usn", "rb_local_usn", "created_at", "updated_at",
]


def cue_dict(cue: DjmdCue) -> dict:
    return {f: getattr(cue, f) for f in CUE_FIELDS}


def anlz_summary(db: Rekordbox6Database, content: DjmdContent) -> dict:
    """Summarize PQTZ/PQT2 (grid) and PCOB/PCO2 (cues) per ANLZ file."""
    out: dict = {"AnalysisDataPath": content.AnalysisDataPath, "files": {}}
    try:
        files = db.read_anlz_files(content.ID)
    except Exception as e:  # noqa: BLE001 - spike tool, report and move on
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    for path, anlz in files.items():
        # NB: anlz.keys()/len() infinitely recurse in pyrekordbox 0.4.4; use .tags
        fsummary: dict = {"tags": [t.name for t in anlz.tags]}
        for tag in anlz.getall_tags("PQTZ") + anlz.getall_tags("PQT2"):
            fsummary.setdefault(tag.name, []).append(_grid_summary(tag))
        for tag in anlz.getall_tags("PCOB") + anlz.getall_tags("PCO2"):
            fsummary.setdefault(tag.name, []).append(_cue_tag_summary(tag))
        out["files"][str(Path(path).suffix)] = fsummary
    return out


def _grid_summary(tag) -> dict:
    beats = list(tag.beats)  # beat-in-bar numbers
    bpms = list(tag.bpms)
    times = list(tag.times)
    entries = list(zip(beats, bpms, times))
    return {
        "count": len(entries),
        "bpms_unique": sorted(set(bpms)),
        "first": entries[:4],
        "last": entries[-2:],
    }


def _cue_tag_summary(tag) -> dict:
    content = tag.content
    cues = []
    for c in getattr(content, "entries", None) or []:
        cues.append({
            "hot_cue": getattr(c, "hot_cue", None),
            "status": getattr(c, "status", None),
            "type": str(getattr(c, "type", None)),
            "time_ms": getattr(c, "time", None),
            "loop_time": getattr(c, "loop_time", None),
        })
    return {
        "list_type": str(getattr(content, "type", None)),  # memory vs hotcue list
        "count": getattr(content, "count", len(cues)),
        "cues": cues,
    }


def track_state(db: Rekordbox6Database, content: DjmdContent, anlz: bool) -> dict:
    key_row = None
    if content.KeyID:
        key_row = db.session.query(DjmdKey).filter(DjmdKey.ID == content.KeyID).one_or_none()
    cues = (
        db.session.query(DjmdCue)
        .filter(DjmdCue.ContentID == content.ID)
        .order_by(DjmdCue.Kind, DjmdCue.InMsec)
        .all()
    )
    state = {
        "ID": content.ID,
        "Title": content.Title,
        "FolderPath": content.FolderPath,
        "BPM": content.BPM,
        "KeyID": content.KeyID,
        "Key": key_row.ScaleName if key_row else None,
        "Analysed": content.Analysed,
        "AnalysisDataPath": content.AnalysisDataPath,
        "rb_local_usn": content.rb_local_usn,
        "cues": [cue_dict(c) for c in cues],
    }
    if anlz:
        state["anlz"] = anlz_summary(db, content)
    return state


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", help="substring match on Title; full detail")
    ap.add_argument("--json", help="write full-library JSON snapshot to path")
    ap.add_argument("--keys", action="store_true", help="dump djmdKey table")
    args = ap.parse_args()

    db = open_db()

    if args.keys:
        for k in db.session.query(DjmdKey).order_by(DjmdKey.Seq).all():
            print(f"  key ID={k.ID} ScaleName={k.ScaleName!r} Seq={k.Seq}")
        return

    contents = db.get_content().all()

    if args.json:
        snap = [track_state(db, c, anlz=True) for c in contents]
        Path(args.json).write_text(json.dumps(snap, indent=2, default=str))
        print(f"wrote {args.json} ({len(snap)} tracks)")
        return

    for c in contents:
        hay = ((c.Title or "") + " " + (c.FileNameL or "")).lower()
        if args.track and args.track.lower() not in hay:
            continue
        if args.track:
            print(json.dumps(track_state(db, c, anlz=True), indent=2, default=str))
        else:
            ncues = db.session.query(DjmdCue).filter(DjmdCue.ContentID == c.ID).count()
            print(f"{c.ID}  {c.Title!r}  BPM={c.BPM} KeyID={c.KeyID} cues={ncues} anlz={c.AnalysisDataPath}")


if __name__ == "__main__":
    sys.exit(main())
