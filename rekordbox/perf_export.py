"""Write performance data into the Rekordbox database.

Foundation slice (rekordbox-perf-export/01): key writes, plus the safety
plumbing every Rekordbox performance write shares — a running-Rekordbox
guard and a once-per-process-run library snapshot.

Recipes and hazards come from the spike
(docs/research/rekordbox-performance-write.md):

- new `djmdKey` rows carry `Seq=None` (Rekordbox's own shape);
- pyrekordbox's `commit(autoinc=True)` handles USNs and refuses while
  Rekordbox runs — we additionally fail fast before touching anything;
- Rekordbox re-analysis reverts exported keys; callers treat that as a
  recurring divergence, not an error.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# Library dirs already snapshotted during this backend process run.
_snapshotted: set[str] = set()


class RekordboxRunningError(RuntimeError):
    """Rekordbox is open; its database must not be written."""


class TrackNotInRekordboxError(LookupError):
    """The Library track has no (unique) match in the Rekordbox DB."""


def ensure_rekordbox_closed() -> None:
    from pyrekordbox.utils import get_rekordbox_pid

    if get_rekordbox_pid():
        raise RekordboxRunningError(
            "Rekordbox is running — quit it before exporting"
        )


def snapshot_library(db_dir: Path) -> Path | None:
    """Snapshot the whole Rekordbox library dir (master.db + ANLZ share)
    next to it, once per process run. Returns the snapshot path, or None
    when this run already has one.

    Uses APFS clonefile (`cp -c`): instant and space-free until files
    diverge. Falls back to a plain copy elsewhere.
    """
    db_dir = Path(db_dir)
    if str(db_dir) in _snapshotted:
        return None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = db_dir.parent / f"{db_dir.name}-snapshots" / f"{stamp}-manadj-pre-write"
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["cp", "-Rc", str(db_dir), str(dest)], check=True, capture_output=True
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        shutil.copytree(db_dir, dest)
    _snapshotted.add(str(db_dir))
    logger.info("rekordbox library snapshot: %s", dest)
    return dest


class RekordboxPerfExporter:
    """One write session against an open Rekordbox DB.

    Construct via the router dependency (which guards on Rekordbox
    running and library configuration); every write snapshots the
    library first (no-op after the first of a run).
    """

    def __init__(self, rb_db, db_dir: Path) -> None:  # Rekordbox6Database
        self._db = rb_db
        self._db_dir = Path(db_dir)

    # -- matching ----------------------------------------------------------

    def _content_for(self, filename: str):
        """DjmdContent for a Library track, by absolute path first, then
        unique basename (mirrors the sync-status path matching)."""
        from pyrekordbox.db6.tables import DjmdContent

        session = self._db.session
        exact = (
            session.query(DjmdContent)
            .filter(DjmdContent.FolderPath == str(filename))
            .all()
        )
        if len(exact) == 1:
            return exact[0]
        name = Path(filename).name
        candidates = [
            c
            for c in session.query(DjmdContent).all()
            if c.FolderPath and Path(c.FolderPath).name == name
        ]
        if len(candidates) == 1:
            return candidates[0]
        raise TrackNotInRekordboxError(
            f"{name}: {'no' if not candidates else 'multiple'} matches in Rekordbox"
        )

    # -- key ---------------------------------------------------------------

    def export_key(self, filename: str, engine_key_id: int) -> str:
        """Write a Library key (canonical Engine ID) onto the matching
        Rekordbox track. Returns the ScaleName written."""
        from backend.key import Key

        ensure_rekordbox_closed()
        content = self._content_for(filename)
        key_obj = Key.from_engine_id(engine_key_id)
        if key_obj is None:
            raise ValueError(f"invalid key id {engine_key_id!r}")
        key_row = self._key_row(key_obj)
        snapshot_library(self._db_dir)
        content.KeyID = key_row.ID
        self._db.commit(autoinc=True)
        logger.info(
            "exported key %s -> rekordbox %s", key_row.ScaleName, content.FolderPath
        )
        return key_row.ScaleName

    def _key_row(self, key_obj):
        """djmdKey row for a Key: reuse an existing row in ANY notation the
        key parses to (Rekordbox's key column shows ScaleName verbatim, so
        notation must stay consistent per library); create in the table's
        dominant notation, Rekordbox's own row shape (Seq=None —
        spike-verified)."""
        from pyrekordbox.db6.tables import DjmdKey

        from backend.key import Key

        rows = (
            self._db.session.query(DjmdKey)
            .filter(DjmdKey.rb_local_deleted == 0)
            .all()
        )
        by_engine_id = {}
        alnum = 0
        for row in rows:
            parsed = Key.from_musical(row.ScaleName)
            if parsed is not None and parsed.engine_id not in by_engine_id:
                by_engine_id[parsed.engine_id] = row
            if row.ScaleName and row.ScaleName[0].isdigit():
                alnum += 1
        existing = by_engine_id.get(key_obj.engine_id)
        if existing is not None:
            return existing
        # no row for this key yet: follow the table's dominant notation
        scale = (
            key_obj.camelot if rows and alnum >= len(rows) / 2 else key_obj.rekordbox
        )
        row = DjmdKey(
            ID=str(self._db.generate_unused_id(DjmdKey)),
            ScaleName=scale,
            Seq=None,
            UUID=str(uuid.uuid4()),
            rb_data_status=0,
            rb_local_data_status=0,
            rb_local_deleted=0,
            rb_local_synced=0,
        )
        self._db.session.add(row)
        return row
