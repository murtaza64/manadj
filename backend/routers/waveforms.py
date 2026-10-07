"""API routes for waveforms (Waveform data v2 blobs, ADR 0014)."""

import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import crud, models
from ..database import get_db
from ..tasks.models import Task
from ..waveform_tasks import WAVEFORM_TASK_TYPE, enqueue_waveform_task

router = APIRouter()


@router.get("/{track_id}/preview")
def get_waveform_preview(track_id: int, request: Request, db: Annotated[Session, Depends(get_db)]):
    """Serve only the stored bounded MWF preview; queue missing data off-request."""
    blob = (
        db.query(models.Waveform.preview_blob)
        .filter(models.Waveform.track_id == track_id)
        .scalar()
    )
    if blob is None:
        if db.query(models.Track.id).filter(models.Track.id == track_id).scalar() is None:
            raise HTTPException(
                status_code=404, detail="Track not found", headers={"Cache-Control": "no-store"},
            )
        latest_state = (
            db.query(Task.state)
            .filter(Task.type == WAVEFORM_TASK_TYPE, Task.ref == f"track:{track_id}")
            .order_by(Task.id.desc())
            .limit(1)
            .scalar()
        )
        # Polling must not retry failures, even when dismissed from the Tasks UI.
        if latest_state == "failed":
            raise HTTPException(
                status_code=409,
                detail="Waveform generation failed; retry it in Tasks",
                headers={"Cache-Control": "no-store"},
            )
        enqueue_waveform_task(db, track_id)
        return Response(status_code=202, headers={"Cache-Control": "no-store", "Retry-After": "2"})

    etag = f'"{hashlib.sha256(blob).hexdigest()}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "private, no-cache",
        "Access-Control-Expose-Headers": "ETag",
    }
    validators = request.headers.get("if-none-match", "").split(",")
    if any(value.strip().removeprefix("W/") in (etag, "*") for value in validators):
        return Response(status_code=304, headers=headers)
    return Response(content=blob, media_type="application/octet-stream", headers=headers)


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
