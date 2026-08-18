"""Playlist name matching logic.

Match — bucketing items across sources by a key — is single-homed in
``backend.sync_common.matching.match_by_key``. Playlists match on name
(case-sensitive), so this is a thin binding of that engine to the playlist key.
"""

from backend.sync_common.matching import match_by_key

from .models import PlaylistInfo


def match_playlists_by_name(
    all_playlists: dict[str, list[PlaylistInfo]]
) -> dict[str, dict[str, PlaylistInfo | None]]:
    """Match playlists by name across all sources.

    Case-sensitive matching as per user requirements. Handles playlists
    that exist in 1, 2, or all 3 sources.

    Args:
        all_playlists: Dictionary with keys 'manadj', 'engine', 'rekordbox'
                      and values as lists of PlaylistInfo objects

    Returns:
        Dictionary mapping playlist name to dict of sources:
        {
            "Playlist Name": {
                'manadj': PlaylistInfo or None,
                'engine': PlaylistInfo or None,
                'rekordbox': PlaylistInfo or None
            },
            ...
        }
    """
    buckets = match_by_key(all_playlists, key_of=lambda p: p.name)
    return {
        name: {
            "manadj": bucket.get("manadj"),
            "engine": bucket.get("engine"),
            "rekordbox": bucket.get("rekordbox"),
        }
        for name, bucket in buckets.items()
    }
