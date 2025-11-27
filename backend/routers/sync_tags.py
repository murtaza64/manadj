"""Tag synchronization API endpoints."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.config import get_config
from backend.tags.sync_manager import TagSyncManager
from backend.tags.models import UnifiedTagView, TagSyncStats, TagSyncRequest
from rekordbox.connection import get_rekordbox_db

router = APIRouter(prefix="/sync/tags", tags=["sync"])


@router.get("/", response_model=list[UnifiedTagView])
def get_unified_tags(db: Session = Depends(get_db)):
    """Get unified view of tags across all sources.

    Returns all tags from manadj, Engine DJ, and Rekordbox, matched by name.
    Uses paths from config.toml.

    Each tag shows presence in each source (or None if not present).
    The 'synced' flag indicates if at least one source has this tag.

    Args:
        db: manadj database session (injected)

    Returns:
        List of UnifiedTagView objects
    """
    # Load config
    config = get_config()

    # Create database connections (imports stay in domain modules)
    engine_db = None
    rb_db = None

    if config.database.engine_dj_path:
        from enginedj.connection import EngineDJDatabase
        engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))

    if config.database.rekordbox_path:
        rb_db = get_rekordbox_db()

    # Create sync manager
    manager = TagSyncManager(db, engine_db, rb_db)

    # Get unified view
    tags = manager.get_unified_view()

    return tags


@router.get("/stats", response_model=TagSyncStats)
def get_tag_stats(db: Session = Depends(get_db)):
    """Get statistics about tags across all sources.

    Returns counts of categories/tags loaded from each source,
    matched tags, and tags unique to each source. Uses paths from config.toml.

    Args:
        db: manadj database session (injected)

    Returns:
        TagSyncStats object
    """
    # Load config
    config = get_config()

    engine_db = None
    rb_db = None

    if config.database.engine_dj_path:
        from enginedj.connection import EngineDJDatabase
        engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))

    if config.database.rekordbox_path:
        rb_db = get_rekordbox_db()

    manager = TagSyncManager(db, engine_db, rb_db)
    stats = manager.get_stats()
    return stats


@router.post("/sync/engine", response_model=TagSyncStats)
def sync_tags_to_engine(
    request: TagSyncRequest,
    db: Session = Depends(get_db)
):
    """Sync manadj tags to Engine DJ as playlist hierarchy.

    Creates/updates "manadj Tags" > Category > Tag playlists.

    Args:
        request: Sync parameters (dry_run, fresh)
        db: manadj database session (injected)

    Returns:
        Statistics about the sync operation
    """
    config = get_config()

    if not config.database.engine_dj_path:
        raise HTTPException(status_code=400, detail="Engine DJ not configured")

    from enginedj.connection import EngineDJDatabase
    engine_db = EngineDJDatabase(Path(config.database.engine_dj_path))

    manager = TagSyncManager(db, engine_db=engine_db)
    stats = manager.sync_to_engine(
        dry_run=request.dry_run,
        fresh=request.fresh
    )

    return stats


@router.post("/sync/rekordbox", response_model=TagSyncStats)
def sync_tags_to_rekordbox(
    request: TagSyncRequest,
    db: Session = Depends(get_db)
):
    """Sync manadj tags to Rekordbox MyTag.

    Two-phase sync: structure + track assignments + colors.

    Args:
        request: Sync parameters (dry_run, include_energy)
        db: manadj database session (injected)

    Returns:
        Statistics about the sync operation
    """
    config = get_config()

    if not config.database.rekordbox_path:
        raise HTTPException(status_code=400, detail="Rekordbox not configured")

    rb_db = get_rekordbox_db()

    manager = TagSyncManager(db, rb_db=rb_db)
    stats = manager.sync_to_rekordbox(
        dry_run=request.dry_run,
        include_energy=request.include_energy
    )

    # Commit if not dry run
    if not request.dry_run:
        rb_db.commit(autoinc=True)

    return stats
