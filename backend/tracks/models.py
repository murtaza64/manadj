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
