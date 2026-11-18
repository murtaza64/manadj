"""Acquisition API endpoints: the wishlist.

manadj no longer obtains audio itself (gh#488 Soulseek, gh#489 SoundCloud
download): a Source Item is a wishlist entry. The next step it offers is a
legit way to get the track — a Beatport search link built from the cleaned
metadata (gh#487) — and ownership is recorded by linking the item to a
library Track, with asserted Audio Provenance for where the audio came from.
"""

from datetime import timezone
from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from ..config import get_config
from ..database import get_db
from ..models import Track
from .cleanup import CleanupConfig, clean_metadata
from .lifecycle import derive_stage
from .manager import (
    accept_bulk,
    accept_proposal,
    assert_provenance,
    ignore_bulk,
    ignore_item,
    link_item_to_track,
    link_track_by_url,
    list_source_items,
    refresh,
    reject_proposal,
    restore_item,
    set_classification,
)
from .models import AudioProvenance, SourceCorrespondence, SourceItem
from .source import SoundCloudSource, Source

router = APIRouter()


def get_source() -> Source:
    """Dependency: the configured SoundCloud source. Overridden in tests."""
    token = get_config().soundcloud.oauth_token
    if not token:
        raise HTTPException(
            status_code=400,
            detail="SoundCloud isn't connected — connect it in Settings → SoundCloud.",
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
    # Audio Provenance of the corresponding Track, when one exists
    provenance: "ProvenanceInfo | None" = None
    # Beatport search link for the item (gh#487 wishlist): the legit next
    # step, built from Cleanup-derived artist/title so junk tokens don't
    # poison the query
    beatport_url: str | None = None
    # The lifecycle on the wire: new | fulfilled | ignored (a legacy `queued`
    # row presents as new — see lifecycle.derive_stage)
    stage: str = "new"

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
    # optional Audio Provenance assertion: a URL or a bare origin label
    audio_from: str | None = None


class ProvenanceInfo(BaseModel):
    label: str
    url: str | None
    asserted: bool
    acquired_at: str | None


class LinkByUrlRequest(BaseModel):
    url: str
    track_id: int


class BulkRequest(BaseModel):
    item_ids: list[int]


class BulkResponse(BaseModel):
    done: int
    skipped: int


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


def _provenance_map(db: Session) -> dict[int, ProvenanceInfo]:
    """track_id -> Audio Provenance info. acquired_at is stored naive-UTC;
    serialize with an explicit offset so clients can render local time."""
    return {
        p.track_id: ProvenanceInfo(
            label=p.source,
            url=p.url,
            asserted=p.asserted,
            acquired_at=(
                p.acquired_at.replace(tzinfo=timezone.utc).isoformat() if p.acquired_at else None
            ),
        )
        for p in db.query(AudioProvenance).all()
    }


def _beatport_url(item: SourceItem, cleanup: CleanupConfig) -> str:
    """Beatport search link for the item's cleaned metadata (gh#487)."""
    meta = clean_metadata(item.title, item.uploader, cleanup)
    query = f"{meta.artist} {meta.title}" if meta.artist else meta.title
    return f"https://www.beatport.com/search?q={quote_plus(query.strip() or item.title)}"


@router.get("/items", response_model=list[SourceItemResponse])
def get_source_items(
    source: str | None = None, db: Session = Depends(get_db)
) -> list[SourceItemResponse]:
    """Source Items of every Source (or one, with ?source=), newest first."""
    return item_responses(db, list_source_items(db, source))


def item_responses(db: Session, items: list[SourceItem]) -> list[SourceItemResponse]:
    """Wire shapes for Source Items: correspondence and provenance joined."""
    correspondences = _correspondence_map(db)
    provenances = _provenance_map(db)
    cleanup = get_config().acquisition.cleanup
    responses = []
    for item in items:
        resp = SourceItemResponse.model_validate(item)
        resp.correspondence = correspondences.get(item.id)
        resp.beatport_url = _beatport_url(item, cleanup)
        if resp.correspondence is not None:
            resp.provenance = provenances.get(resp.correspondence.track_id)
        resp.stage = derive_stage(resp.state)
        responses.append(resp)
    return responses


def _item_response(db: Session, item_id: int) -> SourceItemResponse:
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    return item_responses(db, [item])[0]


@router.post("/items/ignore-bulk", response_model=BulkResponse)
def ignore_bulk_items(body: BulkRequest, db: Session = Depends(get_db)) -> BulkResponse:
    stats = ignore_bulk(db, body.item_ids)
    return BulkResponse(done=stats.done, skipped=stats.skipped)


@router.post("/items/accept-match-bulk", response_model=BulkResponse)
def accept_match_bulk(body: BulkRequest, db: Session = Depends(get_db)) -> BulkResponse:
    stats = accept_bulk(db, body.item_ids)
    return BulkResponse(done=stats.done, skipped=stats.skipped)


@router.post("/items/{item_id}/ignore", response_model=SourceItemResponse)
def ignore_source_item(item_id: int, db: Session = Depends(get_db)) -> SourceItemResponse:
    try:
        ignore_item(db, item_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except NoResultFound:
        raise HTTPException(status_code=404, detail="source item not found")
    return _item_response(db, item_id)


@router.post("/items/{item_id}/restore", response_model=SourceItemResponse)
def restore_source_item(item_id: int, db: Session = Depends(get_db)) -> SourceItemResponse:
    try:
        restore_item(db, item_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except NoResultFound:
        raise HTTPException(status_code=404, detail="source item not found")
    return _item_response(db, item_id)


class ProvenanceUpdate(BaseModel):
    audio_from: str


@router.post("/items/{item_id}/provenance", response_model=SourceItemResponse)
def set_provenance(
    item_id: int, body: ProvenanceUpdate, db: Session = Depends(get_db)
) -> SourceItemResponse:
    """Set/update asserted provenance on a fulfilled item's Track."""
    try:
        assert_provenance(db, item_id, body.audio_from)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _item_response(db, item_id)


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
        link_item_to_track(db, item_id, body.track_id, audio_from=body.audio_from)
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
    return _item_response(db, item.id)
