"""Engine DJ per-drive libraries (#307).

Engine keeps one ``Engine Library`` at the root of every drive that holds
music, each with its own ``Database2/m.db`` and paths relative to that
library (docs/research/cross-platform.md, Filesystem — Engine). manadj's
``engine_dj_path`` names the main library; the others are discovered:

- Windows: ``<X:>\\Engine Library\\Database2`` for each mounted drive letter
- macOS: ``/Volumes/<name>/Engine Library/Database2`` for each mounted volume

Reads (sync status) union every library; writes go to the library on the
track's own drive, or are skipped when that drive has none.
"""

from __future__ import annotations

import logging
import os
import string
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath

logger = logging.getLogger(__name__)

LIBRARY_DIRNAME = "Engine Library"


def volume_of(path: str, platform: str = sys.platform) -> str:
    """The drive/volume a path lives on, as a comparable key."""
    if platform == "win32":
        return PureWindowsPath(path).drive.casefold()
    parts = PurePosixPath(path).parts
    if platform == "darwin" and len(parts) >= 3 and parts[1] == "Volumes":
        return f"/Volumes/{parts[2]}"
    return "/"


def drive_roots(platform: str = sys.platform) -> list[Path]:
    """Mounted drive roots that could hold an Engine Library."""
    if platform == "win32":
        roots = [Path(f"{letter}:\\") for letter in string.ascii_uppercase[2:]]
        return [r for r in roots if os.path.exists(r)]
    if platform == "darwin":
        volumes = Path("/Volumes")
        if not volumes.is_dir():
            return []
        # Skip the boot volume's /Volumes alias (a symlink to "/").
        return sorted(
            v for v in volumes.iterdir() if v.is_dir() and v.resolve() != Path("/")
        )
    return []


def discover_drive_libraries(
    main_database2: Path, roots: list[Path] | None = None
) -> list[Path]:
    """Database2 dirs of the per-drive libraries other than the main one."""
    roots = drive_roots() if roots is None else roots
    main = _canonical(main_database2)
    found = []
    for root in roots:
        database2 = root / LIBRARY_DIRNAME / "Database2"
        try:
            if (database2 / "m.db").is_file() and _canonical(database2) != main:
                found.append(database2)
        except OSError:  # unreadable/ejecting drive
            continue
    return found


def _canonical(path: Path) -> str:
    try:
        return os.path.normcase(str(path.resolve()))
    except OSError:
        return os.path.normcase(str(path))


def open_drive_libraries(main_database2: Path) -> list:
    """EngineDJDatabase for each discovered per-drive library; unreadable
    ones are logged and left out."""
    from enginedj.connection import EngineDJDatabase

    dbs = []
    for database2 in discover_drive_libraries(main_database2):
        try:
            dbs.append(EngineDJDatabase(database2))
        except Exception as e:
            logger.warning("engine: drive library unavailable %s: %s", database2, e)
    return dbs


def owning_library[DB](abs_path: str, libraries: list[DB], root_of) -> DB | None:
    """The library on `abs_path`'s drive (the first listed wins, so pass the
    main library first); None when that drive has no Engine Library."""
    volume = volume_of(abs_path)
    for lib in libraries:
        if volume_of(str(root_of(lib))) == volume:
            return lib
    return None
