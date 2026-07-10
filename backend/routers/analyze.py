"""API router for audio analysis endpoints (grid and key detection).

Analysis (ADR 0024) writes its artifacts server-side — an analyzed Beatgrid
plus the BPM projection, a Track key with provenance "analyzed". The manual
Analyze run rides the task system (ADR 0003, task-system 01) exactly like
downloads: POST enqueues a `manual` analysis task and returns its state
instead of blocking a request thread through madmom; the client polls the
task state and refetches the grid/key when it finishes. Heavy analysis deps
stay out of module scope: candidates import madmom inside their method
bodies only.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, models
from ..analysis_tasks import (
    enqueue_analysis_task,
    latest_analysis_task,
    list_inflight_analysis_tasks,
)
from ..database import get_db
from ..grid_analysis import get_grid_analysis

router = APIRouter()


def _task_status(task) -> dict | None:
    """The observable state of a track's latest analysis task, or None."""
    if task is None:
        return None
    return {
        "task_id": task.id,
        "state": task.state,
        "error": task.error,
        "manual": bool(task.payload.get("manual")),
    }


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


@router.get("/pending")
def list_pending_analyses(db: Session = Depends(get_db)):
    """Every in-flight (pending/running) analysis task, library-wide — the
    bulk poll target (analysis-curation 03). The frontend diffs successive
    responses: a track leaving the set means its analysis finished, so its
    row/grid/diagnostics caches refetch; a track in the set renders the
    Analyze button as already running (enqueue dedups server-side, but the
    user shouldn't have to find that out by clicking)."""
    return [
        {
            "track_id": task.payload.get("track_id"),
            "state": task.state,
            "manual": bool(task.payload.get("manual")),
        }
        for task in list_inflight_analysis_tasks(db)
    ]


@router.post("/{track_id}", status_code=202)
def enqueue_manual_analysis(
    track_id: int,
    db: Session = Depends(get_db),
):
    """Enqueue a manual grid+key analysis of a track (ADR 0003, 0024).

    Replaces the old synchronous POST /grid and POST /key endpoints, which
    ran madmom inside the request thread. This enqueues one `manual` analysis
    task (grid and key together, overwriting freely — explicit intent, the
    ladder binds bulk runs only) and returns its state. The worker does the
    work off-thread; the client polls GET /{track_id}/status and refetches
    the grid/key when the task reaches `done`. A dedup (a task already
    pending/running for the track) returns that in-flight task's state.
    """
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    enqueue_analysis_task(db, track_id, manual=True)
    return _task_status(latest_analysis_task(db, track_id))


@router.get("/{track_id}/status")
def get_analysis_task_status(
    track_id: int,
    db: Session = Depends(get_db),
):
    """The observable state of a track's latest analysis task (the poll target
    for the Analyze button). 200 with null when the track has never been
    analyzed by a task."""
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    return _task_status(latest_analysis_task(db, track_id))
