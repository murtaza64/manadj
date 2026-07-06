"""API routes for beatgrids."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import json
from .. import crud, schemas
from ..database import get_db
from ..beatgrid_utils import (
    calculate_beats_from_tempo_changes,
    constant_tempo_changes,
    dominant_bpm,
    re_anchor_tempo_changes,
    set_downbeat_at_time,
)
from ..track_metadata.units import bpm_to_centibpm, centibpm_to_bpm

router = APIRouter()


class SetDownbeatRequest(BaseModel):
    downbeat_time: float


class NudgeGridRequest(BaseModel):
    offset_ms: float


@router.get("/{track_id}", response_model=schemas.BeatgridResponse)
def get_beatgrid(track_id: int, db: Session = Depends(get_db)):
    """
    Get beatgrid data for a track.

    Gridless tracks get a computed placeholder (ADR 0027 §3): a grid-shaped
    view of the bpm column, origin "generated", never persisted — grid rows
    come into existence only via deliberate gestures (grid edit, import,
    re-tempo). Requires waveform to exist (for duration).
    """
    if not crud.get_track(db, track_id):
        raise HTTPException(status_code=404, detail="Track not found")

    beatgrid = crud.get_beatgrid(db, track_id)
    if beatgrid:
        try:
            return _format_beatgrid_response(beatgrid, db)
        except ValueError as e:
            # Grid exists but its waveform is gone: a clean 4xx, not a 500.
            raise HTTPException(status_code=400, detail=str(e))

    try:
        data = crud.compute_placeholder_beatgrid_data(db, track_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "id": None,
        "track_id": track_id,
        "data": data,
        "origin": "generated",
        "anchor_time": None,
        "created_at": None,
        "updated_at": None,
    }


def _format_beatgrid_response(beatgrid, db: Session):
    """Format beatgrid model for API response."""
    tempo_changes = json.loads(beatgrid.tempo_changes_json)

    # Get duration from waveform
    waveform = crud.get_waveform(db, beatgrid.track_id)
    if not waveform:
        raise ValueError("Waveform not found")

    # Calculate beat times
    beat_times, downbeat_times = calculate_beats_from_tempo_changes(
        tempo_changes,
        waveform.duration
    )

    return {
        "id": beatgrid.id,
        "track_id": beatgrid.track_id,
        "data": {
            "tempo_changes": tempo_changes,
            "beat_times": beat_times,
            "downbeat_times": downbeat_times
        },
        "origin": beatgrid.origin,
        "anchor_time": beatgrid.anchor_time,
        "created_at": beatgrid.created_at,
        "updated_at": beatgrid.updated_at
    }


@router.post("/{track_id}/set-downbeat", response_model=schemas.BeatgridResponse)
def set_beatgrid_downbeat(
    track_id: int,
    request: SetDownbeatRequest,
    db: Session = Depends(get_db)
):
    """
    Mark a downbeat at the specified time (ADR 0016).

    Records the mark as the grid's anchor (last mark wins) and rebuilds the
    grid through it. Constant grids rebuild backward to t=0 as before;
    variable grids re-anchor by rigid shift of the tempo-change map —
    every tempo change is preserved (never flattened).
    """
    # Get waveform for duration validation
    waveform = crud.get_waveform(db, track_id)
    if not waveform:
        raise HTTPException(status_code=400, detail="Waveform not found")

    # The existing grid is the tempo authority; track BPM only seeds a new grid
    beatgrid = crud.get_beatgrid(db, track_id)
    if beatgrid:
        tempo_changes = json.loads(beatgrid.tempo_changes_json)
    else:
        track = crud.get_track(db, track_id)
        if not track or not track.bpm:
            raise HTTPException(status_code=400, detail="Track has no BPM")
        tempo_changes = constant_tempo_changes(centibpm_to_bpm(track.bpm))

    if len(tempo_changes) > 1:
        # Variable grid: shift the whole tempo-change map so the nearest
        # downbeat lands on the mark
        new_tempo_changes = re_anchor_tempo_changes(tempo_changes, request.downbeat_time)
    else:
        tc = tempo_changes[0]
        new_tempo_changes = set_downbeat_at_time(
            user_downbeat_time=request.downbeat_time,
            bpm=tc["bpm"],
            time_signature_num=tc["time_signature_num"],
            time_signature_den=tc["time_signature_den"]
        )

    # Update beatgrid, recording the mark as the anchor (last mark wins)
    beatgrid = crud.update_beatgrid_tempo_changes(
        db, track_id, new_tempo_changes, anchor_time=request.downbeat_time
    )

    return _format_beatgrid_response(beatgrid, db)


@router.post("/{track_id}/nudge", response_model=schemas.BeatgridResponse)
def nudge_beatgrid_endpoint(
    track_id: int,
    request: NudgeGridRequest,
    db: Session = Depends(get_db)
):
    """
    Nudge beatgrid left/right by offset_ms milliseconds.

    Positive offset shifts grid later (right), negative shifts earlier (left).
    Auto-generates beatgrid from BPM if it doesn't exist.
    """
    # Get beatgrid (or create from BPM)
    beatgrid = crud.get_beatgrid(db, track_id)
    if not beatgrid:
        try:
            beatgrid = crud.create_beatgrid_from_track_bpm(db, track_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Get waveform for duration
    waveform = crud.get_waveform(db, track_id)
    if not waveform:
        raise HTTPException(status_code=400, detail="Waveform not found")

    # Parse current tempo changes
    tempo_changes = json.loads(beatgrid.tempo_changes_json)

    # Nudge
    from ..beatgrid_utils import nudge_beatgrid as nudge_func
    new_tempo_changes, applied_offset_s = nudge_func(
        tempo_changes=tempo_changes,
        offset_ms=request.offset_ms,
        track_duration=waveform.duration
    )

    # The anchor is part of the grid: shift it by exactly the applied offset
    new_anchor = (
        beatgrid.anchor_time + applied_offset_s
        if beatgrid.anchor_time is not None
        else None
    )

    # Update beatgrid
    beatgrid = crud.update_beatgrid_tempo_changes(
        db, track_id, new_tempo_changes, anchor_time=new_anchor
    )

    return _format_beatgrid_response(beatgrid, db)


@router.delete("/{track_id}")
def delete_beatgrid(track_id: int, db: Session = Depends(get_db)):
    """Delete the beatgrid; the next GET serves a computed placeholder.

    Projects first (ADR 0027 §8): a real grid's dominant tempo is written
    into the bpm column before deletion, so the served bpm is continuous
    across it. Generated rows are never an authority — no projection.
    """
    beatgrid = crud.get_beatgrid(db, track_id)
    if beatgrid:
        if beatgrid.origin != "generated":
            tempo_changes = json.loads(beatgrid.tempo_changes_json)
            track = crud.get_track(db, track_id)
            if track is not None and tempo_changes:
                waveform = crud.get_waveform(db, track_id)
                duration = waveform.duration if waveform else track.duration_secs
                track.bpm = bpm_to_centibpm(dominant_bpm(tempo_changes, duration))
        db.delete(beatgrid)
        db.commit()
    return {"message": "Beatgrid deleted"}
