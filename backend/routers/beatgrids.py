"""API routes for beatgrids."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import json
from .. import crud, schemas
from ..database import get_db
from ..beatgrid_utils import calculate_beats_from_tempo_changes

router = APIRouter()


class SetDownbeatRequest(BaseModel):
    downbeat_time: float


class NudgeGridRequest(BaseModel):
    offset_ms: float


@router.get("/{track_id}", response_model=schemas.BeatgridResponse)
def get_beatgrid(track_id: int, db: Session = Depends(get_db)):
    """
    Get beatgrid data for a track.

    If beatgrid doesn't exist, generates it from track BPM.
    Requires waveform to exist (for duration).
    """
    # Check if beatgrid exists
    beatgrid = crud.get_beatgrid(db, track_id)

    if not beatgrid:
        # Generate from track BPM
        try:
            beatgrid = crud.create_beatgrid_from_track_bpm(db, track_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate beatgrid: {str(e)}")

    return _format_beatgrid_response(beatgrid, db)


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
    Set downbeat at specified time, recalculating grid backward to t=0.

    Uses track's BPM and existing time signature (or 4/4 default).
    Creates new tempo_changes with first beat as early as possible.
    """
    # Get track BPM
    track = crud.get_track(db, track_id)
    if not track or not track.bpm:
        raise HTTPException(status_code=400, detail="Track has no BPM")

    # Get waveform for duration validation
    waveform = crud.get_waveform(db, track_id)
    if not waveform:
        raise HTTPException(status_code=400, detail="Waveform not found")

    # Get current time signature from existing beatgrid, or default to 4/4
    beatgrid = crud.get_beatgrid(db, track_id)
    if beatgrid:
        tempo_changes = json.loads(beatgrid.tempo_changes_json)
        time_sig_num = tempo_changes[0]["time_signature_num"]
        time_sig_den = tempo_changes[0]["time_signature_den"]
    else:
        time_sig_num = 4
        time_sig_den = 4

    # Calculate new tempo changes
    from ..beatgrid_utils import set_downbeat_at_time
    new_tempo_changes = set_downbeat_at_time(
        user_downbeat_time=request.downbeat_time,
        bpm=track.bpm / 100.0,  # Convert from centiBPM
        time_signature_num=time_sig_num,
        time_signature_den=time_sig_den
    )

    # Update beatgrid
    beatgrid = crud.update_beatgrid_tempo_changes(db, track_id, new_tempo_changes)

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
    new_tempo_changes = nudge_func(
        tempo_changes=tempo_changes,
        offset_ms=request.offset_ms,
        track_duration=waveform.duration
    )

    # Update beatgrid
    beatgrid = crud.update_beatgrid_tempo_changes(db, track_id, new_tempo_changes)

    return _format_beatgrid_response(beatgrid, db)
