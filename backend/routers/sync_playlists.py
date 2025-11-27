"""Playlist synchronization API endpoints."""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.database import get_db
from backend.config import get_config
from backend.playlists.sync_manager import PlaylistSyncManager
from backend.playlists.models import UnifiedPlaylist, PlaylistSyncStats, SyncResult
from rekordbox.connection import get_rekordbox_db

router = APIRouter(prefix="/sync/playlists", tags=["sync"])


@router.get("/", response_model=list[UnifiedPlaylist])
def get_unified_playlists(db: Session = Depends(get_db)):
    """Get unified view of playlists across all sources.

    Returns all playlists from manadj, Engine DJ, and Rekordbox, matched by name.
    Uses paths from config.toml.

    Each playlist shows track lists from each source (or None if not present).
    The 'synced' flag indicates if all non-None sources have identical tracks.

    Args:
        db: manadj database session (injected)

    Returns:
        List of UnifiedPlaylist objects
    """
    # Load config
    config = get_config()

    # Create database connections (imports stay in domain modules)
    engine_db = None
    rb_db = None

    if config.database.engine_dj_path:
        from enginedj.connection import EngineDJDatabase
        from pathlib import Path
        engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))

    if config.database.rekordbox_path:
        rb_db = get_rekordbox_db()

    # Create sync manager - it handles reader instantiation
    manager = PlaylistSyncManager(db, engine_db, rb_db)

    # Get unified view
    playlists = manager.get_unified_view()

    return playlists


@router.get("/stats", response_model=PlaylistSyncStats)
def get_playlist_stats(db: Session = Depends(get_db)):
    """Get statistics about playlists across all sources.

    Returns counts of playlists loaded from each source, matched playlists,
    and playlists unique to each source. Uses paths from config.toml.

    Args:
        db: manadj database session (injected)

    Returns:
        PlaylistSyncStats object
    """
    # Load config
    config = get_config()

    engine_db = None
    rb_db = None

    if config.database.engine_dj_path:
        from enginedj.connection import EngineDJDatabase
        from pathlib import Path
        engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))

    if config.database.rekordbox_path:
        rb_db = get_rekordbox_db()

    manager = PlaylistSyncManager(db, engine_db, rb_db)
    stats = manager.get_stats()
    return stats


class SyncPlaylistRequest(BaseModel):
    """Request body for syncing a playlist."""
    source: str  # 'manadj', 'engine', or 'rekordbox'
    target: str | None = None  # Single target, or None to sync to all
    ignore_missing_tracks: bool = False
    dry_run: bool = False


@router.post("/{playlist_name}/sync")
def sync_playlist(
    playlist_name: str,
    request: SyncPlaylistRequest,
    db: Session = Depends(get_db)
):
    """Sync playlist from source to target(s).

    Copies playlist tracks from source database to target database(es).
    If target is None, syncs to all available databases except source.

    Args:
        playlist_name: Name of playlist to sync (URL-encoded)
        request: Sync parameters (source, target, flags)
        db: manadj database session (injected)

    Returns:
        Single SyncResult if target specified, list of SyncResult if syncing to all

    Raises:
        HTTPException: 404 if playlist not found, 400 if validation fails
    """
    # Load config
    config = get_config()

    # Create database connections
    engine_db = None
    rb_db = None

    if config.database.engine_dj_path:
        from enginedj.connection import EngineDJDatabase
        from pathlib import Path
        engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))

    if config.database.rekordbox_path:
        rb_db = get_rekordbox_db()

    # Create sync manager
    manager = PlaylistSyncManager(db, engine_db, rb_db)

    # Sync to single target or all targets
    if request.target:
        result = manager.sync_playlist_to_target(
            playlist_name=playlist_name,
            source=request.source,
            target=request.target,
            ignore_missing_tracks=request.ignore_missing_tracks,
            dry_run=request.dry_run
        )

        # Check for errors
        if not result.success:
            if "not found" in result.error:
                raise HTTPException(status_code=404, detail=result.error)
            else:
                raise HTTPException(status_code=400, detail=result.error)

        return result
    else:
        # Sync to all available targets
        results = manager.sync_playlist_to_all(
            playlist_name=playlist_name,
            source=request.source,
            ignore_missing_tracks=request.ignore_missing_tracks,
            dry_run=request.dry_run
        )

        # Check if any failed
        failed = [r for r in results if not r.success]
        if failed:
            # Return all results but with error status
            raise HTTPException(
                status_code=400,
                detail={
                    "message": f"{len(failed)} of {len(results)} syncs failed",
                    "results": [
                        {
                            "target": r.target,
                            "success": r.success,
                            "error": r.error
                        }
                        for r in results
                    ]
                }
            )

        return results
