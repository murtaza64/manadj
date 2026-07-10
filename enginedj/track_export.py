"""Direct track insertion into Engine DJ's m.db (presence Export).

Replaces the RBXML detour (ADR 0006, amended): the historic blocker for
direct inserts was a single NULL — Engine's browser refuses to hydrate a
Track row whose ``albumArtId`` doesn't reference an AlbumArt row. With
that satisfied, a minimal metadata row renders, plays, and is
auto-analyzed by Engine on first load. Full recipe and evidence:
docs/research/enginedj-write.md (library-sync-button/08 spike).

Schema triggers in a real m.db do part of the ritual (self-referential
origin stamping, PerformanceData row creation, id-recycling guard).
Schema-real test databases built from these models have no triggers, so
`insert_track` performs the same steps explicitly and idempotently.

Safety mirrors rekordbox/perf_export.py: writes require Engine DJ closed
and snapshot the Database2 dir once per process run (APFS clonefile).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from .models.album_art import AlbumArt
from .models.information import Information
from .models.performance_data import PerformanceData
from .models.track import Track

logger = logging.getLogger(__name__)

# Database2 dirs already snapshotted during this backend process run.
_snapshotted: set[str] = set()

# Matches the app binary only: crashpad_handler processes under
# Contents/Resources linger after Engine quits and must not count.
_ENGINE_PROCESS_PATTERN = r"Engine DJ\.app/Contents/MacOS/Engine DJ"


class EngineRunningError(RuntimeError):
    """Engine DJ is open; its database must not be written."""


def ensure_engine_closed() -> None:
    probe = subprocess.run(
        ["pgrep", "-f", _ENGINE_PROCESS_PATTERN], capture_output=True
    )
    if probe.returncode == 0:
        raise EngineRunningError(
            "Engine DJ is running — quit it before exporting"
        )


def snapshot_database(database_dir: Path) -> Path | None:
    """Snapshot the Engine Database2 dir next to the library, once per
    process run. Returns the snapshot path, or None when this run already
    has one. APFS clonefile (`cp -Rc`), plain copy fallback."""
    database_dir = Path(database_dir)
    if str(database_dir) in _snapshotted:
        return None
    library_root = database_dir.parent
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = (
        library_root.parent
        / f"{library_root.name}-snapshots"
        / f"{stamp}-manadj-pre-write-db2"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["cp", "-Rc", str(database_dir), str(dest)],
            check=True,
            capture_output=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        shutil.copytree(database_dir, dest)
    _snapshotted.add(str(database_dir))
    logger.info("engine Database2 snapshot: %s", dest)
    return dest


@dataclass
class EngineTrackSpec:
    """Everything a minimal Engine Track row needs, in manadj terms."""

    abs_path: Path
    title: str
    artist: str | None = None
    album: str | None = None
    genre: str | None = None
    comment: str | None = None
    year: int | None = None
    length_secs: int | None = None
    bitrate_kbps: int | None = None


def get_or_create_empty_album_art(session: Session) -> int:
    """The shared 'no art' AlbumArt row (Engine requires albumArtId to
    resolve; an empty row satisfies it — spike exp D)."""
    row = (
        session.query(AlbumArt)
        .filter(AlbumArt.hash == "", AlbumArt.albumArt.is_(None))
        .first()
    )
    if row is None:
        row = AlbumArt(hash="", albumArt=None)
        session.add(row)
        session.flush()
    return row.id


def insert_track(session: Session, spec: EngineTrackSpec, library_root: Path) -> int:
    """Insert one track row per the spike's minimal recipe. Returns the
    new Engine track id. Caller owns the session/transaction."""
    info = session.query(Information).first()
    db_uuid = info.uuid if info else None
    stat = spec.abs_path.stat()
    now = int(time.time())
    rel_path = Path(os.path.relpath(spec.abs_path, library_root)).as_posix()

    track = Track(
        path=rel_path,
        filename=spec.abs_path.name,
        fileType=spec.abs_path.suffix.lstrip(".").lower(),
        fileBytes=stat.st_size,
        length=spec.length_secs,
        bitrate=spec.bitrate_kbps,
        title=spec.title,
        artist=spec.artist,
        album=spec.album,
        genre=spec.genre,
        comment=spec.comment,
        year=spec.year,
        rating=0,
        albumArtId=get_or_create_empty_album_art(session),
        isAnalyzed=False,  # Engine auto-analyzes on first load
        isPlayed=False,
        isAvailable=True,
        isMetadataImported=True,
        isMetadataOfPackedTrackChanged=False,
        isPerfomanceDataOfPackedTrackChanged=False,
        isBeatGridLocked=False,
        explicitLyrics=False,
        dateCreated=int(stat.st_mtime),
        dateAdded=now,
        lastEditTime=now,
        streamingFlags=0,
        pdbImportKey=0,
        # origin left NULL: real m.db's fix_origin trigger stamps it
    )
    session.add(track)
    session.flush()

    # Explicit ritual for trigger-less databases (idempotent where the
    # real DB's triggers already ran).
    track.originTrackId = track.id
    track.originDatabaseUuid = db_uuid
    if session.get(PerformanceData, track.id) is None:
        session.add(PerformanceData(trackId=track.id))

    return track.id
