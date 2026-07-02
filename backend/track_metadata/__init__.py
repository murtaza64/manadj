"""track_metadata: the single write path for Track metadata.

Owns BPM units (float BPM everywhere; centiBPM only at the ORM column) and
Key conversion (via backend.key). See docs/adr/0002 for the testing posture.
"""

from .file_metadata import (
    FileMetadata,
    FileMetadataError,
    read_file_metadata,
    write_file_metadata,
)
from .manager import (
    apply_update,
    compare_with_files,
    refresh_from_files,
    sync_to_db,
    write_to_files,
)
from .models import (
    MetadataComparison,
    MetadataComparisonResult,
    MetadataComparisonStats,
    MetadataSyncRequest,
    MetadataSyncResult,
    MetadataSyncStats,
    MetadataValues,
    TrackChanges,
    TrackMetadataUpdate,
)
from .units import bpm_to_centibpm, centibpm_to_bpm

__all__ = [
    "FileMetadata",
    "FileMetadataError",
    "MetadataComparison",
    "MetadataComparisonResult",
    "MetadataComparisonStats",
    "MetadataSyncRequest",
    "MetadataSyncResult",
    "MetadataSyncStats",
    "MetadataValues",
    "TrackChanges",
    "TrackMetadataUpdate",
    "apply_update",
    "bpm_to_centibpm",
    "centibpm_to_bpm",
    "compare_with_files",
    "read_file_metadata",
    "refresh_from_files",
    "sync_to_db",
    "write_file_metadata",
    "write_to_files",
]
