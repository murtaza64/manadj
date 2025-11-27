"""Playlist name matching logic."""

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
    # Collect all unique playlist names across all sources
    all_names = set()
    for playlists in all_playlists.values():
        for playlist in playlists:
            all_names.add(playlist.name)

    # Build lookup dictionaries for each source
    manadj_by_name = {p.name: p for p in all_playlists.get('manadj', [])}
    engine_by_name = {p.name: p for p in all_playlists.get('engine', [])}
    rekordbox_by_name = {p.name: p for p in all_playlists.get('rekordbox', [])}

    # Match playlists by name
    matched = {}
    for name in all_names:
        matched[name] = {
            'manadj': manadj_by_name.get(name),
            'engine': engine_by_name.get(name),
            'rekordbox': rekordbox_by_name.get(name),
        }

    return matched
