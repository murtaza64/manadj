"""Engine DJ sync helpers: path getter + missing-track diffs.

Matching semantics live in backend.sync_common.matching (the single home of
Match); this module only contributes the Engine-specific path getter and the
session-aware diff wrappers.
"""

from pathlib import Path
from typing import Any

from backend.models import Track as ManAdjTrack
from backend.sync_common.matching import TrackIndex, find_unmatched
from enginedj.models.track import Track as EDJTrack


def edj_path(track: EDJTrack) -> str | None:
    """The path an Engine DJ track row is identified by."""
    return track.path


def find_missing_tracks_in_enginedj(
    manadj_session: Any,
    edj_session: Any,
    validate_paths: bool = True,
) -> tuple[list[ManAdjTrack], dict[str, int]]:
    """Tracks that exist in manadj but not in Engine DJ (Export candidates)."""
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    edj_tracks = edj_session.query(EDJTrack).all()
    edj_index: TrackIndex[EDJTrack] = TrackIndex.build(edj_tracks, edj_path)

    unmatched = find_unmatched(manadj_tracks, lambda t: t.filename, edj_index)

    missing = []
    skipped_file_not_found = 0
    for track in unmatched:
        if validate_paths and not Path(track.filename).exists():
            skipped_file_not_found += 1
            continue
        missing.append(track)

    stats = {
        "manadj_tracks": len(manadj_tracks),
        "enginedj_tracks": len(edj_tracks),
        "missing_count": len(missing),
        "skipped_file_not_found": skipped_file_not_found,
    }
    return missing, stats


def find_missing_tracks_in_manadj(
    manadj_session: Any,
    edj_session: Any,
) -> tuple[list[EDJTrack], dict[str, int]]:
    """Tracks that exist in Engine DJ but not in manadj (Import candidates)."""
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    edj_tracks = edj_session.query(EDJTrack).all()
    manadj_index: TrackIndex[ManAdjTrack] = TrackIndex.build(
        manadj_tracks, lambda t: t.filename
    )

    missing = find_unmatched(edj_tracks, edj_path, manadj_index)
    return missing, {"missing_count": len(missing)}
