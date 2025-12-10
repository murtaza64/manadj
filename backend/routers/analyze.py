"""API router for audio analysis endpoints (BPM and key detection)."""

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pathlib import Path

from .. import crud
from ..database import get_db
from ..analysis import analyze_bpm, analyze_key

router = APIRouter()


@router.get("/bpm/{track_id}")
def get_track_bpm_analysis(
    track_id: int,
    db: Session = Depends(get_db)
):
    """
    Get saved BPM analysis for a track.

    Args:
        track_id: Database ID of the track

    Returns:
        BPMAnalysisResponse with estimates, recommended BPMs, and metadata
    """
    # Get track from database
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Get saved analysis
    analysis = crud.get_bpm_analysis(db, track_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="No BPM analysis found for this track")

    return {
        "track_id": track_id,
        "estimates": json.loads(analysis.estimates_json),
        "recommended_bpms": json.loads(analysis.recommended_bpms_json),
        "recommended_bpm": analysis.recommended_bpm,
        "metadata": {
            "duration": analysis.duration,
            "analyzed_at": analysis.created_at.isoformat() + 'Z'
        }
    }


@router.post("/bpm/{track_id}")
def analyze_track_bpm(
    track_id: int,
    db: Session = Depends(get_db)
):
    """
    Analyze BPM for a track using multiple detection strategies and save results.

    Returns multiple BPM estimates with confidence scores ordered by profiling accuracy.
    Chunk-based analysis is always included for best accuracy.

    Args:
        track_id: Database ID of the track

    Returns:
        BPMAnalysisResponse with estimates, recommended BPMs, and metadata
    """
    # Get track from database
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Validate audio file exists
    audio_path = Path(track.filename)
    if not audio_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Audio file not found at path: {track.filename}"
        )

    # Run analysis (always includes chunks for best accuracy)
    try:
        result = analyze_bpm(str(audio_path))

        # Save analysis to database
        crud.create_or_update_bpm_analysis(
            db=db,
            track_id=track_id,
            estimates=result['estimates'],
            recommended_bpms=result['recommended_bpms'],
            recommended_bpm=result['recommended_bpm'],
            duration=result['metadata']['duration']
        )

        result["track_id"] = track_id
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )


@router.get("/key/{track_id}")
def get_track_key_analysis(
    track_id: int,
    db: Session = Depends(get_db)
):
    """
    Get saved key analysis for a track.

    Args:
        track_id: Database ID of the track

    Returns:
        KeyAnalysisResponse with key in multiple formats, confidence, and metadata
    """
    # Get track from database
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Get saved analysis
    analysis = crud.get_key_analysis(db, track_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="No key analysis found for this track")

    return {
        "track_id": track_id,
        "key": analysis.key,
        "formats": {
            "musical": analysis.musical,
            "openkey": analysis.openkey,
            "camelot": analysis.camelot,
            "engine_id": analysis.engine_id
        },
        "confidence": analysis.confidence,
        "metadata": {
            "scale": analysis.scale,
            "analyzed_at": analysis.created_at.isoformat() + 'Z'
        }
    }


@router.post("/key/{track_id}")
def analyze_track_key(
    track_id: int,
    db: Session = Depends(get_db)
):
    """
    Detect musical key for a track and save results.

    Returns the detected key in multiple formats:
    - musical: Standard notation (e.g., "Am", "C", "F#m")
    - openkey: OpenKey notation (e.g., "1m", "8d")
    - camelot: Camelot wheel notation (e.g., "8A", "1B")
    - engine_id: Engine DJ key ID (0-23)

    Args:
        track_id: Database ID of the track

    Returns:
        KeyAnalysisResponse with key in multiple formats, confidence, and metadata
    """
    # Get track from database
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Validate audio file exists
    audio_path = Path(track.filename)
    if not audio_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Audio file not found at path: {track.filename}"
        )

    # Run analysis
    try:
        result = analyze_key(str(audio_path))

        # Save analysis to database
        crud.create_or_update_key_analysis(
            db=db,
            track_id=track_id,
            key=result['key'],
            formats=result['formats'],
            confidence=result['confidence'],
            scale=result['metadata']['scale']
        )

        result["track_id"] = track_id
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )
