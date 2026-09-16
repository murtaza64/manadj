#!/usr/bin/env -S uv run --script
"""Engine device export/verify CLI (#268).

Experimental writer — decoy/rehearsal outputs only until parent
verification passes. Refuses /Volumes, ~/Music, ~/Library destinations
by construction (enginedj.device_export safety rules).

Usage:
  uv run scripts/engine_usb.py export --dest DIR --manadj-db PATH \
      [--donor DATABASE2_DIR] [--audio-dir NAME] [--overwrite] [--json]
  uv run scripts/engine_usb.py verify --dest DIR [--manadj-db PATH] [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from enginedj.device_export import (
    DeviceExportError,
    DeviceExportOptions,
    export_device_library,
)
from enginedj.device_verify import verify_device_library


def _manadj_session(db_path: Path):
    if not db_path.is_file():
        raise SystemExit(f"manadj db not found: {db_path}")
    engine = create_engine(f"sqlite:///{db_path}")
    return sessionmaker(bind=engine)()


def cmd_export(args: argparse.Namespace) -> int:
    session = _manadj_session(Path(args.manadj_db))
    options = DeviceExportOptions(
        dest_root=Path(args.dest),
        donor_database_dir=Path(args.donor) if args.donor else None,
        audio_dir_name=args.audio_dir,
        overwrite=args.overwrite,
    )
    try:
        report = export_device_library(session, options)
    except DeviceExportError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    finally:
        session.close()
    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        data = report.to_dict()
        print(f"exported {data['tracks_exported']} tracks "
              f"({data['analyzed_rows']} analyzed, {data['donor_matched']} donor-matched) "
              f"to {data['dest_root']}")
        print(f"library uuid: {data['library_uuid']}")
        for playlist in data["playlists"]:
            print(f"  playlist {playlist['title']!r}: {playlist['entities']} tracks")
        for skip in data["tracks_skipped"]:
            print(f"  skipped manadj#{skip['manadj_id']}: {skip['status']}")
        if data["skipped_playlist_entries"]:
            print(f"  skipped playlist entries: {data['skipped_playlist_entries']}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    session = _manadj_session(Path(args.manadj_db)) if args.manadj_db else None
    try:
        report = verify_device_library(Path(args.dest), session)
    finally:
        if session is not None:
            session.close()
    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        for check in report.checks:
            mark = "PASS" if check.ok else "FAIL"
            detail = f" — {check.detail}" if check.detail and not check.ok else ""
            print(f"[{mark}] {check.name}{detail}")
        print("OK" if report.ok else "FAILED")
    return 0 if report.ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    export = sub.add_parser("export", help="export manadj library to a device directory")
    export.add_argument("--dest", required=True, help="device root directory (decoy!)")
    export.add_argument("--manadj-db", required=True, help="manadj sqlite db path")
    export.add_argument("--donor", help="native Engine Database2 dir (read-only donor)")
    export.add_argument("--audio-dir", default="manadj", help="audio dir at device root")
    export.add_argument("--overwrite", action="store_true",
                        help="replace a previous manadj export at dest")
    export.add_argument("--json", action="store_true")
    export.set_defaults(func=cmd_export)

    verify = sub.add_parser("verify", help="verify an exported device directory")
    verify.add_argument("--dest", required=True)
    verify.add_argument("--manadj-db", help="manadj db for exact projection checks")
    verify.add_argument("--json", action="store_true")
    verify.set_defaults(func=cmd_verify)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
