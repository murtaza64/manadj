"""API routes for waveforms (Waveform data v2 blobs, ADR 0014)."""

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crud, models
from ..database import get_db

router = APIRouter()


@router.get("/{track_id}/data")
def get_waveform_data(track_id: int, request: Request, db: Session = Depends(get_db)):
    """Serve the Waveform data v2 blob (ADR 0014) as immutable binary.

    404 until the background generation has produced it; clients retry.
    Waveform data never changes once generated, hence the immutable caching.
    """
    blob = (
        db.query(models.Waveform.data_blob)  # targeted column (deferred elsewhere)
        .filter(models.Waveform.track_id == track_id)
        .scalar()
    )
    if blob is None:
        if not crud.get_track(db, track_id):
            raise HTTPException(status_code=404, detail="Track not found")
        raise HTTPException(
            status_code=404,
            detail="Waveform data not ready yet, retry in a few seconds",
        )

    etag = f'"{hashlib.md5(blob).hexdigest()}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=31536000, immutable",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=blob, media_type="application/octet-stream", headers=headers)


class CuePointUpdate(BaseModel):
    cue_point_time: float | None


@router.patch("/{track_id}/cue-point")
def update_cue_point(
    track_id: int,
    payload: CuePointUpdate,
    db: Session = Depends(get_db),
):
    """Set the Track's Main cue (kept under /waveforms for URL compatibility;
    the cue itself lives on the Track — performance data, not Analysis).

    Takes a JSON body — the deck engine's cue-persist path has sent
    `{"cue_point_time": ...}` since 2025-11; the old bare scalar made
    FastAPI demand a query param, so every in-app cue set 422'd silently
    (values in the DB arrived via Sync instead). Regression test:
    tests/test_waveforms_cue.py."""
    track = crud.update_track_cue_point(db, track_id, payload.cue_point_time)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"track_id": track.id, "cue_point_time": track.cue_point_time}
