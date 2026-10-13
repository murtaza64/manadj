"""Portable copy-on-write file/tree clones (#303).

macOS: APFS clonefile via `cp -c` / `cp -Rc` (instant, block-shared).
Linux: `cp --reflink=auto` (CoW on btrfs/XFS, plain copy elsewhere).
Windows, or any clone failure: shutil copy.

Stdlib-only: scripts/agent/db_backup.py imports it outside the app.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def _cp(args: list[str]) -> bool:
    try:
        subprocess.run(["cp", *args], check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return False
    return True


def clone_file(src: Path | str, dest: Path | str) -> None:
    """Clone one file to `dest` (overwrites)."""
    src, dest = str(src), str(dest)
    if sys.platform == "darwin" and _cp(["-c", src, dest]):
        return
    if sys.platform.startswith("linux") and _cp(["--reflink=auto", src, dest]):
        return
    shutil.copy2(src, dest)


def clone_tree(src: Path | str, dest: Path | str) -> None:
    """Clone directory `src` to `dest`, which must not exist yet."""
    src_p, dest_p = Path(src), Path(dest)
    if dest_p.exists():
        raise FileExistsError(dest_p)
    if sys.platform == "darwin" and _cp(["-Rc", str(src_p), str(dest_p)]):
        return
    if sys.platform.startswith("linux") and _cp(
        ["-R", "--reflink=auto", str(src_p), str(dest_p)]
    ):
        return
    if dest_p.exists():  # partial clone from a failed cp
        shutil.rmtree(dest_p)
    shutil.copytree(src_p, dest_p)
