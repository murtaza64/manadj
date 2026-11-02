"""Overwrite performance data on tracks already present in Engine DJ."""

import math
import os
from itertools import pairwise
from pathlib import Path

from backend.sync_common.matching import TrackIndex
from backend.sync_status.models import TempoChangeValue
from enginedj.models.performance_data import PerformanceData
from enginedj.models.track import Track
from enginedj.performance_blobs import (
    BeatData,
    BlobParseError,
    EngineHotCue,
    GridMarker,
    QuickCues,
    encode_beat_data,
    encode_quick_cues,
    encode_track_data,
    parse_beat_data,
    parse_quick_cues,
    parse_track_data,
)
from enginedj.ratings import energy_to_rating
from enginedj.track_export import ensure_engine_closed, snapshot_database


class TrackNotInEngineError(LookupError):
    pass


DEFAULT_HOT_CUE_COLORS = (
    "#F4D338",
    "#EF8130",
    "#AA55C4",
    "#CE3239",
    "#86C64B",
    "#20C670",
    "#00A8A9",
    "#1571E2",
)


def _grid_markers(
    changes: list[TempoChangeValue], sample_rate: float, duration: float
) -> list[GridMarker]:
    first = changes[0]
    first_index = first.bar_position - 1
    first_spb = sample_rate * 60.0 / first.bpm
    markers = [
        GridMarker(
            sample_offset=first.start_time * sample_rate - 4 * first_spb,
            beat_index=first_index - 4,
            beats_to_next=4,
        )
    ]
    index = first_index
    for previous, change in pairwise(changes):
        beats = round((change.start_time - previous.start_time) * previous.bpm / 60.0)
        index += beats
        markers.append(GridMarker(change.start_time * sample_rate, index, 0))
    markers.insert(1, GridMarker(first.start_time * sample_rate, first_index, 0))
    last = changes[-1]
    end_beats = max(1, math.ceil((duration - last.start_time) * last.bpm / 60.0) + 1)
    end_index = index + end_beats
    end_time = last.start_time + end_beats * 60.0 / last.bpm
    markers.append(GridMarker(end_time * sample_rate, end_index, 0))
    for marker, following in pairwise(markers):
        marker.beats_to_next = following.beat_index - marker.beat_index
    return markers


class EnginePerfExporter:
    def __init__(self, engine_db, database_path: Path) -> None:
        self._db = engine_db
        self._database_path = Path(database_path)

    def export_performance(
        self,
        filename: str,
        *,
        cues: list[tuple[int, float, str | None, str | None]],
        tempo_changes: list[TempoChangeValue] | None,
        key: int | None,
        maincue: float | None,
        energy: int | None,
        duration: float | None,
        selected_fields: set[str] | None = None,
    ) -> dict[str, str]:
        fields = {'hotcues', 'maincue', 'beatgrid', 'key', 'energy'} if selected_fields is None else selected_fields
        if not fields <= {'hotcues', 'maincue', 'beatgrid', 'key', 'energy'}:
            raise ValueError('Unsupported performance field')
        ensure_engine_closed()
        snapshot_database(self._database_path)
        with self._db.session_m_write() as session:
            tracks = session.query(Track).all()
            library_root = self._database_path.parent
            track = TrackIndex.build(
                tracks, lambda t: os.path.abspath(library_root / t.path) if t.path else None
            ).match(filename)
            if track is None:
                raise TrackNotInEngineError(f"{Path(filename).name}: not found in Engine DJ")
            perf = session.get(PerformanceData, track.id)
            if perf is None:
                perf = PerformanceData(trackId=track.id)
                if fields & {'hotcues', 'maincue', 'beatgrid'}:
                    session.add(perf)

            beat_data = parse_beat_data(perf.beatData) if perf.beatData and fields & {'hotcues', 'maincue', 'beatgrid'} else None
            sample_rate = beat_data.sample_rate if beat_data else None
            result: dict[str, str] = {}

            if sample_rate is None:
                for field in fields & {'hotcues', 'maincue'}:
                    result[field] = "skipped: Engine track has no analyzed sample rate"
            elif fields & {'hotcues', 'maincue'}:
                existing = (
                    parse_quick_cues(perf.quickCues)
                    if perf.quickCues
                    else QuickCues([], -1.0, False, 0.0)
                )
                hot_cues = [
                    EngineHotCue(
                        slot=slot - 1,
                        label=label or "",
                        sample_offset=seconds * sample_rate,
                        color_hex=color or DEFAULT_HOT_CUE_COLORS[slot - 1],
                    )
                    for slot, seconds, label, color in cues
                ]
                perf.quickCues = encode_quick_cues(
                    QuickCues(
                        hot_cues=hot_cues if 'hotcues' in fields else existing.hot_cues,
                        main_cue_samples=(maincue * sample_rate if maincue is not None else -1.0) if 'maincue' in fields else existing.main_cue_samples,
                        main_cue_overridden=(maincue is not None) if 'maincue' in fields else existing.main_cue_overridden,
                        default_cue_samples=existing.default_cue_samples,
                        slot_count=max(8, existing.slot_count),
                    )
                )
                if 'hotcues' in fields:
                    result["hotcues"] = "exported"
                if 'maincue' in fields:
                    result["maincue"] = "exported" if maincue is not None else "exported: cleared"

            if 'beatgrid' not in fields:
                pass
            elif beat_data is None or not tempo_changes or not duration:
                result["beatgrid"] = "skipped: Library has no saved grid or Engine sample rate"
            else:
                markers = _grid_markers(tempo_changes, beat_data.sample_rate, duration)
                perf.beatData = encode_beat_data(
                    BeatData(
                        sample_rate=beat_data.sample_rate,
                        track_length_samples=duration * beat_data.sample_rate,
                        default_grid=markers,
                        adjusted_grid=markers,
                        is_set=True,
                        tail=beat_data.tail or b"\0" * 9,
                    )
                )
                result["beatgrid"] = "exported"

            if 'key' not in fields:
                pass
            elif key is None:
                result["key"] = "skipped: Library has no key"
            else:
                track.key = key
                if perf.trackData:
                    try:
                        track_data = parse_track_data(perf.trackData)
                    except BlobParseError:
                        track_data = None
                    if track_data is not None:
                        track_data.key = key
                        perf.trackData = encode_track_data(track_data)
                result["key"] = "exported"

            if 'energy' not in fields:
                pass
            elif energy is None:
                result["energy"] = "skipped: Library has no energy"
            else:
                track.rating = energy_to_rating(energy)
                result["energy"] = "exported"
            # Writing selected fields or a full playlist is not audio analysis.
            # New destination rows must remain unanalyzed until Engine analyzes.
            return result
