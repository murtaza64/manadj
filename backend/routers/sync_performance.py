"""Performance data External Import endpoints
(see .scratch/performance-data-sync/PRD.md)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend import crud
from backend.database import get_db
from backend.sync_performance import EnginePerformanceSource, import_hotcues

router = APIRouter(prefix="/sync/performance", tags=["sync"])


def get_engine_performance_source() -> EnginePerformanceSource:
    """Dependency: the Engine performance-data source, or 503 when Engine
    is not configured/reachable. Overridden with a fake in tests."""
    from pathlib import Path

    from backend.config import get_config

    path = get_config().database.engine_dj_path
    if not path or not Path(path).exists():
        raise HTTPException(status_code=503, detail="Engine DJ library not available")
    from enginedj.connection import EngineDJDatabase

    return EnginePerformanceSource(EngineDJDatabase(Path(path)))


class HotCueImportRequest(BaseModel):
    track_id: int
    mode: Literal["fill-empty", "replace-all"]


@router.post("/hotcues/import")
def import_hotcues_endpoint(
    request: HotCueImportRequest,
    db: Session = Depends(get_db),
    source: EnginePerformanceSource = Depends(get_engine_performance_source),
):
    """Import Engine's hot cues onto one Library track. fill-empty never
    touches existing slots; replace-all is the confirmed overwrite verb."""
    track = crud.get_track(db, request.track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")

    cues = source.hotcues_for(track.filename)
    if cues is None:
        raise HTTPException(
            status_code=404,
            detail="Track not matched in Engine DJ, or it has no cue data there",
        )

    return import_hotcues(db, track.id, cues, request.mode)
