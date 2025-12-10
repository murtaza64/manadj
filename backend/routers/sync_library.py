"""API endpoints for library track import."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..config import get_config
from ..library.import_manager import LibraryImportManager
from ..library.models import (
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
            detail="Library tracks_directory not configured in config.toml"
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
            detail="Library tracks_directory not configured in config.toml"
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
