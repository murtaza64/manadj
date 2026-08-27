#!/usr/bin/env python3
"""Stem-splitting backfill + GC (stems map #118, build #196).

One bulk run over the active library: splits every Track whose stems are
stale/absent (currency check per #149 — model + STEMS_VERSION + source
identity), skipping current ones, so it is idempotent and interrupt-safe.
Also GCs stem dirs whose track id is archived or no longer exists.

REAL-DB OPERATION: run in the default workspace after landing
(docs/agents/parallel-work.md). Expect ~15-20 s per split track on MPS
(~4.5 h for a full 1000-track library); current tracks cost one stat call.

Usage:
    uv run scripts/backfill_stems.py [--dry-run] [--limit N] [--playlist NAME]
"""

import argparse
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.config import get_config
from backend.database import SessionLocal
from backend.models import Playlist, PlaylistTrack, Track
from backend.stems import is_current, split_track


def _dir_size(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def gc_orphaned_stems(active_ids: set[int], dry_run: bool) -> list[Path]:
    """Delete stem dirs for archived/deleted tracks. Returns what was (or
    would be) removed. Non-numeric dirnames are left alone."""
    root = Path(get_config().stems.directory)
    if not root.exists():
        return []
    removed = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or not child.name.isdigit():
            continue
        if int(child.name) in active_ids:
            continue
        removed.append(child)
        if not dry_run:
            shutil.rmtree(child)
    return removed


def playlist_track_ids(db, name: str) -> set[int]:
    """Track ids of the (case-insensitively) named playlist.

    Raises SystemExit with the available names when nothing matches."""
    playlist = (
        db.query(Playlist).filter(Playlist.name.ilike(name)).first()
        or db.query(Playlist).filter(Playlist.name.ilike(f"%{name}%")).first()
    )
    if playlist is None:
        names = ", ".join(p.name for p in db.query(Playlist).order_by(Playlist.name))
        raise SystemExit(f"no playlist matching {name!r}; have: {names}")
    print(f"playlist filter: {playlist.name} (id {playlist.id})")
    rows = db.query(PlaylistTrack.track_id).filter(PlaylistTrack.playlist_id == playlist.id)
    return {track_id for (track_id,) in rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report, change nothing")
    parser.add_argument("--limit", type=int, default=None, help="split at most N tracks")
    parser.add_argument(
        "--playlist", default=None,
        help="only split tracks in this playlist (case-insensitive name match); "
             "GC still considers the whole library",
    )
    args = parser.parse_args()

    config = get_config().stems
    db = SessionLocal()
    try:
        tracks = db.query(Track).filter(Track.is_active).order_by(Track.id).all()
        # GC scope is always the whole active library, independent of any
        # playlist filter — a filtered run must never delete other stems.
        active_ids = {t.id for t in tracks}
        if args.playlist:
            wanted = playlist_track_ids(db, args.playlist)
            tracks = [t for t in tracks if t.id in wanted]
    finally:
        db.close()

    stale = [t for t in tracks if not is_current(t.id, Path(t.filename), config)]
    missing_files = [t for t in stale if not Path(t.filename).exists()]
    todo = [t for t in stale if Path(t.filename).exists()]
    if args.limit is not None:
        todo = todo[: args.limit]

    print(f"{len(tracks)} active tracks; {len(tracks) - len(stale)} current, "
          f"{len(todo)} to split, {len(missing_files)} missing source files")

    orphans = gc_orphaned_stems(active_ids, args.dry_run)
    if orphans:
        verb = "would remove" if args.dry_run else "removed"
        print(f"GC: {verb} {len(orphans)} orphaned stem dirs: "
              + ", ".join(p.name for p in orphans))

    if args.dry_run:
        for t in todo:
            print(f"  would split {t.id}: {t.artist} - {t.title}")
        return

    total_bytes = 0
    t0 = time.time()
    errors: list[tuple[int, str]] = []
    for i, track in enumerate(todo, 1):
        started = time.time()
        try:
            dest = split_track(track.id, Path(track.filename), config)
        except Exception as exc:  # noqa: BLE001 — one bad file must not stop 4 h of work
            errors.append((track.id, str(exc)[:200]))
            print(f"[{i}/{len(todo)}] {track.id} FAILED: {exc}")
            continue
        size = _dir_size(dest)
        total_bytes += size
        elapsed = time.time() - t0
        rate = elapsed / i
        eta_min = (len(todo) - i) * rate / 60
        print(
            f"[{i}/{len(todo)}] {track.id} {track.artist} - {track.title}: "
            f"{time.time() - started:.1f}s, {size / 1e6:.0f} MB "
            f"(cum {total_bytes / 1e9:.2f} GB, ETA {eta_min:.0f} min)"
        )

    print()
    print(f"Backfill complete: {len(todo) - len(errors)} split, {len(errors)} failed, "
          f"{total_bytes / 1e9:.2f} GB written in {(time.time() - t0) / 60:.1f} min")
    if missing_files:
        print(f"Missing source files ({len(missing_files)}): "
              + ", ".join(str(t.id) for t in missing_files))
    if errors:
        print("Failures:")
        for track_id, msg in errors:
            print(f"  {track_id}: {msg}")
        sys.exit(1)


if __name__ == "__main__":
    main()
