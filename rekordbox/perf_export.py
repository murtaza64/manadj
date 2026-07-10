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
        self,
        filename: str,
        cues: list[tuple[int, float, str | None, str | None]],
        mode: str,
    ) -> dict:
        """Reconcile the RB hotcue mirror for one track.

        `cues` are (slot 1-8, manadj seconds, label, #RRGGBB color);
        positions are translated into RB's decode frame per container
        class, colors to the nearest RB palette index (cue_mapping).
        Returns a summary {added, moved, deleted, skipped_slots}.
        """
        from pyrekordbox.db6.tables import DjmdCue

        from rekordbox.decode_offset import manadj_seconds_to_rb_ms

        ensure_rekordbox_closed()
        content = self._content_for(filename)
        from rekordbox.cue_mapping import nearest_palette_index

        desired = {
            slot: manadj_seconds_to_rb_ms(sec, content.FolderPath)
            for slot, sec, _label, _color in cues
        }
        deco = {
            slot: (label or None, nearest_palette_index(color))
            for slot, _sec, label, color in cues
        }
        from rekordbox.cue_mapping import HOT_CUE_KINDS, MEMORY_KIND

        rows = (
            self._db.session.query(DjmdCue)
            .filter(DjmdCue.ContentID == content.ID, DjmdCue.rb_local_deleted == 0)
            .all()
        )
        hot = [r for r in rows if r.Kind in HOT_CUE_KINDS]
        memory = [r for r in rows if r.Kind == MEMORY_KIND]
        plan = plan_hotcue_export(desired, hot, memory, mode, deco)
        summary = {
            "added": sum(1 for a in plan.adds if a.slot),
            "moved": 0,
            "deleted": 0,
            "refreshed": 0,
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
        for rf in plan.refreshes:
            row = by_id[rf.row_id]
            row.Comment = rf.label
            row.Color = rf.color_index if rf.color_index is not None else -1
        summary["refreshed"] = len(plan.refreshes)
        for row_id in plan.soft_deletes:
            by_id[row_id].rb_local_deleted = 1
            if by_id[row_id].Kind:
                summary["deleted"] += 1
        from rekordbox.cue_mapping import SLOT_TO_KIND

        for add in plan.adds:
            # slot 0 = bare memory row (twin for a moved cue)
            kind = SLOT_TO_KIND.get(add.slot, 0) if add.slot else 0
            label, color_idx = deco.get(add.slot, (None, None)) if add.slot else (None, None)
            self._db.session.add(
                self._new_cue_row(content, kind, add.rb_ms, label, color_idx)
            )
            if add.slot and add.memory_twin:
                # the twin IS the same cue in the mirror model: same deco
                self._db.session.add(
                    self._new_cue_row(content, 0, add.rb_ms, label, color_idx)
                )
        self._db.commit(autoinc=True)
        logger.info(
            "exported hotcues -> rekordbox %s: %s", content.FolderPath, summary
        )
        return summary

    def _new_cue_row(
        self,
        content,
        kind: int,
        ms: int,
        label: str | None = None,
        color_index: int | None = None,
    ):
        """RB7 cue row shape (spike + probe verified): hot cue == memory
        cue shape, only Kind differs; Comment = label, Color = palette
        INDEX (-1 = none). Never the legacy Color=255/ColorTableIndex
        shape — RB7 silently doesn't render it."""
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
            Comment=label,
            Color=color_index if color_index is not None else -1,
            ContentUUID=content.UUID,
            UUID=str(uuid.uuid4()),
            rb_data_status=0,
            rb_local_data_status=0,
            rb_local_deleted=0,
            rb_local_synced=0,
        )

    # -- beatgrid --------------------------------------------------------

    def export_beatgrid(
        self,
        filename: str,
        tempo_changes: list,  # TempoChangeValue-shaped (manadj frame)
        end_s: float | None = None,
    ) -> dict:
        """Author the RB grid (ANLZ PQTZ) from the Library's tempo
        changes and write the DjmdContent.BPM scalar (dominant BPM,
        ADR 0016 projection). Positions offset into RB's frame."""
        from backend.beatgrid_utils import dominant_bpm
        from backend.sync_status.models import TempoChangeValue

        from rekordbox.anlz_grid import generate_beats, read_pqtz, write_pqtz
        from rekordbox.decode_offset import export_offset_ms

        ensure_rekordbox_closed()
        content = self._content_for(filename)
        dat_path = self._dat_path(content)
        offset_s = export_offset_ms(content.FolderPath) / 1000.0
        shifted = [
            TempoChangeValue(
                start_time=tc.start_time + offset_s,
                bpm=tc.bpm,
                bar_position=tc.bar_position,
            )
            for tc in tempo_changes
        ]
        if end_s is None:
            # fall back to the DB track length first; the current grid's
            # extent only as a last resort (a previously truncated grid
            # would otherwise feed back its own truncation — live-fire
            # lesson). Extent = last BEAT time, never a segment start.
            from rekordbox.anlz_grid import pqtz_extent_s

            end_s = float(content.Length or 0) or pqtz_extent_s(dat_path) or 0
            if not end_s:
                raise ValueError("cannot determine track end for grid generation")
        beats = generate_beats(shifted, end_s + offset_s)
        if not beats:
            raise ValueError("generated an empty grid")

        snapshot_library(self._db_dir)
        count = write_pqtz(dat_path, beats)
        duration = end_s - tempo_changes[0].start_time
        bpm = dominant_bpm(
            [{"start_time": tc.start_time, "bpm": tc.bpm} for tc in tempo_changes],
            duration if duration > 0 else None,
        )
        content.BPM = int(round(bpm * 100))
        self._db.commit(autoinc=True)
        logger.info("exported beatgrid -> rekordbox %s (%d beats)", filename, count)
        return {"beats": count, "tempo_changes": len(tempo_changes), "bpm": bpm}

    def _dat_path(self, content) -> Path:
        if not content.AnalysisDataPath:
            raise TrackNotInRekordboxError(
                f"{Path(content.FolderPath or '').name}: no ANLZ analysis in Rekordbox"
            )
        return self._db_dir / "share" / content.AnalysisDataPath.lstrip("/\\")

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


