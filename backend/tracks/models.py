"""Data models for track synchronization."""

from dataclasses import dataclass


@dataclass
class TrackDiscrepancy:
    """A track that exists in one system but not another."""
    filename: str
    title: str | None
    artist: str | None
    bpm: int | None
    key: int | None
    source_system: str  # 'manadj', 'engine', or 'rekordbox'


@dataclass
class TrackSyncStats:
    """Statistics about track synchronization status."""
    manadj_total: int
    target_total: int
    missing_in_target_count: int
    missing_in_manadj_count: int
    skipped_file_not_found: int = 0  # Only relevant for export direction


@dataclass
class TrackSyncResult:
    """Complete track sync discrepancy information."""
    target: str  # 'engine' or 'rekordbox'
    stats: TrackSyncStats
    missing_in_target: list[TrackDiscrepancy]  # Tracks to export
    missing_in_manadj: list[TrackDiscrepancy]  # Tracks to import


@dataclass
class EngineRBXMLSyncRequest:
    """Request parameters for Engine DJ RBXML sync."""
    playlist_name: str | None = None
    output_path: str | None = None
    validate_files: bool = True
    skip_import: bool = True


@dataclass
class EngineRBXMLSyncResult:
    """Result of exporting manadj tracks to Engine DJ RBXML."""
    target: str = 'engine'
    exported_to_target: int = 0
    skipped_file_not_found: int = 0
    playlist_name: str | None = None
    output_path: str | None = None


@dataclass
class RekordboxTrackSyncRequest:
    """Request parameters for Rekordbox track sync."""
    dry_run: bool = True
    skip_export: bool = False
    skip_import: bool = False
    validate_files: bool = True
    playlist_name: str | None = None


@dataclass
class RekordboxTrackSyncResult:
    """Result of Rekordbox bidirectional track sync."""
    target: str = 'rekordbox'
    dry_run: bool = True
    skipped_file_not_found: int = 0
    missing_in_target_count: int = 0
    missing_in_manadj_count: int = 0
    exported_to_target: int = 0
    imported_to_manadj: int = 0
    playlist_name: str | None = None
    playlist_created: bool = False
