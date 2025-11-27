"""Format conversions and track preview utilities."""

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.models import Track as ManAdjTrack
    from enginedj.models.track import Track as EDJTrack


def format_track_preview(track, source: str = "manadj") -> str:
    """
    Format track info for CLI preview display.

    Args:
        track: Track to format (manadj or Engine DJ)
        source: Source of the track ("manadj" or "enginedj")

    Returns:
        Formatted track preview string
    """
    # Import here to avoid circular dependencies
    from backend.models import Track as ManAdjTrack
    from backend.key import Key

    if isinstance(track, ManAdjTrack):
        bpm_str = f"{track.bpm / 100.0:.1f} BPM" if track.bpm else "? BPM"
        key_str = "?"
        if track.key is not None:
            key_obj = Key.from_engine_id(track.key)
            key_str = str(key_obj) if key_obj else "?"
        title = track.title or Path(track.filename).stem
        artist = track.artist or "Unknown"
        path = track.filename
    else:  # Assume EDJTrack or similar
        bpm_str = f"{track.bpm} BPM" if track.bpm else "? BPM"
        key_str = str(track.key) if track.key is not None else "?"
        title = track.title or Path(track.filename or "").stem if hasattr(track, 'filename') else ""
        artist = track.artist or "Unknown" if hasattr(track, 'artist') else "Unknown"
        path = track.path if hasattr(track, 'path') else (track.filename if hasattr(track, 'filename') else "?")

    return f"{title} - {artist} ({bpm_str}, Key {key_str}) [{path}]"
