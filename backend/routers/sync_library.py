"""API endpoints for library track import."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..config import get_config
from ..library.import_manager import LibraryImportManager
from ..library.drop_import import drop_import
from ..library.models import (
    DropImportRequest, DropImportResult,
    LibraryImportResult, LibraryImportRequest,
    LibraryImportExecutionResult
)

router = APIRouter()


@router.get("/sync/library/candidates", response_model=LibraryImportResult)
def get_import_candidates(
    recursive: bool = False,
    db: Session = Depends(get_db)
):
    """Get list of tracks available for import from library."""
    config = get_config()

    if not config.library.tracks_directory:
        raise HTTPException(
            status_code=400,
            detail="Tracks directory is not set. Choose one in Settings → Library."
        )

    manager = LibraryImportManager(db, config.library.tracks_directory)
    return manager.get_import_candidates(recursive=recursive)


@router.post("/sync/library/import", response_model=LibraryImportExecutionResult)
def import_library_tracks(
    request: LibraryImportRequest,
    db: Session = Depends(get_db)
):
    """Import tracks from library into database."""
    config = get_config()

    if not config.library.tracks_directory:
        raise HTTPException(
            status_code=400,
            detail="Tracks directory is not set. Choose one in Settings → Library."
        )

    manager = LibraryImportManager(db, config.library.tracks_directory)

    # If specific candidates provided, reconstruct from filepaths
    candidates = None
    if request.candidate_filepaths:
        # Get full candidate list and filter
        all_candidates = manager.get_import_candidates()
        filepath_set = set(request.candidate_filepaths)
        candidates = [
            c for c in all_candidates.candidates
            if c.filepath in filepath_set
        ]

    return manager.import_tracks(candidates)


@router.post("/sync/library/drop-import", response_model=DropImportResult)
def drop_import_tracks(request: DropImportRequest, db: Session = Depends(get_db)):
    """Disk Import files/folders dropped from anywhere, in place (no copy).

    Independent of tracks_directory. Optionally appends the imported Tracks
    to `playlist_id`.
    """
    try:
        return drop_import(db, request.paths, request.playlist_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
