"""API routes for waveforms."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pathlib import Path
from .. import crud, schemas
from ..database import get_db
from ..waveform_utils import json_to_band_peaks

router = APIRouter()


@router.get("/{track_id}", response_model=schemas.WaveformResponse)
def get_waveform(track_id: int, db: Session = Depends(get_db)):
    """
    Get waveform data for a track.

    If waveform doesn't exist, generates it on-demand.
    This is safe for first-time calls but may take a few seconds.
    """
    # Check if waveform already exists
    waveform = crud.get_waveform(db, track_id)

    if waveform:
        # Return existing waveform
        return _format_waveform_response(waveform)

    # Generate waveform on-demand
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    file_path = Path(track.filename)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        waveform = crud.create_waveform(db, track_id, str(file_path))
        return _format_waveform_response(waveform)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate waveform: {str(e)}"
        )


@router.patch("/{track_id}/cue-point")
def update_cue_point(
    track_id: int,
    cue_point_time: float | None,
    db: Session = Depends(get_db)
):
    """Update the CUE point for a track's waveform."""
    waveform = crud.get_waveform(db, track_id)
    if not waveform:
        raise HTTPException(status_code=404, detail="Waveform not found")

    waveform = crud.update_waveform_cue_point(db, track_id, cue_point_time)
    return _format_waveform_response(waveform)


def _format_waveform_response(waveform):
    """Format waveform model for API response."""
    # Parse multiband data
    low_peaks = json_to_band_peaks(waveform.low_peaks_json)
    mid_peaks = json_to_band_peaks(waveform.mid_peaks_json)
    high_peaks = json_to_band_peaks(waveform.high_peaks_json)

    bands = {
        "low": low_peaks,
        "mid": mid_peaks,
        "high": high_peaks
    }

    # Generate PNG URL if PNG file exists
    png_url = None
    if waveform.png_path:
        # Extract just the filename from the path
        png_filename = Path(waveform.png_path).name
        png_url = f"/waveforms/{png_filename}"

    return {
        "id": waveform.id,
        "track_id": waveform.track_id,
        "data": {
            "sample_rate": waveform.sample_rate,
            "duration": waveform.duration,
            "samples_per_peak": waveform.samples_per_peak,
            "cue_point_time": waveform.cue_point_time,
            "bands": bands
        },
        "png_url": png_url,
        "created_at": waveform.created_at,
        "updated_at": waveform.updated_at
    }
