"""API routes for Metric ladders (ADR 0029, metric-ladder 02).

Every endpoint returns the EFFECTIVE ladder: the persisted deviation when a
row exists, else the computed default (duple arities, no Reset marks) with
`persisted=False`. Deviation-only storage is a server invariant: writing
the default state clears the row. Marks are stored seconds; resolving them
to the downbeat lattice is the client resolver's job (a pure read-time
projection — see frontend/src/meter/ladder.ts).
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter()


def _effective_response(db: Session, track_id: int) -> dict:
    ladder = crud.get_metric_ladder(db, track_id)
    if ladder:
        return {
            "track_id": track_id,
            "arities": json.loads(ladder.arities_json),
            "reset_marks": json.loads(ladder.reset_marks_json),
            "persisted": True,
            "updated_at": ladder.updated_at,
        }
    return {
        "track_id": track_id,
        "arities": crud.DEFAULT_LADDER_ARITIES,
        "reset_marks": [],
        "persisted": False,
        "updated_at": None,
    }


def _require_track(db: Session, track_id: int) -> None:
    if not crud.get_track(db, track_id):
        raise HTTPException(status_code=404, detail="Track not found")


@router.get("/{track_id}", response_model=schemas.MetricLadderResponse)
def get_metric_ladder(track_id: int, db: Session = Depends(get_db)):
    """Effective Metric ladder for a track (default when no row exists)."""
    _require_track(db, track_id)
    return _effective_response(db, track_id)


@router.put("/{track_id}", response_model=schemas.MetricLadderResponse)
def put_metric_ladder(
    track_id: int,
    request: schemas.MetricLadderPut,
    db: Session = Depends(get_db),
):
    """Full-state upsert of the track's Reset marks.

    The client sends the complete mark list per gesture (add = list + new
    mark, delete = list − nearest); the server sorts, dedupes, and clears
    the row when the state equals the default. Stored arities are
    preserved — marks are the only editable surface (ADR 0029).
    """
    _require_track(db, track_id)
    if any(m < 0 for m in request.reset_marks):
        raise HTTPException(status_code=400, detail="Reset marks must be ≥ 0 seconds")
    crud.upsert_metric_ladder(db, track_id, request.reset_marks)
    return _effective_response(db, track_id)


@router.delete("/{track_id}", response_model=schemas.MetricLadderResponse)
def delete_metric_ladder(track_id: int, db: Session = Depends(get_db)):
    """Clear the deviation (back to the computed default ladder)."""
    _require_track(db, track_id)
    crud.delete_metric_ladder(db, track_id)
    return _effective_response(db, track_id)
