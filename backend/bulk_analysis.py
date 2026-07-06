"""The overwrite ladder for bulk/automatic analysis runs (ADR 0024).

Grids: generated < analyzed < imported < edited. Keys: (unknown/NULL) <
analyzed < imported < manual. A bulk run — auto-analyze on acquisition
(issue 10), the library backfill (issue 11), any future sweep — never
overwrites a value that outranks `analyzed`, and reports the skip. The
ladder is checked BEFORE any audio is touched: a fully protected track
costs nothing.

Manual single-track analysis (the /api/analyze endpoints) deliberately does
not pass through this module — explicit intent overwrites freely.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from harness.analyzer import GridAnalyzer
from harness.key_candidates import KeyCandidate

from . import models
from .grid_analysis import analyze_track_grid
from .key_analysis import analyze_track_key

# Beatgrid origins that outrank a fresh `analyzed` grid.
GRID_PROTECTED_ORIGINS = ("imported", "edited")
# Key provenances that outrank a fresh `analyzed` key.
KEY_PROTECTED_PROVENANCES = ("imported", "manual")


@dataclass(frozen=True)
class BulkOutcome:
    """Per-track report of one bulk run. grid: written | skipped | bailed;
    key: written | skipped | undetected."""

    grid: str
    key: str


def grid_is_protected(track: models.Track) -> bool:
    grid = track.beatgrid
    return grid is not None and grid.origin in GRID_PROTECTED_ORIGINS


def key_is_protected(track: models.Track) -> bool:
    return (
        track.key is not None
        and track.key_provenance in KEY_PROTECTED_PROVENANCES
    )


def bulk_analyze_track(
    db: Session,
    track: models.Track,
    analyzer: GridAnalyzer,
    key_candidate: KeyCandidate,
) -> BulkOutcome:
    """Analyze one Track under the ladder: grid and key each run only when
    the current value doesn't outrank `analyzed`."""
    if grid_is_protected(track):
        grid_outcome = "skipped"
    else:
        diagnostics = analyze_track_grid(db, track, analyzer)
        grid_outcome = "bailed" if diagnostics.bailed else "written"

    if key_is_protected(track):
        key_outcome = "skipped"
    else:
        detected, _confidence = analyze_track_key(db, track, key_candidate)
        key_outcome = "written" if detected is not None else "undetected"

    return BulkOutcome(grid=grid_outcome, key=key_outcome)
