"""Acquisition API endpoints."""

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from ..config import get_config
from ..database import get_db
from ..models import Track
from ..tasks.manager import list_tasks
from .manager import (
    accept_proposal,
    assert_provenance,
    ignore_item,
    link_item_to_track,
    link_track_by_url,
    list_source_items,
    queue_bulk,
    queue_item,
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
    download: "DownloadStatus | None" = None
    # Audio Provenance of the corresponding Track, when one exists
    provenance: "ProvenanceInfo | None" = None

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


class DownloadStatus(BaseModel):
    task_state: str
    error: str | None


class BulkQueueRequest(BaseModel):
    item_ids: list[int]


class BulkQueueResponse(BaseModel):
    queued: int
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


def _download_map(db: Session) -> dict[int, DownloadStatus]:
    """source_item_id -> latest download-task status."""
    statuses: dict[int, DownloadStatus] = {}
    from ..tasks.models import Task

    for task in db.query(Task).filter(Task.type == "download").order_by(Task.id).all():
        if task.ref and task.ref.startswith("source_item:"):
            statuses[int(task.ref.split(":", 1)[1])] = DownloadStatus(
                task_state=task.state, error=task.error
            )
    return statuses


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


@router.get("/items", response_model=list[SourceItemResponse])
def get_source_items(db: Session = Depends(get_db)) -> list[SourceItemResponse]:
    correspondences = _correspondence_map(db)
    downloads = _download_map(db)
    provenances = _provenance_map(db)
    responses = []
    for item in list_source_items(db):
        resp = SourceItemResponse.model_validate(item)
        resp.correspondence = correspondences.get(item.id)
        resp.download = downloads.get(item.id)
        if resp.correspondence is not None:
            resp.provenance = provenances.get(resp.correspondence.track_id)
        responses.append(resp)
    return responses


def _item_response(db: Session, item_id: int) -> SourceItemResponse:
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    resp = SourceItemResponse.model_validate(item)
    resp.correspondence = _correspondence_map(db).get(item.id)
    if resp.correspondence is not None:
        resp.provenance = _provenance_map(db).get(resp.correspondence.track_id)
    tasks = list_tasks(db, ref=f"source_item:{item_id}")
    if tasks:
        resp.download = DownloadStatus(task_state=tasks[0].state, error=tasks[0].error)
    return resp


@router.post("/items/{item_id}/queue", response_model=SourceItemResponse)
def queue_download(item_id: int, db: Session = Depends(get_db)) -> SourceItemResponse:
    try:
        queue_item(db, item_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except NoResultFound:
        raise HTTPException(status_code=404, detail="source item not found")
    return _item_response(db, item_id)


@router.post("/items/queue-bulk", response_model=BulkQueueResponse)
def queue_bulk_downloads(body: BulkQueueRequest, db: Session = Depends(get_db)) -> BulkQueueResponse:
    stats = queue_bulk(db, body.item_ids)
    return BulkQueueResponse(queued=stats.queued, skipped=stats.skipped)


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
    return SourceItemResponse.model_validate(item)
