"""Acquisition API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from ..config import get_config
from ..database import get_db
from ..models import Track
from .manager import (
    accept_proposal,
    link_item_to_track,
    link_track_by_url,
    list_source_items,
    refresh,
    reject_proposal,
    set_classification,
)
from .models import SourceCorrespondence, SourceItem
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
    correspondence: "CorrespondenceInfo | None" = None

    model_config = {"from_attributes": True}


class ClassificationUpdate(BaseModel):
    classification: str


class CorrespondenceInfo(BaseModel):
    track_id: int
    status: str
    score: float | None
    track_title: str | None
    track_artist: str | None
    track_duration_secs: float | None


class LinkRequest(BaseModel):
    track_id: int


class LinkByUrlRequest(BaseModel):
    url: str
    track_id: int


@router.post("/refresh", response_model=RefreshResponse)
def refresh_source_items(
    db: Session = Depends(get_db), source: Source = Depends(get_source)
) -> RefreshResponse:
    stats = refresh(db, source, classification_config=get_config().acquisition.classification)
    return RefreshResponse(
        added=stats.added, total_remote=stats.total_remote, total_local=stats.total_local
    )


def _correspondence_map(db: Session) -> dict[int, CorrespondenceInfo]:
    """source_item_id -> live correspondence info, tracks joined in one query."""
    rows = (
        db.query(SourceCorrespondence, Track)
        .join(Track, SourceCorrespondence.track_id == Track.id)
        .filter(SourceCorrespondence.status.in_(("proposed", "confirmed")))
        .all()
    )
    return {
        corr.source_item_id: CorrespondenceInfo(
            track_id=track.id,
            status=corr.status,
            score=corr.score,
            track_title=track.title,
            track_artist=track.artist,
            track_duration_secs=track.duration_secs,
        )
        for corr, track in rows
    }


@router.get("/items", response_model=list[SourceItemResponse])
def get_source_items(db: Session = Depends(get_db)) -> list[SourceItemResponse]:
    correspondences = _correspondence_map(db)
    responses = []
    for item in list_source_items(db):
        resp = SourceItemResponse.model_validate(item)
        resp.correspondence = correspondences.get(item.id)
        responses.append(resp)
    return responses


def _item_response(db: Session, item_id: int) -> SourceItemResponse:
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    resp = SourceItemResponse.model_validate(item)
    resp.correspondence = _correspondence_map(db).get(item.id)
    return resp


@router.post("/items/{item_id}/accept-match", response_model=SourceItemResponse)
def accept_match(item_id: int, db: Session = Depends(get_db)) -> SourceItemResponse:
    try:
        accept_proposal(db, item_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _item_response(db, item_id)


@router.post("/items/{item_id}/reject-match", response_model=SourceItemResponse)
def reject_match(item_id: int, db: Session = Depends(get_db)) -> SourceItemResponse:
    try:
        reject_proposal(db, item_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _item_response(db, item_id)


@router.post("/items/{item_id}/link", response_model=SourceItemResponse)
def link_item(item_id: int, body: LinkRequest, db: Session = Depends(get_db)) -> SourceItemResponse:
    try:
        link_item_to_track(db, item_id, body.track_id)
    except NoResultFound:
        raise HTTPException(status_code=404, detail="source item or track not found")
    return _item_response(db, item_id)


@router.post("/link-by-url", response_model=SourceItemResponse)
def link_by_url(body: LinkByUrlRequest, db: Session = Depends(get_db)) -> SourceItemResponse:
    try:
        corr = link_track_by_url(db, body.url, body.track_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _item_response(db, corr.source_item_id)


@router.patch("/items/{item_id}/classification", response_model=SourceItemResponse)
def override_classification(
    item_id: int, body: ClassificationUpdate, db: Session = Depends(get_db)
) -> SourceItemResponse:
    try:
        item = set_classification(db, item_id, body.classification)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return SourceItemResponse.model_validate(item)
