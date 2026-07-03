"""Unified sync status endpoint (see .scratch/unified-sync-view/PRD.md)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.sync_status import compute_sync_status
from backend.sync_status.adapters import build_surfaces

router = APIRouter(prefix="/sync/status", tags=["sync"])


@router.get("/")
def get_sync_status(db: Session = Depends(get_db)):
    """One row per track matched across Surfaces, plus rollup counts.
    Surfaces that are unreachable are simply absent (their presence reads
    as missing)."""
    surfaces = build_surfaces()
    result = compute_sync_status(db, surfaces)  # type: ignore[arg-type]
    return {
        "surfaces_available": sorted(surfaces),
        "counts": result.counts,
        "rows": result.rows,
    }