@dataclass(frozen=True)
class CueRefresh:
    """Label/color convergence on a row that stays in place (or moves):
    replace-all owns the whole mirror, decoration included."""

    row_id: str
    label: str | None
    color_index: int | None


@dataclass
class HotcueExportPlan:
    adds: list[CueAdd] = field(default_factory=list)
    moves: list[CueMove] = field(default_factory=list)
    soft_deletes: list[str] = field(default_factory=list)
    refreshes: list[CueRefresh] = field(default_factory=list)  # replace-all deco
    skipped_slots: list[int] = field(default_factory=list)  # add-only: left alone

    @property
    def empty(self) -> bool:
        return not (self.adds or self.moves or self.soft_deletes or self.refreshes)


def plan_hotcue_export(
    desired: dict[int, int],  # slot -> rb_ms (already offset-applied)
    hot_rows: list,  # DjmdCue-shaped: .ID .Kind .InMsec (.Comment .Color)
    memory_rows: list,  # DjmdCue-shaped, Kind == 0
    mode: str,  # "add-only" | "replace-all"
    deco: dict[int, tuple[str | None, int | None]] | None = None,  # slot -> (label, color idx)
) -> HotcueExportPlan:
    """Reconcile the RB cue mirror against the desired manadj cue set.

    add-only: new slots only — existing RB rows are never touched (the
    unconfirmed tier). replace-all: full reconcile (confirmed) — moved
    slots update both mirror rows, RB-only hot cues and stray memory
    cues are soft-deleted (rb_local_deleted, spike-verified).
    """
    from rekordbox.cue_mapping import KIND_TO_SLOT

    plan = HotcueExportPlan()
    hot_by_slot = {KIND_TO_SLOT.get(r.Kind, r.Kind): r for r in hot_rows}
    memory_by_ms: dict[int, list] = {}
    for r in memory_rows:
        memory_by_ms.setdefault(r.InMsec, []).append(r)

    def claim_twin(ms: int):
        """The memory row already sitting at ms, consumed — or None."""
        rows = memory_by_ms.get(ms)
        return rows.pop() if rows else None

    def want_deco(slot: int):
        return (deco or {}).get(slot, (None, None))

    def refresh_if_stale(row, slot: int) -> None:
        if mode != "replace-all" or row is None:
            return
        label, color_idx = want_deco(slot)
        color_idx = color_idx if color_idx is not None else -1
        if (row.Comment or None) != label or (row.Color if row.Color is not None else -1) != color_idx:
            plan.refreshes.append(
                CueRefresh(row_id=row.ID, label=label, color_index=color_idx)
            )

    for slot in sorted(desired):
        ms = desired[slot]
        existing = hot_by_slot.pop(slot, None)
        if existing is None:
            plan.adds.append(
                CueAdd(slot=slot, rb_ms=ms, memory_twin=claim_twin(ms) is None)
            )
        elif mode == "add-only":
            plan.skipped_slots.append(slot)
            claim_twin(existing.InMsec)  # its twin stays too (deco untouched)
        elif existing.InMsec != ms:
            plan.moves.append(CueMove(row_id=existing.ID, rb_ms=ms))
            refresh_if_stale(existing, slot)
            # move the twin with it, or create one at the new position
            old_twins = memory_by_ms.get(existing.InMsec)
            if old_twins:
                twin = old_twins.pop()
                plan.moves.append(CueMove(row_id=twin.ID, rb_ms=ms))
                refresh_if_stale(twin, slot)
            else:
                twin = claim_twin(ms)
                if twin is None:
                    plan.adds.append(CueAdd(slot=0, rb_ms=ms, memory_twin=False))
                else:
                    refresh_if_stale(twin, slot)
        else:
            # in place — replace-all still owns decoration, and HEALS a
            # missing twin (the mirror invariant is the confirm tier's point)
            refresh_if_stale(existing, slot)
            twin = claim_twin(ms)
            if twin is None and mode == "replace-all":
                plan.adds.append(CueAdd(slot=0, rb_ms=ms, memory_twin=False))
            else:
                refresh_if_stale(twin, slot)

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
