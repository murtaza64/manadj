"""Dump an Engine DJ m.db to JSON for before/after diffing.

Engine write-path spike (library-sync-button/08). Mirrors the RB spike's
rbstate.py protocol: dump -> mutate (Engine UI or our writes) -> quit
Engine -> dump again -> diff the JSONs.

Usage (from repo root):
    uv run scripts/spike_enginedj/enginestate.py --json out.json
    uv run scripts/spike_enginedj/enginestate.py --db "/path/to/Database2" --json out.json
    uv run scripts/spike_enginedj/enginestate.py --schema   # include CREATE TABLE dump

Read-only. Default DB is the LIVE library; reading the real library is
safe, but write experiments must only ever target a marked test library
(.manadj-test-library in the Engine Library dir — see enginelib.sh).

Dumped per track: every Track column, plus PerformanceData blob forensics —
lengths + sha1 for all blobs, decoded beatData/quickCues via
enginedj.performance_blobs, and raw hex for small blobs (the byte-exact
reference an encoder must reproduce).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from sqlalchemy import text  # noqa: E402

from enginedj.connection import EngineDJDatabase  # noqa: E402
from enginedj.models import (  # noqa: E402
    Information,
    PerformanceData,
    Playlist,
    PlaylistEntity,
    Track,
)
from enginedj import performance_blobs as pb  # noqa: E402

DEFAULT_DB = Path.home() / "Music" / "Engine Library" / "Database2"
HEX_CAP = 8192  # include raw hex for blobs up to this size (post-compression)


def row_to_dict(obj: Any) -> dict[str, Any]:
    out = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, bytes):
            val = {"len": len(val), "sha1": hashlib.sha1(val).hexdigest()}
        out[col.name] = val
    return out


def blob_report(name: str, blob: bytes | None) -> dict[str, Any]:
    if blob is None:
        return {"present": False}
    rep: dict[str, Any] = {
        "present": True,
        "len": len(blob),
        "sha1": hashlib.sha1(blob).hexdigest(),
    }
    if len(blob) <= HEX_CAP:
        rep["hex"] = blob.hex()
    try:
        raw = pb.q_uncompress(blob)
        rep["uncompressed_len"] = len(raw)
        if len(raw) <= HEX_CAP:
            rep["uncompressed_hex"] = raw.hex()
    except Exception as e:  # not qCompress-framed or corrupt
        rep["uncompress_error"] = repr(e)
        return rep
    try:
        if name == "beatData":
            bd = pb.parse_beat_data(blob)
            def grid(markers: list[pb.GridMarker]) -> list[dict[str, Any]]:
                return [
                    {
                        "sample_offset": m.sample_offset,
                        "beat_index": m.beat_index,
                        "beats_to_next": m.beats_to_next,
                    }
                    for m in markers
                ]

            rep["decoded"] = {
                "sample_rate": bd.sample_rate,
                "track_length_samples": bd.track_length_samples,
                "default_grid": grid(bd.default_grid),
                "adjusted_grid": grid(bd.adjusted_grid),
            }
        elif name == "quickCues":
            qc = pb.parse_quick_cues(blob)
            rep["decoded"] = {
                "hot_cues": [
                    {
                        "slot": c.slot,
                        "label": c.label,
                        "sample_offset": c.sample_offset,
                        "color_hex": c.color_hex,
                    }
                    for c in qc.hot_cues
                ],
                "main_cue_samples": qc.main_cue_samples,
                "main_cue_overridden": qc.main_cue_overridden,
                "default_cue_samples": qc.default_cue_samples,
            }
    except pb.BlobParseError as e:
        rep["decode_error"] = repr(e)
    return rep


def dump(db_path: Path, include_schema: bool) -> dict[str, Any]:
    db = EngineDJDatabase(db_path)
    out: dict[str, Any] = {"db_path": str(db_path)}
    with db.session_m() as s:
        out["information"] = [row_to_dict(r) for r in s.query(Information).all()]

        tracks = []
        for t in s.query(Track).order_by(Track.id).all():
            row = row_to_dict(t)
            pd = s.get(PerformanceData, t.id)
            if pd is not None:
                row["performance_data"] = {
                    col.name: blob_report(col.name, getattr(pd, col.name))
                    if isinstance(getattr(pd, col.name), (bytes, type(None)))
                    and col.name != "trackId"
                    else getattr(pd, col.name)
                    for col in pd.__table__.columns
                    if col.name != "trackId"
                }
            tracks.append(row)
        out["tracks"] = tracks

        playlists = []
        for p in s.query(Playlist).order_by(Playlist.id).all():
            row = row_to_dict(p)
            ents = (
                s.query(PlaylistEntity)
                .filter(PlaylistEntity.listId == p.id)
                .all()
            )
            row["entities"] = sorted(
                (row_to_dict(e) for e in ents), key=lambda d: d["id"]
            )
            playlists.append(row)
        out["playlists"] = playlists

        if include_schema:
            rows = s.execute(
                text(
                    "SELECT type, name, sql FROM sqlite_master "
                    "WHERE sql IS NOT NULL ORDER BY type, name"
                )
            ).all()
            out["schema"] = [
                {"type": r[0], "name": r[1], "sql": r[2]} for r in rows
            ]
            out["user_version"] = s.execute(
                text("PRAGMA user_version")
            ).scalar()
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB, help="Database2 dir")
    ap.add_argument("--json", type=Path, help="write JSON here (else stdout)")
    ap.add_argument("--schema", action="store_true", help="include sqlite_master dump")
    args = ap.parse_args()

    if not args.db.is_dir():
        sys.exit(f"error: not a Database2 dir: {args.db}")

    result = dump(args.db, args.schema)
    blob = json.dumps(result, indent=2, sort_keys=False, default=str)
    if args.json:
        args.json.write_text(blob)
        print(f"wrote {args.json} ({len(result['tracks'])} tracks)")
    else:
        print(blob)


if __name__ == "__main__":
    main()
