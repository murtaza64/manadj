"""Rekordbox sync utilities."""

from pathlib import Path
from typing import Any

from backend.models import Track as ManAdjTrack


def index_rekordbox_tracks(
    rb_contents: list[Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Index Rekordbox tracks by path and filename for fast lookup.

    Args:
        rb_contents: List of DjmdContent (Rekordbox tracks)

    Returns:
        Tuple of (tracks_by_path, tracks_by_filename)
    """
    tracks_by_path = {c.FolderPath: c for c in rb_contents if c.FolderPath}
    tracks_by_filename = {Path(c.FolderPath or "").name: c for c in rb_contents if c.FolderPath}
    return tracks_by_path, tracks_by_filename


def match_track_rekordbox(
    manadj_track: ManAdjTrack,
    rb_tracks_by_path: dict[str, Any],
    rb_tracks_by_filename: dict[str, Any]
) -> Any | None:
    """
    Match a manadj track to a Rekordbox track using two-tier matching.

    Priority:
    1. Full path match (FolderPath)
    2. Filename-only match

    Args:
        manadj_track: manadj track to match
        rb_tracks_by_path: Rekordbox tracks indexed by full path
        rb_tracks_by_filename: Rekordbox tracks indexed by filename only

    Returns:
        Matching DjmdContent or None
    """
    # Priority 1: Full path match
    if manadj_track.filename in rb_tracks_by_path:
        return rb_tracks_by_path[manadj_track.filename]

    # Priority 2: Filename-only match
    filename = Path(manadj_track.filename).name
    if filename in rb_tracks_by_filename:
        return rb_tracks_by_filename[filename]

    return None


def find_missing_tracks_in_rekordbox(
    manadj_session,
    rb_db: Any,  # Rekordbox6Database
    validate_paths: bool = True
) -> tuple[list[ManAdjTrack], dict[str, int]]:
    """
    Find tracks that exist in manadj but not in Rekordbox.

    Args:
        manadj_session: manadj database session
        rb_db: Rekordbox6Database instance
        validate_paths: Whether to validate file paths exist

    Returns:
        Tuple of (missing tracks, stats dict)
        Stats dict keys: 'manadj_tracks', 'rekordbox_tracks',
                        'missing_count', 'skipped_file_not_found'
    """
    # Get all tracks
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    rb_contents = list(rb_db.get_content())

    # Index Rekordbox tracks
    rb_tracks_by_path, rb_tracks_by_filename = index_rekordbox_tracks(rb_contents)

    # Find missing tracks
    missing = []
    skipped_file_not_found = 0

    for track in manadj_tracks:
        matched = match_track_rekordbox(track, rb_tracks_by_path, rb_tracks_by_filename)
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
        'rekordbox_tracks': len(rb_contents),
        'missing_count': len(missing),
        'skipped_file_not_found': skipped_file_not_found
    }

    return missing, stats


def find_missing_tracks_in_manadj_from_rekordbox(
    manadj_session,
    rb_db: Any  # Rekordbox6Database
) -> tuple[list[Any], dict[str, int]]:
    """
    Find tracks that exist in Rekordbox but not in manadj.

    Args:
        manadj_session: manadj database session
        rb_db: Rekordbox6Database instance

    Returns:
        Tuple of (missing DjmdContent tracks, stats dict)
        Stats dict keys: 'missing_count'
    """
    # Get all tracks
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    rb_contents = list(rb_db.get_content())

    # Index manadj tracks
    manadj_tracks_by_path = {t.filename: t for t in manadj_tracks}
    manadj_tracks_by_filename = {Path(t.filename).name: t for t in manadj_tracks}

    # Find missing tracks
    missing = []
    for rb_track in rb_contents:
        if not rb_track.FolderPath:
            continue

        # Try full path match
        if rb_track.FolderPath in manadj_tracks_by_path:
            continue

        # Try filename match
        filename = Path(rb_track.FolderPath).name
        if filename in manadj_tracks_by_filename:
            continue

        missing.append(rb_track)

    stats = {
        'missing_count': len(missing)
    }

    return missing, stats


def manadj_track_to_rekordbox_fields(track: ManAdjTrack) -> dict:
    """
    Convert manadj Track to minimal Rekordbox DjmdContent fields.

    SIMPLIFIED: Only returns path and title to avoid foreign key complexity.
    Fields like Artist, Album, Genre, Key require foreign key relationships
    to other tables. Rekordbox can populate these via "Reload Tag" feature.

    Args:
        track: manadj Track to convert

    Returns:
        dict with keys: FolderPath, Title
    """
    file_path = Path(track.filename)

    return {
        'FolderPath': str(file_path.absolute()),
        'Title': track.title or file_path.stem,
        # NOTE: Omitting Artist, BPM, Key to avoid foreign key complexity
        # User can use Rekordbox's "Reload Tag" to populate from file metadata
    }
