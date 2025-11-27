"""
Sync utilities for comparing and exporting tracks between manadj, Engine DJ, and Rekordbox.

BACKWARD COMPATIBILITY LAYER:
This module re-exports functions from the new modular structure:
- backend/sync_common/ - Common sync utilities
- enginedj/sync.py - Engine DJ specific sync
- enginedj/playlist.py - Engine DJ playlist management
- rekordbox/sync.py - Rekordbox database sync
- rekordbox/xml.py - Rekordbox XML export

All existing imports from backend.sync should continue to work.
"""

# Common utilities
from backend.sync_common.formats import format_track_preview

# Engine DJ sync utilities
from enginedj.sync import (
    index_engine_tracks,
    match_track,
    find_missing_tracks_in_enginedj,
    find_missing_tracks_in_manadj,
)

# Engine DJ playlist management
from enginedj.playlist import (
    get_tracks_by_tag,
    find_playlist_by_title_and_parent,
    update_playlist_tracks,
    create_or_update_playlist,
)

# Rekordbox XML export
from rekordbox.xml import (
    create_rekordbox_xml_from_tracks,
)

# Rekordbox database sync utilities
from rekordbox.sync import (
    index_rekordbox_tracks,
    match_track_rekordbox,
    find_missing_tracks_in_rekordbox,
    find_missing_tracks_in_manadj_from_rekordbox,
)

# Handle dual naming for manadj_track_to_rekordbox_fields
# Import XML version as the default (used more commonly)
from rekordbox.xml import manadj_track_to_rekordbox_xml_fields as manadj_track_to_rekordbox_fields

# Database version is available via full import path if needed
from rekordbox.sync import manadj_track_to_rekordbox_fields as manadj_track_to_rekordbox_db_fields


__all__ = [
    # Common
    'format_track_preview',

    # Engine DJ sync
    'index_engine_tracks',
    'match_track',
    'find_missing_tracks_in_enginedj',
    'find_missing_tracks_in_manadj',

    # Engine DJ playlists
    'get_tracks_by_tag',
    'find_playlist_by_title_and_parent',
    'update_playlist_tracks',
    'create_or_update_playlist',

    # Rekordbox XML
    'create_rekordbox_xml_from_tracks',
    'manadj_track_to_rekordbox_fields',  # XML version

    # Rekordbox sync
    'index_rekordbox_tracks',
    'match_track_rekordbox',
    'find_missing_tracks_in_rekordbox',
    'find_missing_tracks_in_manadj_from_rekordbox',
    'manadj_track_to_rekordbox_db_fields',  # Database version
]
