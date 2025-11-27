"""Engine DJ sync utilities."""

from pathlib import Path

from backend.models import Track as ManAdjTrack
from enginedj.models.track import Track as EDJTrack


def index_engine_tracks(
    edj_tracks: list[EDJTrack]
) -> tuple[dict[str, EDJTrack], dict[str, EDJTrack]]:
    """
    Index Engine DJ tracks by path and filename for fast lookup.

    Args:
        edj_tracks: List of Engine DJ tracks

    Returns:
        Tuple of (tracks_by_path, tracks_by_filename)
    """
    tracks_by_path = {t.path: t for t in edj_tracks if t.path}
    tracks_by_filename = {Path(t.filename).name: t for t in edj_tracks if t.filename}
    return tracks_by_path, tracks_by_filename


def match_track(
    manadj_track: ManAdjTrack,
    edj_tracks_by_path: dict[str, EDJTrack],
    edj_tracks_by_filename: dict[str, EDJTrack]
) -> EDJTrack | None:
    """
    Match a manadj track to an Engine DJ track using two-tier matching.

    Priority:
    1. Full path match
    2. Filename-only match

    Args:
        manadj_track: manadj track to match
        edj_tracks_by_path: Engine DJ tracks indexed by full path
        edj_tracks_by_filename: Engine DJ tracks indexed by filename only

    Returns:
        Matching Engine DJ track or None
    """
    # Priority 1: Full path match
    if manadj_track.filename in edj_tracks_by_path:
        return edj_tracks_by_path[manadj_track.filename]

    # Priority 2: Filename-only match
    filename = Path(manadj_track.filename).name
    if filename in edj_tracks_by_filename:
        return edj_tracks_by_filename[filename]

    return None


def find_missing_tracks_in_enginedj(
    manadj_session,
    edj_session,
    validate_paths: bool = True
) -> tuple[list[ManAdjTrack], dict[str, int]]:
    """
    Find tracks that exist in manadj but not in Engine DJ.

    Args:
        manadj_session: manadj database session
        edj_session: Engine DJ database session
        validate_paths: Whether to validate file paths exist

    Returns:
        Tuple of (missing tracks, stats dict)
        Stats dict keys: 'manadj_tracks', 'enginedj_tracks',
                        'missing_count', 'skipped_file_not_found'
    """
    # Get all tracks
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    edj_tracks = edj_session.query(EDJTrack).all()

    # Index Engine DJ tracks
    edj_tracks_by_path, edj_tracks_by_filename = index_engine_tracks(edj_tracks)

    # Find missing tracks
    missing = []
    skipped_file_not_found = 0

    for track in manadj_tracks:
        matched = match_track(track, edj_tracks_by_path, edj_tracks_by_filename)
        if not matched:
            # Validate file exists if requested
            if validate_paths:
                path = Path(track.filename)
                if not path.exists():
                    skipped_file_not_found += 1
                    continue
            missing.append(track)

    stats = {
        'manadj_tracks': len(manadj_tracks),
        'enginedj_tracks': len(edj_tracks),
        'missing_count': len(missing),
        'skipped_file_not_found': skipped_file_not_found
    }

    return missing, stats


def find_missing_tracks_in_manadj(
    manadj_session,
    edj_session
) -> tuple[list[EDJTrack], dict[str, int]]:
    """
    Find tracks that exist in Engine DJ but not in manadj.

    Args:
        manadj_session: manadj database session
        edj_session: Engine DJ database session

    Returns:
        Tuple of (missing tracks, stats dict)
        Stats dict keys: 'missing_count'
    """
    # Get all tracks
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    edj_tracks = edj_session.query(EDJTrack).all()

    # Index manadj tracks
    manadj_tracks_by_path = {t.filename: t for t in manadj_tracks}
    manadj_tracks_by_filename = {Path(t.filename).name: t for t in manadj_tracks}

    # Find missing tracks
    missing = []
    for edj_track in edj_tracks:
        # Try full path match
        if edj_track.path and edj_track.path in manadj_tracks_by_path:
            continue

        # Try filename match
        if edj_track.filename:
            filename = Path(edj_track.filename).name
            if filename in manadj_tracks_by_filename:
                continue

        missing.append(edj_track)

    stats = {
        'missing_count': len(missing)
    }

    return missing, stats
