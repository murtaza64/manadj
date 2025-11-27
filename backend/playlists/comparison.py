"""Playlist comparison logic."""

from pathlib import Path
from .models import PlaylistInfo, PlaylistDiff, TrackReference
from backend.sync_common.matching import index_tracks_by_path, match_track_two_tier


def are_playlists_equivalent(
    playlist_a: PlaylistInfo,
    playlist_b: PlaylistInfo
) -> bool:
    """Quick check if playlists have identical tracks in same order.

    Uses two-tier matching from sync_common to handle relative vs absolute paths.

    Args:
        playlist_a: First playlist
        playlist_b: Second playlist

    Returns:
        True if playlists have exactly the same tracks in the same order
    """
    if len(playlist_a.tracks) != len(playlist_b.tracks):
        return False

    # Index playlist_b tracks for matching
    tracks_b_by_path, tracks_b_by_filename = index_tracks_by_path(
        playlist_b.tracks,
        lambda t: t.path,
        lambda t: t.path
    )

    # Check if each track in playlist_a matches playlist_b in order
    for track_a, track_b in zip(playlist_a.tracks, playlist_b.tracks):
        # Use two-tier matching to find equivalent track
        matched = match_track_two_tier(track_a.path, tracks_b_by_path, tracks_b_by_filename)

        # Must match the same position track in playlist_b
        if matched != track_b:
            return False

    return True


def compare_playlists(
    playlist_a: PlaylistInfo,
    playlist_b: PlaylistInfo
) -> PlaylistDiff:
    """Compare two playlists and return differences.

    Uses path-based matching for tracks. Set operations provide efficient
    comparison for large playlists.

    Args:
        playlist_a: First playlist (reference)
        playlist_b: Second playlist (comparison)

    Returns:
        PlaylistDiff describing differences between playlists
    """
    # Convert to sets for efficient comparison
    paths_a = {track.path for track in playlist_a.tracks}
    paths_b = {track.path for track in playlist_b.tracks}

    # Find added and removed tracks
    added_paths = paths_b - paths_a
    removed_paths = paths_a - paths_b

    # Get full track objects for added/removed
    added_tracks = [t for t in playlist_b.tracks if t.path in added_paths]
    removed_tracks = [t for t in playlist_a.tracks if t.path in removed_paths]

    # Check for reordering: same tracks, different order
    reordered = False
    if paths_a == paths_b:  # Same tracks
        # Check if order is different
        order_a = [t.path for t in playlist_a.tracks]
        order_b = [t.path for t in playlist_b.tracks]
        reordered = order_a != order_b

    return PlaylistDiff(
        added_tracks=added_tracks,
        removed_tracks=removed_tracks,
        reordered=reordered,
        tracks_count_a=len(playlist_a.tracks),
        tracks_count_b=len(playlist_b.tracks)
    )
