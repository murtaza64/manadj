"""Ladder-respecting library backfill (ADR 0024, native-analysis-accuracy 11).

One bulk run over the whole library with the winning analyzers:

- The ladder (issue 09) protects Engine-imported and hand-edited data —
  skipped and reported, never overwritten.
- Currency markers make the run idempotent: a grid whose diagnostics carry
  the current analyzer's name (bail included — a bail is a verdict) and a
  key whose `key_analysis_candidate` matches the current backend are
  already-current and skipped. Migration-backfilled `analyzed` keys have no
  marker — exactly the stale old-backend values this run refreshes.
- Bailed tracks land on the needs-attention worklist (derived flag) and in
  the summary's bailed list.
- Per-track errors (missing files, decode failures) are counted and logged;
  the run carries on.

Real-DB operation: execute via scripts/backfill_analysis.py in the default
workspace AFTER this lands (parallel-work rules); tests drive it with
stubbed candidates only.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy.orm import Session, joinedload

from harness.analyzer import GridAnalyzer
from harness.key_candidates import KeyCandidate

from . import models
from .bulk_analysis import grid_is_protected, key_is_protected
from .grid_analysis import analyze_track_grid
from .key_analysis import analyze_track_key

logger = logging.getLogger(__name__)

Progress = Callable[[str], None]


@dataclass
class BackfillSummary:
    total: int = 0
    # written | bailed | skipped_ladder | skipped_current | error
    grid: dict[str, int] = field(default_factory=dict)
    # written | undetected | skipped_ladder | skipped_current | error
    key: dict[str, int] = field(default_factory=dict)
    bailed_tracks: list[tuple[int, str | None]] = field(default_factory=list)

    @property
    def errors(self) -> int:
        return self.grid.get("error", 0) + self.key.get("error", 0)

    def _bump(self, side: dict[str, int], outcome: str) -> None:
        side[outcome] = side.get(outcome, 0) + 1


def _grid_is_current(track: models.Track, analyzer_name: str) -> bool:
    """Already analyzed by the current analyzer — and the artifact still
    exists (a bail's verdict IS the artifact; a deleted grid is not)."""
    diagnostics = track.grid_analysis
    if diagnostics is None or diagnostics.candidate != analyzer_name:
        return False
    return bool(diagnostics.bailed) or track.beatgrid is not None


def _key_is_current(track: models.Track, candidate_name: str) -> bool:
    return (
        track.key is not None
        and track.key_provenance == "analyzed"
        and track.key_analysis_candidate == candidate_name
    )


def backfill_analysis(
    db: Session,
    analyzer: GridAnalyzer,
    key_candidate: KeyCandidate,
    progress: Progress = print,
) -> BackfillSummary:
    """Run the backfill over every Track. Returns the summary."""
    tracks = (
        db.query(models.Track)
        .options(
            joinedload(models.Track.beatgrid),
            joinedload(models.Track.grid_analysis),
        )
        .order_by(models.Track.id)
        .all()
    )
    summary = BackfillSummary(total=len(tracks))

    for i, track in enumerate(tracks, start=1):
        grid_outcome = _run_grid_side(db, track, analyzer, summary)
        key_outcome = _run_key_side(db, track, key_candidate, summary)
        progress(
            f"[{i}/{summary.total}] track {track.id} ({track.title or track.filename})"
            f" — grid {grid_outcome}, key {key_outcome}"
        )

    return summary


def _run_grid_side(
    db: Session,
    track: models.Track,
    analyzer: GridAnalyzer,
    summary: BackfillSummary,
) -> str:
    if grid_is_protected(track):
        outcome = "skipped_ladder"
    elif _grid_is_current(track, analyzer.name):
        outcome = "skipped_current"
    else:
        try:
            diagnostics = analyze_track_grid(db, track, analyzer)
        except Exception as e:
            logger.warning("grid analysis failed for track %d: %s", track.id, e)
            outcome = "error"
        else:
            if diagnostics.bailed:
                outcome = "bailed"
                summary.bailed_tracks.append((track.id, track.title))
            else:
                outcome = "written"
    summary._bump(summary.grid, outcome)
    return outcome


def _run_key_side(
    db: Session,
    track: models.Track,
    key_candidate: KeyCandidate,
    summary: BackfillSummary,
) -> str:
    if key_is_protected(track):
        outcome = "skipped_ladder"
    elif _key_is_current(track, key_candidate.name):
        outcome = "skipped_current"
    else:
        try:
            detected, _confidence = analyze_track_key(db, track, key_candidate)
        except Exception as e:
            logger.warning("key analysis failed for track %d: %s", track.id, e)
            outcome = "error"
        else:
            outcome = "written" if detected is not None else "undetected"
    summary._bump(summary.key, outcome)
    return outcome
