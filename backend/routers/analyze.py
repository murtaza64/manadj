"""API router for audio analysis endpoints (grid and key detection).

Analysis (ADR 0024) writes its artifacts server-side — an analyzed Beatgrid
plus the BPM projection, a Track key with provenance "analyzed" — and
returns the outcome; a grid bail or undetected key is a result (200), not
an error. Heavy analysis deps stay out of module scope: candidates import
madmom inside their method bodies only.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pathlib import Path

from .. import crud, models
from ..database import get_db
from ..grid_analysis import analyze_track_grid, default_grid_analyzer, get_grid_analysis
from ..key_analysis import analyze_track_key, default_key_candidate

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


def get_key_candidate():
    """Dependency seam: tests override this with a stub key candidate."""
    return default_key_candidate()


@router.post("/key/{track_id}")
def analyze_track_key_endpoint(
    track_id: int,
    db: Session = Depends(get_db),
    candidate=Depends(get_key_candidate),
):
    """Manually analyze a track's key (ADR 0024).

    Detection writes Track.key with provenance "analyzed" server-side; the
    client only refetches. An undetected key is a result (200 with key null),
    not an error, and writes nothing. Manual analysis overwrites regardless
    of provenance (explicit intent; the ladder binds bulk runs only).
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
        detected, confidence = analyze_track_key(db, track, candidate)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )

    return {
        "track_id": track_id,
        "candidate": candidate.name,
        "key": None if detected is None else {
            "musical": detected.musical,
            "openkey": detected.openkey,
            "camelot": detected.camelot,
            "engine_id": detected.engine_id,
        },
        "confidence": confidence,
        "provenance": None if detected is None else "analyzed",
    }
