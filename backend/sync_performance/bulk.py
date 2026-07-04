"""The bulk "import performance data from Engine" operation (PRD).

Two tiers, no silent overwrites:
- automatic (fill-empty): hot cues where the Library has none, a grid where
  the Library's is absent or a generated placeholder, a main cue where the
  Library's is unset, a key where the Library's is empty
- confirm: every overwrite of saved info is returned as a pending item and
  only applied when explicitly listed in `overwrites` on a follow-up call
"""

from dataclasses import dataclass
from typing import Literal, Protocol, Sequence

from sqlalchemy.orm import Session, joinedload

from backend import models
from backend.sync_status.compare import (
    beatgrid_value_from_row,
    beatgrids_equal,
    hotcue_sets_equal,
    hotcue_values_from_rows,
    maincues_equal,
)

from .apply import import_beatgrid, import_hotcues, import_maincue
from .engine_source import EnginePerformanceFields

BulkField = Literal["hotcues", "beatgrid", "maincue", "key"]


class PerformanceSource(Protocol):
    def fields_for(self, filename: str) -> EnginePerformanceFields | None: ...


@dataclass(frozen=True)
class OverwriteInstruction:
    """Explicit authorization to overwrite saved info on one track × field.
    `mode` matters only for hotcues (fill-empty = merge into free slots,
    replace-all = take Engine's set wholesale)."""

    track_id: int
    field: BulkField
    mode: str | None = None


@dataclass
class PendingItem:
    track_id: int
    title: str | None
    artist: str | None
    field: BulkField
    detail: str
    variable: bool | None = None  # beatgrid only: > 1 tempo change


@dataclass
class BulkResult:
    scanned: int
    matched: int
    applied: dict[str, int]
    pending: list[PendingItem]
    # Engine main cues that couldn't land because the track has no waveform
    # row yet (the cue's persistence home) — reported, never silently dropped
    maincue_no_waveform: int = 0


def _fmt_time(seconds: float) -> str:
    m = int(seconds // 60)
    return f"{m}:{seconds - m * 60:04.1f}"


def bulk_import(
    db: Session,
    source: PerformanceSource,
    track_ids: list[int] | None,
    overwrites: Sequence[OverwriteInstruction] = (),
) -> BulkResult:
    query = db.query(models.Track).options(
        joinedload(models.Track.hotcues), joinedload(models.Track.beatgrid)
    )
    if track_ids is not None:
        query = query.filter(models.Track.id.in_(track_ids))
    tracks = query.all()

    # Main cues live on the Track itself (waveform-overhaul issue 06).
    authorized = {(o.track_id, o.field): o.mode for o in overwrites}

    applied = {"hotcues": 0, "beatgrid": 0, "maincue": 0, "key": 0}
    pending: list[PendingItem] = []
    scanned = matched = 0
    maincue_no_waveform = 0

    for track in tracks:
        scanned += 1
        engine = source.fields_for(track.filename)
        if engine is None:
            continue
        matched += 1

        def pend(field: BulkField, detail: str, variable: bool | None = None) -> None:
            pending.append(
                PendingItem(
                    track_id=track.id,
                    title=track.title,
                    artist=track.artist,
                    field=field,
                    detail=detail,
                    variable=variable,
                )
            )

        # ---- hot cues (whole-set semantics)
        if engine.hotcues:
            lib_cues = hotcue_values_from_rows(track.hotcues)
            if not lib_cues:
                import_hotcues(db, track.id, engine.hotcues, "fill-empty")
                applied["hotcues"] += 1
            elif not hotcue_sets_equal(lib_cues, engine.hotcues):
                if (track.id, "hotcues") in authorized:
                    mode = authorized[(track.id, "hotcues")] or "replace-all"
                    import_hotcues(db, track.id, engine.hotcues, mode)
                    applied["hotcues"] += 1
                else:
                    pend(
                        "hotcues",
                        f"{len(lib_cues)} saved in Library vs {len(engine.hotcues)} in Engine",
                    )

        # ---- beatgrid (placeholder counts as absent)
        if engine.beatgrid is not None:
            n = len(engine.beatgrid.tempo_changes)
            variable = n > 1
            grid_detail = (
                f"variable grid — {n} tempo changes" if variable
                else f"{engine.beatgrid.tempo_changes[0].bpm:.2f} BPM grid"
            )
            lib_grid = beatgrid_value_from_row(track.beatgrid)
            if lib_grid is None:
                import_beatgrid(db, track.id, engine.beatgrid, "fill-empty")
                applied["beatgrid"] += 1
            elif not beatgrids_equal(lib_grid, engine.beatgrid):
                if (track.id, "beatgrid") in authorized:
                    import_beatgrid(db, track.id, engine.beatgrid, "replace")
                    applied["beatgrid"] += 1
                else:
                    pend("beatgrid", f"saved grid vs Engine's {grid_detail}", variable)

        # ---- main cue (Engine overridden-only, enforced at the source)
        # maincue_no_waveform is retained in the report shape but can no
        # longer occur: the cue lives on the Track, which always exists.
        if engine.maincue is not None:
            lib_cue = track.cue_point_time
            if lib_cue is None:
                import_maincue(db, track.id, engine.maincue, "fill-empty")
                applied["maincue"] += 1
            elif not maincues_equal(lib_cue, engine.maincue):
                if (track.id, "maincue") in authorized:
                    import_maincue(db, track.id, engine.maincue, "replace")
                    applied["maincue"] += 1
                else:
                    pend(
                        "maincue",
                        f"saved {_fmt_time(lib_cue)} vs Engine {_fmt_time(engine.maincue)}",
                    )

        # ---- key (bundled per PRD; stays an ordinary Track attribute)
        if engine.key is not None:
            if track.key is None:
                track.key = engine.key
                applied["key"] += 1
            elif track.key != engine.key:
                if (track.id, "key") in authorized:
                    track.key = engine.key
                    applied["key"] += 1
                else:
                    pend("key", f"saved key {track.key} vs Engine {engine.key}")

    db.commit()
    return BulkResult(
        scanned=scanned,
        matched=matched,
        applied=applied,
        pending=pending,
        maincue_no_waveform=maincue_no_waveform,
    )
