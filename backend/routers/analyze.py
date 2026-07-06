"""API router for audio analysis endpoints (grid and key detection).

Grid analysis (ADR 0024) writes its artifact server-side — an analyzed
Beatgrid plus the BPM projection — and returns diagnostics; a bail is a
result (200), not an error. Heavy analysis deps are kept out of module
scope: the grid analyzer's candidate imports madmom inside ticks(), and
the key path is imported lazily inside its endpoints.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pathlib import Path

from .. import crud, models
from ..database import get_db
from ..grid_analysis import analyze_track_grid, default_grid_analyzer, get_grid_analysis

router = APIRouter()


def get_grid_analyzer():
    """Dependency seam: tests override this with a stub-candidate analyzer."""
    return default_grid_analyzer()


def _grid_analysis_response(diagnostics: models.GridAnalysis) -> dict:
    return {
        "track_id": diagnostics.track_id,
        "candidate": diagnostics.candidate,
        "bailed": diagnostics.bailed,
        "bpm": diagnostics.bpm,
        "phase": diagnostics.phase,
        "residual_ms": diagnostics.residual_ms,
        "evidence": json.loads(diagnostics.evidence_json),
        "analyzed_at": diagnostics.updated_at.isoformat() + "Z",
    }


@router.get("/grid/{track_id}")
def get_track_grid_analysis(
    track_id: int,
    db: Session = Depends(get_db)
):
    """Diagnostics of the track's last native grid analysis, if any."""
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    diagnostics = get_grid_analysis(db, track_id)
    if not diagnostics:
        raise HTTPException(status_code=404, detail="No grid analysis found for this track")

    return _grid_analysis_response(diagnostics)


@router.post("/grid/{track_id}")
def analyze_track_grid_endpoint(
    track_id: int,
    db: Session = Depends(get_db),
    analyzer=Depends(get_grid_analyzer),
):
    """Manually analyze a track's grid (ADR 0024).

    Success writes the analyzed Beatgrid and its BPM projection server-side;
    the client only refetches. Bail writes diagnostics only and returns them
    with bailed=true — the track joins the needs-attention worklist.
    Manual analysis overwrites any existing grid regardless of origin
    (explicit intent; the overwrite ladder binds bulk runs only).
    """
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    audio_path = Path(track.filename)
    if not audio_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Audio file not found at path: {track.filename}"
        )

    try:
        diagnostics = analyze_track_grid(db, track, analyzer)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )

    return _grid_analysis_response(diagnostics)


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
    # Heavy import (essentia at module scope in backend.analysis) stays out
    # of this module's import chain; issue 08 replaces the backend anyway.
    from ..analysis import analyze_key

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
