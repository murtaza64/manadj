"""Harmony analysis wire (chord-match #388).

GET /api/harmony/loops: every Track whose drop loop has a progression
(movement >= MOVEMENT_MIN) with its int8-quantised chord residual
(base64, 8 bars x 12) — the bulk input to the frontend's Chord match term.
Tracks absent from the map have no defined chord match (neutral).
"""

import base64

import numpy as np
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..harmony import LOOP_BARS, MOVEMENT_MIN, encode_residual

router = APIRouter()


@router.get("/loops")
def get_loops(db: Session = Depends(get_db)) -> dict:
    rows = (
        db.query(models.Harmony.track_id, models.Harmony.loop_blob)
        .filter(models.Harmony.loop_blob.is_not(None))
        .filter(models.Harmony.movement >= MOVEMENT_MIN)
        .all()
    )
    loops = {
        str(track_id): base64.b64encode(
            encode_residual(np.frombuffer(blob, dtype=np.float32).reshape(LOOP_BARS, 12))
        ).decode("ascii")
        for track_id, blob in rows
    }
    return {"bars": LOOP_BARS, "loops": loops}
