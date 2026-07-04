"""Rekordbox sync helpers: path getter + missing-track diffs.

Matching semantics live in backend.sync_common.matching (the single home of
Match); this module only contributes the Rekordbox-specific path getter and
the diff wrappers.
"""

from pathlib import Path
from typing import Any

from backend.models import Track as ManAdjTrack
from backend.sync_common.matching import TrackIndex, find_unmatched


def rb_path(content: Any) -> str | None:
    """The path a Rekordbox DjmdContent row is identified by."""
    return content.FolderPath


def find_missing_tracks_in_rekordbox(
    manadj_session: Any,
    rb_db: Any,  # Rekordbox6Database
    validate_paths: bool = True,
) -> tuple[list[ManAdjTrack], dict[str, int]]:
    """Tracks that exist in manadj but not in Rekordbox (Export candidates).

    Archived Tracks are never Export candidates (CONTEXT.md: Archived).
    """
    manadj_tracks = (
        manadj_session.query(ManAdjTrack).filter(ManAdjTrack.archived_at.is_(None)).all()
    )
    rb_contents = list(rb_db.get_content())
    rb_index: TrackIndex[Any] = TrackIndex.build(rb_contents, rb_path)

    unmatched = find_unmatched(manadj_tracks, lambda t: t.filename, rb_index)

    missing = []
    skipped_file_not_found = 0
    for track in unmatched:
        if validate_paths and not Path(track.filename).exists():
            skipped_file_not_found += 1
            continue
        missing.append(track)

    stats = {
        "manadj_tracks": len(manadj_tracks),
        "rekordbox_tracks": len(rb_contents),
        "missing_count": len(missing),
        "skipped_file_not_found": skipped_file_not_found,
    }
    return missing, stats


def find_missing_tracks_in_manadj_from_rekordbox(
    manadj_session: Any,
    rb_db: Any,  # Rekordbox6Database
) -> tuple[list[Any], dict[str, int]]:
    """Tracks that exist in Rekordbox but not in manadj (Import candidates).

    Rows without a FolderPath are skipped, not reported missing — there is
    nothing to import from them.
    """
    manadj_tracks = manadj_session.query(ManAdjTrack).all()
    rb_contents = [c for c in rb_db.get_content() if c.FolderPath]
    manadj_index: TrackIndex[ManAdjTrack] = TrackIndex.build(
        manadj_tracks, lambda t: t.filename
    )

    missing = find_unmatched(rb_contents, rb_path, manadj_index)
    return missing, {"missing_count": len(missing)}


def manadj_track_to_rekordbox_fields(track: ManAdjTrack) -> dict:
    """
    Convert manadj Track to minimal Rekordbox DjmdContent fields.

    SIMPLIFIED: Only returns path and title to avoid foreign key complexity.
    Fields like Artist, Album, Genre, Key require foreign key relationships
    to other tables. Rekordbox can populate these via "Reload Tag" feature.
    """
    file_path = Path(track.filename)
    return {
        "FolderPath": str(file_path.absolute()),
        "Title": track.title or file_path.stem,
        # NOTE: Omitting Artist, BPM, Key to avoid foreign key complexity
        # User can use Rekordbox's "Reload Tag" to populate from file metadata
    }
