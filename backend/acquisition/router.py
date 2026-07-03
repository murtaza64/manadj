"""Acquisition API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_config
from ..database import get_db
from .classification import CLASSIFICATIONS
from .manager import list_source_items, refresh, set_classification
from .source import SoundCloudSource, Source

router = APIRouter()


def get_source() -> Source:
    """Dependency: the configured SoundCloud source. Overridden in tests."""
    token = get_config().soundcloud.oauth_token
    if not token:
        raise HTTPException(
            status_code=400,
            detail="SoundCloud oauth_token not configured in config.toml [soundcloud]",
        )
    return SoundCloudSource(token)


class RefreshResponse(BaseModel):
    added: int
    total_remote: int
    total_local: int


class SourceItemResponse(BaseModel):
    id: int
    source: str
    external_id: str
    title: str
    uploader: str
    duration_ms: int
    permalink_url: str
    state: str
    classification: str | None
    liked_at: str | None

    model_config = {"from_attributes": True}


class ClassificationUpdate(BaseModel):
    classification: str


@router.post("/refresh", response_model=RefreshResponse)
def refresh_source_items(
    db: Session = Depends(get_db), source: Source = Depends(get_source)
) -> RefreshResponse:
    stats = refresh(db, source, classification_config=get_config().acquisition.classification)
    return RefreshResponse(
        added=stats.added, total_remote=stats.total_remote, total_local=stats.total_local
    )


@router.get("/items", response_model=list[SourceItemResponse])
def get_source_items(db: Session = Depends(get_db)) -> list[SourceItemResponse]:
    return [SourceItemResponse.model_validate(i) for i in list_source_items(db)]


@router.patch("/items/{item_id}/classification", response_model=SourceItemResponse)
def override_classification(
    item_id: int, body: ClassificationUpdate, db: Session = Depends(get_db)
) -> SourceItemResponse:
    if body.classification not in CLASSIFICATIONS:
        raise HTTPException(
            status_code=422,
            detail=f"classification must be one of {list(CLASSIFICATIONS)}",
        )
    return SourceItemResponse.model_validate(set_classification(db, item_id, body.classification))
