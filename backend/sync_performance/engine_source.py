"""Reading Engine DJ performance data as Library-shaped values.

Engine stores positions in samples at the blob's own rate; this module is
where samples become seconds, Engine slots (0-7) become manadj slots (1-8),
and Engine grid markers become tempo changes. Decode failures degrade to
None ("this surface doesn't carry the field for this track"), never to an
exception — one corrupt blob must not take down a whole status computation.
"""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from enginedj.performance_blobs import (
    BeatData,
    BlobParseError,
    parse_beat_data,
    parse_quick_cues,
)

from backend.sync_status.models import BeatgridValue, HotCueValue, TempoChangeValue

if TYPE_CHECKING:
    from backend.sync_common.matching import TrackIndex
    from enginedj.connection import EngineDJDatabase

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EnginePerformanceFields:
    """Engine's performance data for one track, in Library shapes.
    Any member may be None: that field isn't usably present there."""

    hotcues: list[HotCueValue] | None
    beatgrid: BeatgridValue | None
    maincue: float | None  # seconds; None unless Engine's overridden flag is set


def performance_fields_from_blobs(
    beat_blob: bytes | None, cues_blob: bytes | None
) -> EnginePerformanceFields | None:
    """Decode a track's Engine performance blobs into Library-shaped values.

    Returns None when nothing usable is present. The beatData blob is the
    only place the sample rate lives, so without it cue positions can't be
    converted and everything reads as absent.
    """
    if beat_blob is None:
        return None
    try:
        beat_data = parse_beat_data(beat_blob)
    except BlobParseError as e:
        logger.warning("sync_performance: unparseable Engine beatData skipped: %s", e)
        return None

    beatgrid = _grid_to_beatgrid_value(beat_data)

    hotcues: list[HotCueValue] | None = None
    maincue: float | None = None
    if cues_blob is not None:
        try:
            quick_cues = parse_quick_cues(cues_blob)
        except BlobParseError as e:
            logger.warning("sync_performance: unparseable Engine quickCues skipped: %s", e)
            quick_cues = None
        if quick_cues is not None:
            rate = beat_data.sample_rate
            hotcues = [
                HotCueValue(
                    slot=c.slot + 1,  # Engine 0-7 -> manadj 1-8
                    time=c.sample_offset / rate,
                    label=c.label or None,
                    color=c.color_hex,
                )
                for c in quick_cues.hot_cues
                if c.sample_offset >= 0
            ]
            # Only a cue the DJ actually moved counts (PRD: Engine's
            # auto-placed defaults are placeholder-grade).
            if quick_cues.main_cue_overridden and quick_cues.main_cue_samples >= 0:
                maincue = quick_cues.main_cue_samples / rate

    if hotcues is None and beatgrid is None and maincue is None:
        return None
    return EnginePerformanceFields(hotcues=hotcues, beatgrid=beatgrid, maincue=maincue)


def _grid_to_beatgrid_value(beat_data: BeatData) -> BeatgridValue | None:
    """Convert an Engine beatgrid (adjusted, falling back to default) to
    tempo changes.

    Engine markers span beat -4 to beat N+1; manadj wants tempo changes at
    non-negative times with bar positions. Beat 0 is taken as a downbeat
    (bar_position 1), matching Engine's bar convention. (Math carried over
    from the validated backfill script — 992 tracks, 0 errors.)
    """
    grid = beat_data.adjusted_grid or beat_data.default_grid
    if len(grid) < 2:
        return None

    rate = beat_data.sample_rate
    changes: list[TempoChangeValue] = []
    for a, b in zip(grid, grid[1:]):
        beats = b.beat_index - a.beat_index
        samples = b.sample_offset - a.sample_offset
        if beats <= 0 or samples <= 0:
            logger.warning("sync_performance: non-monotonic Engine grid skipped")
            return None
        bpm = rate * 60.0 * beats / samples
        spb = samples / beats  # samples per beat in this segment

        # Walk this segment's start forward to the first beat at t >= 0
        start_index = a.beat_index
        start_offset = a.sample_offset
        while start_offset < 0:
            start_offset += spb
            start_index += 1
        if start_index >= b.beat_index and b is not grid[-1]:
            continue  # segment ends before the track starts

        changes.append(
            TempoChangeValue(
                start_time=start_offset / rate,
                bpm=round(bpm, 4),
                bar_position=(start_index % 4) + 1 if start_index % 4 else 1,
            )
        )

    if not changes:
        return None
    return BeatgridValue(tempo_changes=changes)


@dataclass(frozen=True)
class _EngineEntry:
    path: str
    beat_blob: bytes | None
    cues_blob: bytes | None


class EnginePerformanceSource:
    """Per-track Engine performance data lookups, matched by file path.

    Reads all blobs once, lazily, on first lookup and matches with the
    standard TrackIndex — one instance per request for a single import,
    one shared instance for a bulk pass.
    """

    def __init__(self, engine_db: "EngineDJDatabase") -> None:
        self._db = engine_db
        self._index: "TrackIndex[_EngineEntry] | None" = None

    def _load(self) -> "TrackIndex[_EngineEntry]":
        if self._index is None:
            from sqlalchemy.orm import joinedload

            from backend.sync_common.matching import TrackIndex
            from enginedj.models.track import Track as EDJTrack
            from enginedj.sync import edj_path

            entries = []
            with self._db.session_m() as session:
                tracks = (
                    session.query(EDJTrack)
                    .options(joinedload(EDJTrack.performance_data))
                    .all()
                )
                for t in tracks:
                    path = edj_path(t)
                    if not path:
                        continue
                    perf = t.performance_data
                    entries.append(
                        _EngineEntry(
                            path=path,
                            beat_blob=perf.beatData if perf else None,
                            cues_blob=perf.quickCues if perf else None,
                        )
                    )
            self._index = TrackIndex.build(entries, lambda e: e.path)
        return self._index

    def fields_for(self, filename: str) -> EnginePerformanceFields | None:
        """Engine's performance data for the manadj track at `filename`, or
        None when the track isn't matched in Engine or nothing is usable."""
        entry = self._load().match(filename)
        if entry is None:
            return None
        return performance_fields_from_blobs(entry.beat_blob, entry.cues_blob)
