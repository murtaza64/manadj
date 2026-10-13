"""Reading Rekordbox performance data as Library-shaped values.

The Rekordbox counterpart of engine_source.py, built for the onboarding
import (#274): djmdCue rows become hot cues (pads A-H -> slots 1-8) and a
Main cue, ANLZ PQTZ grids become beatgrids, and djmdKey.ScaleName becomes
the canonical Engine key ID. All positions pass through the per-container
decode-offset correction (rekordbox/decode_offset.py).

Matching is by exact FolderPath == Track.filename: onboarding creates
tracks from FolderPath, so the mapping is total for imported tracks.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from backend.key import Key
from backend.sync_status.adapters import (
    _rb_key_name,
    rb_beatgrid,
    rb_hotcues_from_cue_rows,
)

from .engine_source import EnginePerformanceFields

if TYPE_CHECKING:
    from pyrekordbox.db6 import Rekordbox6Database


def is_loop_row(cue) -> bool:
    """Saved-loop djmdCue rows carry a real OutMsec (non-loops write -1).
    Loops have no manadj model yet — the import drops and counts them."""
    out = getattr(cue, "OutMsec", None)
    return out is not None and out > 0


def standalone_memory_ms(cue_rows: list) -> list[int]:
    """Memory-cue positions that are NOT mirror twins of a hot cue.

    In manadj-exported libraries every hot cue has a memory twin at the
    same millisecond (perf_export mirroring model); those twins represent
    the hot cue, not a memory cue the DJ placed. The first *standalone*
    memory cue is what becomes the Main cue.
    """
    from rekordbox.cue_mapping import (
        HOT_CUE_KINDS,
        LEGACY_MEMORY_KIND,
        MEMORY_KIND,
    )

    rows = [c for c in cue_rows if not is_loop_row(c)]
    hot_ms = {c.InMsec for c in rows if c.Kind in HOT_CUE_KINDS}
    return sorted(
        c.InMsec
        for c in rows
        if c.Kind in (MEMORY_KIND, LEGACY_MEMORY_KIND) and c.InMsec not in hot_ms
    )


@dataclass(frozen=True)
class _RBEntry:
    content: object  # DjmdContent (detached row from the snapshot session)
    cue_rows: list


class RekordboxPerformanceSource:
    """Per-track Rekordbox performance data, matched by exact file path.

    Reads all content + cue rows once, lazily, on first lookup — one
    instance per bulk import pass over a snapshot DB.
    """

    def __init__(self, rb_db: "Rekordbox6Database") -> None:
        self._db = rb_db
        self._by_path: dict[str, _RBEntry] | None = None

    def _load(self) -> dict[str, _RBEntry]:
        if self._by_path is None:
            from pyrekordbox.db6.tables import DjmdContent, DjmdCue

            session = self._db.session
            cues_by_content: dict[str, list] = {}
            for cue in session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0):
                cues_by_content.setdefault(cue.ContentID, []).append(cue)
            self._by_path = {}
            for c in session.query(DjmdContent).filter(
                DjmdContent.rb_local_deleted == 0
            ):
                if c.FolderPath:
                    self._by_path[c.FolderPath] = _RBEntry(
                        content=c, cue_rows=cues_by_content.get(c.ID, [])
                    )
        return self._by_path

    def fields_for(self, filename: str) -> EnginePerformanceFields | None:
        entry = self._load().get(filename)
        if entry is None:
            return None
        c = entry.content
        rows = [r for r in entry.cue_rows if not is_loop_row(r)]
        hotcues, _mirror_ok = rb_hotcues_from_cue_rows(rows, c.FolderPath)

        maincue: float | None = None
        memory_ms = standalone_memory_ms(entry.cue_rows)
        if memory_ms:
            from rekordbox.decode_offset import rb_ms_to_manadj_seconds

            maincue = rb_ms_to_manadj_seconds(memory_ms[0], c.FolderPath)

        beatgrid = rb_beatgrid(c, Path(self._db._db_dir))

        key_obj = Key.from_musical(_rb_key_name(c))
        key = key_obj.engine_id if key_obj else None

        if not hotcues and beatgrid is None and maincue is None and key is None:
            return None
        return EnginePerformanceFields(
            hotcues=hotcues or None, beatgrid=beatgrid, maincue=maincue, key=key
        )
