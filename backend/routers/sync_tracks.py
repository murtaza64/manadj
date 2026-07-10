"""Track synchronization API endpoints."""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.config import get_config
from backend.tracks.sync_manager import TrackSyncManager
from backend.tracks.models import (
    TrackSyncResult,
    EngineTrackExportRequest,
    EngineTrackExportResult,
    RekordboxTrackSyncRequest,
    RekordboxTrackSyncResult,
)
from backend.tracks.executor import export_tracks_to_engine, sync_rekordbox_tracks
from rekordbox.connection import get_rekordbox_db

router = APIRouter(prefix="/sync/tracks", tags=["sync"])


@router.get("/engine", response_model=TrackSyncResult)
def get_engine_track_discrepancies(
    validate_files: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Get track discrepancies between manadj and Engine DJ.

    Returns both directions:
    - missing_in_target: Tracks in manadj but not Engine DJ (export candidates)
    - missing_in_manadj: Tracks in Engine DJ but not manadj (import candidates)

    Args:
        validate_files: If true, skip tracks where file doesn't exist on disk
        db: manadj database session

    Returns:
        TrackSyncResult with statistics and discrepancy lists
    """
    config = get_config()

    if not config.database.engine_dj_path:
        raise HTTPException(status_code=404, detail="Engine DJ database not configured")

    # Create Engine DJ connection
    from enginedj.connection import EngineDJDatabase
    from pathlib import Path
    engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))

    # Create sync manager and get discrepancies
    manager = TrackSyncManager(db, engine_db=engine_db)
    result = manager.get_engine_discrepancies(validate_files=validate_files)

    return result


@router.get("/rekordbox", response_model=TrackSyncResult)
def get_rekordbox_track_discrepancies(
    validate_files: bool = Query(False),
    db: Session = Depends(get_db)
):
    """Get track discrepancies between manadj and Rekordbox.

    Returns both directions:
    - missing_in_target: Tracks in manadj but not Rekordbox (export candidates)
    - missing_in_manadj: Tracks in Rekordbox but not manadj (import candidates)

    Args:
        validate_files: If true, skip tracks where file doesn't exist on disk
        db: manadj database session

    Returns:
        TrackSyncResult with statistics and discrepancy lists
    """
    config = get_config()

    if not config.database.rekordbox_path:
        raise HTTPException(status_code=404, detail="Rekordbox database not configured")

    # Create Rekordbox connection
    from rekordbox.connection import get_rekordbox_db
    rb_db = get_rekordbox_db()

    # Create sync manager and get discrepancies
    manager = TrackSyncManager(db, rb_db=rb_db)
    result = manager.get_rekordbox_discrepancies(validate_files=validate_files)

    return result


@router.post("/engine/export", response_model=EngineTrackExportResult)
def export_engine_tracks(
    request: EngineTrackExportRequest,
    db: Session = Depends(get_db),
):
    """Directly insert manadj-only tracks into Engine DJ's database.

    ADR 0006 (amended): direct insertion replaced the RBXML detour.
    Engine must be closed (409); the Database2 dir is snapshotted once
    per process run before the first write.
    """
    config = get_config()

    if not config.database.engine_dj_path:
        raise HTTPException(status_code=404, detail="Engine DJ database not configured")

    from pathlib import Path

    from enginedj.connection import EngineDJDatabase
    from enginedj.track_export import (
        EngineRunningError,
        ensure_engine_closed,
        snapshot_database,
    )

    try:
        ensure_engine_closed()
    except EngineRunningError as e:
        raise HTTPException(status_code=409, detail=str(e))

    engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))
    snapshot_database(engine_db.database_path)

    return export_tracks_to_engine(
        manadj_session=db,
        engine_db=engine_db,
        playlist_name=request.playlist_name,
        validate_files=request.validate_files,
    )


@router.post("/rekordbox/sync", response_model=RekordboxTrackSyncResult)
def sync_rekordbox_tracks_bidirectional(
    request: RekordboxTrackSyncRequest,
    db: Session = Depends(get_db),
):
    """Run bidirectional track sync between manadj and Rekordbox."""
    config = get_config()

    if not config.database.rekordbox_path:
        raise HTTPException(status_code=404, detail="Rekordbox database not configured")

    rb_db = get_rekordbox_db()

    try:
        result = sync_rekordbox_tracks(
            manadj_session=db,
            rb_db=rb_db,
            dry_run=request.dry_run,
            skip_export=request.skip_export,
            skip_import=request.skip_import,
            validate_files=request.validate_files,
            playlist_name=request.playlist_name,
        )
        return result
    finally:
        rb_db.close()
