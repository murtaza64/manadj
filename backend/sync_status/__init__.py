"""sync_status: the unified sync view aggregator (see PRD in
.scratch/unified-sync-view/)."""

from .aggregator import SurfaceReader, compute_sync_status
from .models import (
    FieldDivergence,
    SurfaceTrackRef,
    SyncStatusResult,
    SyncStatusRow,
    TrackFields,
)

__all__ = [
    "FieldDivergence",
    "SurfaceReader",
    "SurfaceTrackRef",
    "SyncStatusResult",
    "SyncStatusRow",
    "TrackFields",
    "compute_sync_status",
]
