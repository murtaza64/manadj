"""Data models for tag synchronization."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TagReference:
    """Immutable tag reference for comparisons.

    Used in sets and dicts for efficient tag matching across sources.
    """
    name: str
    category_name: str
    tag_id: int | str | None
    category_id: int | str | None


@dataclass
class TagInfo:
    """Single tag with metadata from a specific source."""
    name: str
    category_name: str
    source: str                    # 'manadj' | 'engine' | 'rekordbox'
    tag_id: int | str
    category_id: int | str
    display_order: int | None
    color: str | None = None       # Hex color (manadj only)
    track_count: int = 0


@dataclass
class CategoryInfo:
    """Tag category with nested tags."""
    name: str
    source: str
    category_id: int | str
    tags: list[TagInfo]
    display_order: int | None = None
    color: str | None = None


@dataclass
class TagStructure:
    """Complete tag structure for one source."""
    source: str
    categories: list[CategoryInfo]
    total_tags: int


@dataclass
class UnifiedTagView:
    """Unified view of a single tag across all sources for API response.

    Shows which sources have this tag and whether it's synced across all.
    """
    category_name: str
    tag_name: str
    manadj: TagInfo | None
    engine: TagInfo | None
    rekordbox: TagInfo | None
    synced: bool


@dataclass
class TagSyncStats:
    """Statistics for tag sync operations."""
    # Reading
    manadj_categories_loaded: int = 0
    manadj_tags_loaded: int = 0
    engine_playlists_scanned: int = 0
    engine_tags_found: int = 0
    rekordbox_categories_loaded: int = 0
    rekordbox_tags_loaded: int = 0

    # Matching
    categories_matched: int = 0
    tags_matched: int = 0
    categories_unique_manadj: int = 0
    tags_unique_manadj: int = 0
    categories_unique_engine: int = 0
    tags_unique_engine: int = 0
    categories_unique_rekordbox: int = 0
    tags_unique_rekordbox: int = 0

    # Writing (for sync operations)
    categories_created: int = 0
    categories_updated: int = 0
    tags_created: int = 0
    tags_updated: int = 0
    tracks_matched: int = 0
    tracks_unmatched: int = 0
    tracks_updated: int = 0
    tracks_colored: int = 0


@dataclass
class TagSyncRequest:
    """Request parameters for tag sync operations."""
    target: str                    # 'engine' | 'rekordbox'
    dry_run: bool = True
    fresh: bool = False            # Delete existing and recreate (Engine only)
    include_energy: bool = True    # Sync energy tags (Rekordbox only)
