"""Read-only playlist coverage across libraries.

Unlike the name-keyed unified view, this keeps every playlist a source holds
(same-name playlists are NOT collapsed, folder path stays in the name) and says
per source whether it was actually read: ``read``, ``not_configured`` or
``failed``. Absence means something only for a source that was ``read``.
"""

from collections.abc import Callable
from datetime import datetime, timezone

from .models import PlaylistInfo

SOURCES = ("manadj", "engine", "rekordbox")


def _entry(p: PlaylistInfo) -> dict:
    return {
        "id": str(p.source_id),
        "skipped": p.skipped_tracks,
        "tracks": [{"filename": t.filename, "track_id": t.track_id} for t in p.tracks],
    }


def build_coverage(
    readers: dict[str, Callable[[], list[PlaylistInfo]] | None],
    now: datetime | None = None,
) -> dict:
    """readers: source -> callable returning its playlists, or None if not configured.

    A reader that raises is reported as ``failed`` with a short class-name reason
    (never a raw path or message); its playlists are not guessed.
    """
    read_at = (now or datetime.now(timezone.utc)).isoformat()
    sources: dict[str, dict] = {}
    by_name: dict[tuple, dict] = {}
    for src in SOURCES:
        reader = readers.get(src)
        if reader is None:
            sources[src] = {"status": "not_configured", "reason": None, "read_at": read_at, "playlist_count": 0}
            continue
        try:
            playlists = reader()
        except Exception as exc:  # noqa: BLE001 - surfaced as a failed read, not hidden
            sources[src] = {"status": "failed", "reason": type(exc).__name__, "read_at": read_at, "playlist_count": 0}
            continue
        sources[src] = {"status": "read", "reason": None, "read_at": read_at, "playlist_count": len(playlists)}  # raw count, folders included
        for p in playlists:
            # Only a container the source itself marks as a folder is dropped. A
            # source with no type (None) keeps the row: never guessed from names.
            if p.is_folder is True:
                continue
            parts = list(p.path_parts) if p.path_parts else [p.name]
            slot = by_name.setdefault(tuple(parts), {"name": " > ".join(parts), "path": parts, "entries": {s: [] for s in SOURCES}})
            slot["entries"][src].append(_entry(p))
    return {"sources": sources, "playlists": sorted(by_name.values(), key=lambda x: [q.lower() for q in x["path"]])}
