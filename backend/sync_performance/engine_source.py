"""Reading Engine DJ performance data as Library-shaped values.

Engine stores positions in samples at the blob's own rate; this module is
where samples become seconds and Engine slots (0-7) become manadj slots
(1-8). Decode failures degrade to None ("this surface doesn't carry the
field for this track"), never to an exception — one corrupt blob must not
take down a whole status computation.
"""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from enginedj.performance_blobs import BlobParseError, parse_beat_data, parse_quick_cues

from backend.sync_status.models import HotCueValue

if TYPE_CHECKING:
    from backend.sync_common.matching import TrackIndex
    from enginedj.connection import EngineDJDatabase

logger = logging.getLogger(__name__)


def hotcues_from_performance_blobs(
    beat_blob: bytes | None, cues_blob: bytes | None
) -> list[HotCueValue] | None:
    """Decode Engine hot cues into Library-shaped values (seconds, slots 1-8).

    Returns None when the track carries no usable cue data: the quickCues
    blob is missing, or the beatData blob (the only place the sample rate
    lives) is missing or unparseable.
    """
    if beat_blob is None or cues_blob is None:
        return None
    try:
        sample_rate = parse_beat_data(beat_blob).sample_rate
        quick_cues = parse_quick_cues(cues_blob)
    except BlobParseError as e:
        logger.warning("sync_performance: unparseable Engine blob skipped: %s", e)
        return None

    return [
        HotCueValue(
            slot=c.slot + 1,  # Engine 0-7 -> manadj 1-8
            time=c.sample_offset / sample_rate,
            label=c.label or None,
            color=c.color_hex,
        )
        for c in quick_cues.hot_cues
        if c.sample_offset >= 0
    ]


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

    def hotcues_for(self, filename: str) -> list[HotCueValue] | None:
        """Engine's hot cues for the manadj track at `filename`, or None when
        the track isn't matched in Engine or carries no usable cue data."""
        entry = self._load().match(filename)
        if entry is None:
            return None
        return hotcues_from_performance_blobs(entry.beat_blob, entry.cues_blob)
