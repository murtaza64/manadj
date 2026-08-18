"""API routes for drop detection (structure-analysis 02).

Possible drops are a pure function of the stored Waveform blob + Beatgrid
(backend.drop_detection) — computed per request, never persisted, never
written to cue slots. Missing inputs yield an empty list, not an error:
"no opinion yet" is a normal state while background analysis runs.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db
from ..drop_detection import detect_drops

router = APIRouter()


@router.get("/{track_id}", response_model=schemas.DropsResponse)
def get_drops(track_id: int, db: Session = Depends(get_db)):
    if not crud.get_track(db, track_id):
        raise HTTPException(status_code=404, detail="Track not found")

    beatgrid = crud.get_beatgrid(db, track_id)
    waveform = crud.get_waveform(db, track_id)
    if not beatgrid or not waveform or waveform.data_blob is None:
        return {"track_id": track_id, "drops": []}

    drops = detect_drops(
        waveform.data_blob,
        json.loads(beatgrid.tempo_changes_json),
        waveform.duration,
    )
    return {"track_id": track_id, "drops": drops}
