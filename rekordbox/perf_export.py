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
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# Library dirs already snapshotted during this backend process run.
_snapshotted: set[str] = set()


def _frames(ms: int) -> int:
    """RB's InFrame column: 1/150-second frames (spike-observed)."""
    return int(ms * 150 / 1000)


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

    # -- hot cues --------------------------------------------------------

    def export_hotcues(
        self, filename: str, cues: list[tuple[int, float]], mode: str
    ) -> dict:
        """Reconcile the RB hotcue mirror for one track.

        `cues` are (slot 1-8, manadj seconds); positions are translated
        into RB's decode frame per container class. Returns a summary
        {added, moved, deleted, skipped_slots}.
        """
        from pyrekordbox.db6.tables import DjmdCue

        from rekordbox.decode_offset import manadj_seconds_to_rb_ms

        ensure_rekordbox_closed()
        content = self._content_for(filename)
        desired = {
            slot: manadj_seconds_to_rb_ms(sec, content.FolderPath)
            for slot, sec in cues
        }
        rows = (
            self._db.session.query(DjmdCue)
            .filter(DjmdCue.ContentID == content.ID, DjmdCue.rb_local_deleted == 0)
            .all()
        )
        hot = [r for r in rows if r.Kind and 1 <= r.Kind <= 8]
        memory = [r for r in rows if r.Kind == 0]
        plan = plan_hotcue_export(desired, hot, memory, mode)
        summary = {
            "added": sum(1 for a in plan.adds if a.slot),
            "moved": 0,
            "deleted": 0,
            "skipped_slots": sorted(plan.skipped_slots),
        }
        if plan.empty:
            return summary

        snapshot_library(self._db_dir)
        by_id = {r.ID: r for r in rows}
        for mv in plan.moves:
            row = by_id[mv.row_id]
            row.InMsec = mv.rb_ms
            row.InFrame = _frames(mv.rb_ms)
            if row.Kind:  # count desired-slot moves, not their twins
                summary["moved"] += 1
        for row_id in plan.soft_deletes:
            by_id[row_id].rb_local_deleted = 1
            if by_id[row_id].Kind:
                summary["deleted"] += 1
        for add in plan.adds:
            # slot 0 = bare memory row (twin for a moved cue)
            self._db.session.add(self._new_cue_row(content, add.slot, add.rb_ms))
            if add.slot and add.memory_twin:
                self._db.session.add(self._new_cue_row(content, 0, add.rb_ms))
        self._db.commit(autoinc=True)
        logger.info(
            "exported hotcues -> rekordbox %s: %s", content.FolderPath, summary
        )
        return summary

    def _new_cue_row(self, content, kind: int, ms: int):
        """RB7 minimal cue row shape (spike-verified): hot cue == memory
        cue shape, only Kind differs; NULL extras (NULL is not 0 — rows
        with zeroed extras render, mixed NULL/color rows silently don't)."""
        from pyrekordbox.db6.tables import DjmdCue

        return DjmdCue(
            ID=str(self._db.generate_unused_id(DjmdCue)),
            ContentID=content.ID,
            Kind=kind,
            InMsec=ms,
            InFrame=_frames(ms),
            InMpegFrame=0,
            InMpegAbs=0,
            OutMsec=-1,
            OutFrame=0,
            OutMpegFrame=0,
            OutMpegAbs=0,
            Color=-1,
            ContentUUID=content.UUID,
            UUID=str(uuid.uuid4()),
            rb_data_status=0,
            rb_local_data_status=0,
            rb_local_deleted=0,
            rb_local_synced=0,
        )

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


# -- hot cues ----------------------------------------------------------------
#
# Mirroring model (performance-data-sync/08): each manadj hotcue exists in
# Rekordbox as BOTH a hot cue row (Kind=slot, provisionally 1-8 == A-H) and
# a memory cue row (Kind=0) at the same millisecond. Export reconciles the
# whole mirror; the pure planner below is where all the semantics live.


@dataclass(frozen=True)
class CueAdd:
    slot: int
    rb_ms: int
    memory_twin: bool  # also create the Kind=0 twin (absent at that ms)


@dataclass(frozen=True)
class CueMove:
    row_id: str
    rb_ms: int


@dataclass
class HotcueExportPlan:
    adds: list[CueAdd] = field(default_factory=list)
    moves: list[CueMove] = field(default_factory=list)
    soft_deletes: list[str] = field(default_factory=list)
    skipped_slots: list[int] = field(default_factory=list)  # add-only: left alone

    @property
    def empty(self) -> bool:
        return not (self.adds or self.moves or self.soft_deletes)


def plan_hotcue_export(
    desired: dict[int, int],  # slot -> rb_ms (already offset-applied)
    hot_rows: list,  # DjmdCue-shaped: .ID .Kind .InMsec
    memory_rows: list,  # DjmdCue-shaped, Kind == 0
    mode: str,  # "add-only" | "replace-all"
) -> HotcueExportPlan:
    """Reconcile the RB cue mirror against the desired manadj cue set.

    add-only: new slots only — existing RB rows are never touched (the
    unconfirmed tier). replace-all: full reconcile (confirmed) — moved
    slots update both mirror rows, RB-only hot cues and stray memory
    cues are soft-deleted (rb_local_deleted, spike-verified).
    """
    plan = HotcueExportPlan()
    hot_by_slot = {r.Kind: r for r in hot_rows}
    memory_by_ms: dict[int, list] = {}
    for r in memory_rows:
        memory_by_ms.setdefault(r.InMsec, []).append(r)

    def claim_twin(ms: int) -> bool:
        """True if a memory row already sits at ms (and consume one)."""
        rows = memory_by_ms.get(ms)
        if rows:
            rows.pop()
            return True
        return False

    for slot in sorted(desired):
        ms = desired[slot]
        existing = hot_by_slot.pop(slot, None)
        if existing is None:
            plan.adds.append(CueAdd(slot=slot, rb_ms=ms, memory_twin=not claim_twin(ms)))
        elif mode == "add-only":
            plan.skipped_slots.append(slot)
            claim_twin(existing.InMsec)  # its twin stays too
        elif existing.InMsec != ms:
            plan.moves.append(CueMove(row_id=existing.ID, rb_ms=ms))
            # move the twin with it, or create one at the new position
            old_twins = memory_by_ms.get(existing.InMsec)
            if old_twins:
                plan.moves.append(CueMove(row_id=old_twins.pop().ID, rb_ms=ms))
            elif not claim_twin(ms):
                plan.adds.append(CueAdd(slot=0, rb_ms=ms, memory_twin=False))
        else:
            # in place; keep its twin — replace-all also HEALS a missing
            # twin (the mirror invariant is the point of the confirm tier)
            if not claim_twin(ms) and mode == "replace-all":
                plan.adds.append(CueAdd(slot=0, rb_ms=ms, memory_twin=False))

    if mode == "replace-all":
        # RB-only hot cues and unclaimed (stray) memory cues leave the mirror
        for row in hot_by_slot.values():
            plan.soft_deletes.append(row.ID)
            old_twins = memory_by_ms.get(row.InMsec)
            if old_twins:
                plan.soft_deletes.append(old_twins.pop().ID)
        for rows in memory_by_ms.values():
            plan.soft_deletes.extend(r.ID for r in rows)
    return plan
