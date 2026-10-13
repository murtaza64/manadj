"""Export manadj playlists to a rekordbox USB tree.

Usage:
    uv run -m rekordbox.device.export_cli --playlist "dnb set 7" --dest /Volumes/STICK
    uv run -m rekordbox.device.export_cli --playlist-id 3 --dest /tmp/usb-tree

The destination is a plain directory: point it at a FAT32 stick's mount
point for hardware, or anywhere on disk to inspect with
`uv run -m rekordbox.device.dump <dest>`.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from fastapi import HTTPException

from backend import models
from backend.database import SessionLocal
from backend.export_gate import require_export_enabled
from rekordbox.device.export import export_playlists


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--playlist", action="append", default=[], help="playlist name")
    parser.add_argument("--playlist-id", action="append", type=int, default=[], help="playlist id")
    parser.add_argument("--dest", type=Path, required=True)
    parser.add_argument("--no-audio", action="store_true", help="skip audio copy")
    parser.add_argument("--verify", action="store_true", help="read back the complete device tree")
    args = parser.parse_args(argv)

    try:
        require_export_enabled()
    except HTTPException as exc:
        raise SystemExit(exc.detail) from exc

    if args.dest.resolve().is_mount():
        from rekordbox.perf_export import ensure_rekordbox_closed

        ensure_rekordbox_closed()
    if (args.dest / "PIONEER/rekordbox/exportLibrary.db").exists():
        raise SystemExit("Destination has OneLibrary data; use a fresh classic-library destination")

    db = SessionLocal()
    try:
        ids = list(args.playlist_id)
        for name in args.playlist:
            playlist = db.query(models.Playlist).filter(models.Playlist.name == name).one_or_none()
            if playlist is None:
                raise SystemExit(f"no playlist named {name!r}")
            ids.append(playlist.id)
        if not ids:
            raise SystemExit("give at least one --playlist/--playlist-id")
        report = export_playlists(db, ids, args.dest, copy_audio=not args.no_audio)
    finally:
        db.close()

    print(
        f"exported {report.track_count} tracks, {report.playlist_count} playlists, "
        f"{report.audio_copied} audio files -> {report.dest}"
    )
    for track_id, reason in report.skipped:
        print(f"  skipped track {track_id}: {reason}")
    if args.verify:
        from rekordbox.device.verify import verify_export

        result = verify_export(args.dest)
        for error in result["errors"]:
            print(f"  verification error: {error}")
        if result["errors"]:
            raise SystemExit(1)
        print(f"verified {result['tracks']} tracks, {result['analysis_files']} analysis files")


if __name__ == "__main__":
    main()
