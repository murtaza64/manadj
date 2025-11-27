"""Playlist synchronization components."""

from .models import (
    TrackReference,
    PlaylistInfo,
    UnifiedPlaylist,
    PlaylistDiff,
    PlaylistSyncStats,
)
from .comparison import are_playlists_equivalent, compare_playlists
from .matching import match_playlists_by_name
from .sync_manager import PlaylistSyncManager

__all__ = [
    'TrackReference',
    'PlaylistInfo',
    'UnifiedPlaylist',
    'PlaylistDiff',
    'PlaylistSyncStats',
    'are_playlists_equivalent',
    'compare_playlists',
    'match_playlists_by_name',
    'PlaylistSyncManager',
]
