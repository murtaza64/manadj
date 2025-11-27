"""Generic track matching utilities."""

from pathlib import Path
from typing import TypeVar, Generic, Callable

T = TypeVar('T')  # Generic track type


def index_tracks_by_path(
    tracks: list[T],
    path_getter: Callable[[T], str | None],
    filename_getter: Callable[[T], str | None]
) -> tuple[dict[str, T], dict[str, T]]:
    """
    Index tracks by full path and filename for fast lookup.

    This is a generic function that works with any track type.

    Args:
        tracks: List of track objects
        path_getter: Function to extract path from track
        filename_getter: Function to extract filename from track

    Returns:
        Tuple of (tracks_by_path, tracks_by_filename)
    """
    tracks_by_path = {}
    tracks_by_filename = {}

    for track in tracks:
        # Index by full path
        path = path_getter(track)
        if path:
            tracks_by_path[path] = track

        # Index by filename only
        filename = filename_getter(track)
        if filename:
            name_only = Path(filename).name
            tracks_by_filename[name_only] = track

    return tracks_by_path, tracks_by_filename


def match_track_two_tier(
    source_path: str,
    target_by_path: dict[str, T],
    target_by_filename: dict[str, T]
) -> T | None:
    """
    Match a track using two-tier matching strategy.

    Priority:
    1. Full path match
    2. Filename-only match

    Args:
        source_path: Path of track to match
        target_by_path: Target tracks indexed by full path
        target_by_filename: Target tracks indexed by filename only

    Returns:
        Matched track or None
    """
    # Priority 1: Full path match
    if source_path in target_by_path:
        return target_by_path[source_path]

    # Priority 2: Filename-only match
    filename = Path(source_path).name
    if filename in target_by_filename:
        return target_by_filename[filename]

    return None
