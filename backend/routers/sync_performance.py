"""Performance data External Import endpoints
(see .scratch/performance-data-sync/PRD.md)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend import crud, models
from backend.database import get_db
from backend.sync_performance import (
    EnginePerformanceSource,
    OverwriteInstruction,
    bulk_import,
    import_beatgrid,
    import_hotcues,
    import_maincue,
)

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


def _track_or_404(db: Session, track_id: int) -> models.Track:
    track = crud.get_track(db, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


class HotCueImportRequest(BaseModel):
    track_id: int
    mode: Literal["fill-empty", "replace-all"]


class SingleValueImportRequest(BaseModel):
    track_id: int
    mode: Literal["fill-empty", "replace"]


@router.post("/hotcues/import")
def import_hotcues_endpoint(
    request: HotCueImportRequest,
    db: Session = Depends(get_db),
    source: EnginePerformanceSource = Depends(get_engine_performance_source),
):
    """Import Engine's hot cues onto one Library track. fill-empty never
    touches existing slots; replace-all is the confirmed overwrite verb."""
    track = _track_or_404(db, request.track_id)
    fields = source.fields_for(track.filename)
    if fields is None or fields.hotcues is None:
        raise HTTPException(
            status_code=404,
            detail="Track not matched in Engine DJ, or it has no cue data there",
        )
    return import_hotcues(db, track.id, fields.hotcues, request.mode)


@router.post("/beatgrid/import")
def import_beatgrid_endpoint(
    request: SingleValueImportRequest,
    db: Session = Depends(get_db),
    source: EnginePerformanceSource = Depends(get_engine_performance_source),
):
    """Import Engine's Beatgrid onto one Library track (origin "imported").
    fill-empty only lands on absent/placeholder grids; replace is the
    confirmed overwrite verb. Variable grids import in full."""
    track = _track_or_404(db, request.track_id)
    fields = source.fields_for(track.filename)
    if fields is None or fields.beatgrid is None:
        raise HTTPException(
            status_code=404,
            detail="Track not matched in Engine DJ, or it has no beatgrid there",
        )
    return import_beatgrid(db, track.id, fields.beatgrid, request.mode)


class BulkOverwrite(BaseModel):
    track_id: int
    field: Literal["hotcues", "beatgrid", "maincue", "key"]
    mode: Literal["fill-empty", "replace-all"] | None = None  # hotcues only


class BulkImportRequest(BaseModel):
    track_ids: list[int] | None = None  # None = the whole Library
    overwrites: list[BulkOverwrite] = []


@router.post("/bulk-import")
def bulk_import_endpoint(
    request: BulkImportRequest,
    db: Session = Depends(get_db),
    source: EnginePerformanceSource = Depends(get_engine_performance_source),
):
    """Bulk performance-data import: the automatic tier fills blanks; every
    overwrite of saved info comes back as a pending item and is only applied
    when listed in `overwrites`."""
    result = bulk_import(
        db,
        source,
        request.track_ids,
        [
            OverwriteInstruction(track_id=o.track_id, field=o.field, mode=o.mode)
            for o in request.overwrites
        ],
    )
    return result


@router.post("/maincue/import")
def import_maincue_endpoint(
    request: SingleValueImportRequest,
    db: Session = Depends(get_db),
    source: EnginePerformanceSource = Depends(get_engine_performance_source),
):
    """Import Engine's user-set Main cue (overridden flag only) onto one
    Library track, through the normal cue persistence path."""
    track = _track_or_404(db, request.track_id)
    fields = source.fields_for(track.filename)
    if fields is None or fields.maincue is None:
        raise HTTPException(
            status_code=404,
            detail="Track not matched in Engine DJ, or its main cue was never moved there",
        )
    try:
        return import_maincue(db, track.id, fields.maincue, request.mode)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
