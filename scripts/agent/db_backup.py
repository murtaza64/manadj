#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Real-DB backups: APFS-cheap, automatic, retained (editspace-migration 06).

Backs up /Users/murtaza/manadj/data/library.db into data/backups/ as
library-<UTC timestamp>.db via `cp -c` (APFS clone: instant, block-shared).
Fires automatically from:
  - backend startup, BEFORE alembic upgrade (backend/main.py)
  - lane_app.py ensure_sandbox_db (every lane-app start = a backup point)
Both call `maybe_backup()`, which skips if the newest backup is younger than
MIN_INTERVAL — so hot-reload loops don't spam clones.

Retention: keep everything from the last 48h, then one per day for 14 days,
then one per week. Pruning runs after every backup.

Manual usage:
  uv run scripts/agent/db_backup.py            # backup now (respects interval)
  uv run scripts/agent/db_backup.py --force    # backup now, unconditionally
  uv run scripts/agent/db_backup.py --harvest PATH   # lane-closure harvest:
        adopt PATH (a lane's sandbox clone) as a backup if it is newer than
        the newest existing backup. Run before rm -rf'ing a lane dir.

RESTORE RUNBOOK (incident-tested 2026-07-08):
  1. Stop the backend (and don't relaunch until step 4).
  2. mv data/library.db data/library.db.BAD-<date>   # quarantine, never delete
  3. cp -c data/backups/<chosen>.db data/library.db
  4. uv run alembic upgrade head && sqlite3 data/library.db "PRAGMA integrity_check;"
  5. Boot the app; re-run derived-data backfills if the backup predates them
     (scripts/backfill_bpm_from_grids.py --apply, scripts/backfill_analysis.py).
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path("/Users/murtaza/manadj/data")
REAL_DB = DATA_DIR / "library.db"
BACKUP_DIR = DATA_DIR / "backups"
STAMP = "%Y%m%d-%H%M%S"
NAME_RE = re.compile(r"^library-(\d{8}-\d{6})\.db$")

MIN_INTERVAL_S = 30 * 60          # maybe_backup: skip if newest is younger
KEEP_ALL_WINDOW_S = 48 * 3600     # retention: keep everything this recent
DAILY_WINDOW_S = 14 * 24 * 3600   # then one per day out to here
# beyond DAILY_WINDOW_S: one per ISO week


def _backups() -> list[tuple[float, Path]]:
    out = []
    if not BACKUP_DIR.is_dir():
        return out
    for p in BACKUP_DIR.iterdir():
        m = NAME_RE.match(p.name)
        if m:
            ts = datetime.strptime(m.group(1), STAMP).replace(tzinfo=timezone.utc)
            out.append((ts.timestamp(), p))
    return sorted(out)


def _clone(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cp", "-c", str(src), str(dest)], check=True)


def backup(force: bool = False, quiet: bool = False) -> Path | None:
    """Take a backup (respecting MIN_INTERVAL unless force). Returns the path."""
    if not REAL_DB.exists():
        if not quiet:
            print(f"db_backup: no real DB at {REAL_DB}; nothing to do")
        return None
    existing = _backups()
    now = time.time()
    if not force and existing and now - existing[-1][0] < MIN_INTERVAL_S:
        return None
    stamp = datetime.now(timezone.utc).strftime(STAMP)
    dest = BACKUP_DIR / f"library-{stamp}.db"
    _clone(REAL_DB, dest)
    prune(quiet=quiet)
    if not quiet:
        print(f"db_backup: {dest}")
    return dest


def maybe_backup() -> Path | None:
    """Interval-gated backup for automatic call sites. Never raises."""
    try:
        return backup(force=False, quiet=True)
    except Exception:
        return None


def harvest(path: Path) -> Path | None:
    """Adopt a lane's sandbox clone as a backup if newer than the newest one."""
    if not path.exists():
        sys.exit(f"db_backup: harvest source not found: {path}")
    src_mtime = path.stat().st_mtime
    existing = _backups()
    if existing and existing[-1][0] >= src_mtime:
        print("db_backup: newest backup is fresher than harvest source; skipped")
        return None
    stamp = datetime.fromtimestamp(src_mtime, timezone.utc).strftime(STAMP)
    dest = BACKUP_DIR / f"library-{stamp}.db"
    if dest.exists():
        print(f"db_backup: {dest} already exists; skipped")
        return None
    _clone(path, dest)
    print(f"db_backup: harvested {path} -> {dest}")
    return dest


def prune(quiet: bool = False) -> None:
    """Thin old backups: all <48h, dailies to 14d, weeklies beyond."""
    now = time.time()
    keep: set[Path] = set()
    daily_seen: set[str] = set()
    weekly_seen: set[str] = set()
    for ts, p in reversed(_backups()):  # newest first
        age = now - ts
        d = datetime.fromtimestamp(ts, timezone.utc)
        if age < KEEP_ALL_WINDOW_S:
            keep.add(p)
        elif age < DAILY_WINDOW_S:
            key = d.strftime("%Y%m%d")
            if key not in daily_seen:
                daily_seen.add(key)
                keep.add(p)
        else:
            key = d.strftime("%G-%V")
            if key not in weekly_seen:
                weekly_seen.add(key)
                keep.add(p)
    for _, p in _backups():
        if p not in keep:
            p.unlink()
            if not quiet:
                print(f"db_backup: pruned {p.name}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--harvest", metavar="PATH")
    args = ap.parse_args()
    if args.harvest:
        harvest(Path(args.harvest))
        return
    result = backup(force=args.force)
    if result is None and not args.force:
        print("db_backup: recent backup exists; skipped (use --force)")


if __name__ == "__main__":
    main()
