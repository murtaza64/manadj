"""The server-side BPM write operation (ADR 0016).

BPM is a projection of the Beatgrid: when a grid exists it is the authority
on tempo, and "editing BPM" is a grid operation executed here — one owner,
atomic — not an independent field write. Without a grid, BPM is plain
metadata (a seed for placeholder-grid generation).
"""

import json

from sqlalchemy.orm import Session

from backend import models
from backend.beatgrid_utils import (
    constant_tempo_changes,
    first_downbeat_time,
    set_downbeat_at_time,
)
from backend.track_metadata.units import bpm_to_centibpm


class VariableGridBPMError(Exception):
    """A single-BPM edit is not meaningful on a variable grid (ADR 0016)."""


def write_bpm(db: Session, track: models.Track, new_bpm: float) -> None:
    """Write a Track's BPM — the one sanctioned "edit BPM" path (ADR 0016).

    Switches on the grid:
    - no grid → plain metadata write (placeholder generation unchanged);
    - ``generated`` (placeholder, not saved info) → regenerate from new_bpm;
    - ``edited``/``imported`` (saved info) → anchor-preserving re-tempo:
      respace beats around the grid's anchor (fallback: first downbeat);
      origin becomes ``edited``;
    - variable grid (multiple tempo changes) → VariableGridBPMError
      (mapped to HTTP 409 at the router seam).

    ``tracks.bpm`` is kept in sync as a write-through cache in every case.
    Mutates ORM state only; the caller owns commit.
    """
    grid = (
        db.query(models.Beatgrid).filter(models.Beatgrid.track_id == track.id).first()
    )
    if grid is not None:
        tempo_changes = json.loads(grid.tempo_changes_json)
        if len(tempo_changes) > 1:
            raise VariableGridBPMError(
                "Track has a variable beatgrid (multiple tempo changes); "
                "a single BPM edit is not meaningful — edit the grid instead."
            )
        if grid.origin == "generated":
            # Placeholder grid: not saved info — regenerate freely.
            grid.tempo_changes_json = json.dumps(constant_tempo_changes(new_bpm))
            grid.anchor_time = None
        else:
            # Saved info: respace beats around the anchor; never delete+regen.
            tc = tempo_changes[0]
            anchor = grid.anchor_time
            if anchor is None:
                anchor = first_downbeat_time(tempo_changes)
            new_tempo_changes = set_downbeat_at_time(
                user_downbeat_time=anchor,
                bpm=new_bpm,
                time_signature_num=tc["time_signature_num"],
                time_signature_den=tc["time_signature_den"],
            )
            grid.tempo_changes_json = json.dumps(new_tempo_changes)
            grid.origin = "edited"
            # Persist the anchor actually used: successive re-tempos must
            # respace around the same downbeat (recomputing the fallback each
            # time would drift, since the rebuilt grid's first downbeat moves).
            grid.anchor_time = anchor

    # tracks.bpm stays a write-through cache of the grid's tempo.
    track.bpm = bpm_to_centibpm(new_bpm)


def cleanup_placeholder_rows(db: Session) -> tuple[int, list[int]]:
    """Delete persisted `generated` grid rows that are pure derivations of
    the bpm column (ADR 0027 §3: placeholders are computed, not rows).

    A row whose tempo equals the column carries zero information — delete.
    A diverged one (the frozen-placeholder failure mode) is kept and its
    track id reported: reconcile the column by hand first, then re-run.
    Returns (deleted_count, kept_diverged_track_ids). Mutates ORM state
    only; the caller owns commit.
    """
    deleted = 0
    kept: list[int] = []
    rows = (
        db.query(models.Beatgrid)
        .filter(models.Beatgrid.origin == "generated")
        .all()
    )
    for grid in rows:
        tempo_changes = json.loads(grid.tempo_changes_json)
        track = db.get(models.Track, grid.track_id)
        column_bpm = track.bpm if track is not None else None
        is_pure_derivation = (
            len(tempo_changes) == 1
            and column_bpm is not None
            and bpm_to_centibpm(tempo_changes[0]["bpm"]) == column_bpm
        )
        if is_pure_derivation:
            db.delete(grid)
            deleted += 1
        else:
            kept.append(grid.track_id)
    return deleted, kept


def backfill_bpm_from_grids(db: Session) -> int:
    """One-time reconcile of the internal centibpm column (ADR 0027 §2).

    For every track with a real (non-generated) grid: column := the grid's
    dominant tempo (the served projection). Gridless and placeholder-only
    tracks are untouched. Returns the number of rows changed. Mutates ORM
    state only; the caller owns commit.
    """
    changed = 0
    tracks = (
        db.query(models.Track)
        .join(models.Beatgrid, models.Beatgrid.track_id == models.Track.id)
        .filter(models.Beatgrid.origin != "generated")
        .all()
    )
    for track in tracks:
        projected = track.bpm_projected
        if projected is None:
            continue
        new_centibpm = bpm_to_centibpm(projected)
        if track.bpm != new_centibpm:
            track.bpm = new_centibpm
            changed += 1
    return changed
