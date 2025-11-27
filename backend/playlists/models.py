"""Data models for playlist synchronization."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class TrackReference:
    """Lightweight track reference for playlist contents.

    Immutable dataclass that can be used in sets for efficient comparison.
    Uses path-based matching aligned with existing track sync patterns.
    """
    path: str                         # Absolute path (primary matching key)
    filename: str                     # Filename only (for display/fallback matching)
    title: str | None = None          # Optional metadata
    artist: str | None = None         # Optional metadata
    track_id: int | str | None = None # Source-specific track ID (int for manadj/Engine, str for Rekordbox)


@dataclass
class PlaylistInfo:
    """Generic playlist representation across all sources.

    Single model that works across manadj, Engine DJ, and Rekordbox.
    Hierarchy is flattened at read time for manadj compatibility.
    """
    name: str                          # Flattened name ("Parent > Child")
    tracks: list[TrackReference]       # Ordered track list
    source: str                        # 'manadj' | 'engine' | 'rekordbox'
    source_id: Any                     # Source-specific ID
    hierarchy_parts: list[str] | None  # Original hierarchy for potential recreation
    last_modified: datetime | None     # When available
    color: str | None = None           # manadj only


@dataclass
class TrackEntry:
    """Track entry with filename and optional ID for metadata lookup.

    Used in UnifiedPlaylist API responses to provide both display names
    and IDs for fetching full track metadata.
    """
    filename: str
    track_id: int | str | None = None


@dataclass
class UnifiedPlaylist:
    """Unified playlist view across all sources for API response.

    UI-friendly format with track entries (filename + ID) and sync status.
    None indicates playlist doesn't exist in that source.
    """
    name: str
    manadj: list[TrackEntry] | None       # List of track entries, None if not in manadj
    engine: list[TrackEntry] | None       # List of track entries, None if not in Engine
    rekordbox: list[TrackEntry] | None    # List of track entries, None if not in Rekordbox
    synced: bool                          # True if all non-None sources have same tracks


@dataclass
class PlaylistDiff:
    """Difference between two playlists.

    Used for conflict detection and resolution.
    """
    added_tracks: list[TrackReference]    # In B but not A
    removed_tracks: list[TrackReference]  # In A but not B
    reordered: bool                       # Same tracks, different order
    tracks_count_a: int
    tracks_count_b: int


@dataclass
class PlaylistSyncStats:
    """Statistics for playlist sync operations.

    Follows the pattern established by TagSyncStats.
    """
    # Loading
    manadj_playlists_loaded: int = 0
    engine_playlists_loaded: int = 0
    rekordbox_playlists_loaded: int = 0

    # Matching
    playlists_matched: int = 0
    playlists_unique_manadj: int = 0
    playlists_unique_engine: int = 0
    playlists_unique_rekordbox: int = 0

    # Conflicts (for future Phase 2)
    conflicts_detected: int = 0


@dataclass
class SyncResult:
    """Result of syncing a playlist to one target.

    Contains success/failure status, statistics, and error details.
    """
    target: str  # 'manadj', 'engine', or 'rekordbox'
    success: bool
    created: bool  # True if playlist was created, False if updated
    tracks_synced: int
    tracks_unmatched: list[str]  # Filenames that couldn't be matched
    error: str | None = None
