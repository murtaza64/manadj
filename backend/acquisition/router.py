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
from .cleanup import clean_metadata
from .download import pick_supplier_result
from .models import AudioProvenance, SourceCorrespondence, SourceItem
from .source import SoundCloudSource, Source
from .supplier import SearchSupplier, SupplierSearchResult

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


def get_soulseek_supplier() -> "SearchSupplier | None":
    """Dependency: the Soulseek Supplier, or None when unconfigured.

    None means the Supplier is absent entirely — no UI affordance, 404 from
    its routes (PRD story 10). Overridden in tests.
    """
    cfg = get_config().soulseek
    if not cfg.configured:
        return None
    from .slskd import SlskdSupplier

    assert cfg.slskd_url is not None and cfg.api_key is not None
    return SlskdSupplier(cfg.slskd_url, cfg.api_key)


def _require_soulseek(supplier: "SearchSupplier | None") -> SearchSupplier:
    if supplier is None:
        raise HTTPException(
            status_code=404,
            detail="Soulseek Supplier not configured ([soulseek] slskd_url + SLSKD_API_KEY)",
        )
    return supplier


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
    # Cleanup-derived default query for Search Supplier pickers (editable
    # client-side; junk tokens would poison peer search)
    search_query: str | None = None

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
    # ISO-8601 UTC deferral floor when a pending task is cooling down after a
    # rate-limit (issue 08); None unless deferred into the future.
    cooling_down_until: str | None = None
    # which Supplier is delivering the audio: "soundcloud" | "soulseek"
    via: str = "soundcloud"


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


def _cooling_down_until(task: "Task") -> str | None:
    """ISO-8601 UTC when a pending, future-deferred task resumes; else None."""
    from datetime import datetime, timezone

    if task.state != "pending" or task.not_before is None:
        return None
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if task.not_before <= now:
        return None
    return task.not_before.replace(tzinfo=timezone.utc).isoformat()


DOWNLOAD_TASK_TYPES = ("download", "soulseek-download")


def _via(task: "Task") -> str:
    return "soulseek" if task.type == "soulseek-download" else "soundcloud"


def _download_map(db: Session) -> dict[int, DownloadStatus]:
    """source_item_id -> latest download-task status (either Supplier)."""
    statuses: dict[int, DownloadStatus] = {}
    from ..tasks.models import Task

    for task in (
        db.query(Task).filter(Task.type.in_(DOWNLOAD_TASK_TYPES)).order_by(Task.id).all()
    ):
        if task.ref and task.ref.startswith("source_item:"):
            statuses[int(task.ref.split(":", 1)[1])] = DownloadStatus(
                task_state=task.state,
                error=task.error,
                cooling_down_until=_cooling_down_until(task),
                via=_via(task),
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


def _search_query(item: SourceItem) -> str:
    """The Cleanup-derived default query for Search Supplier pickers."""
    meta = clean_metadata(item.title, item.uploader, get_config().acquisition.cleanup)
    return f"{meta.artist} {meta.title}" if meta.artist else meta.title


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
        resp.search_query = _search_query(item)
        if resp.correspondence is not None:
            resp.provenance = provenances.get(resp.correspondence.track_id)
        responses.append(resp)
    return responses


def _item_response(db: Session, item_id: int) -> SourceItemResponse:
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    resp = SourceItemResponse.model_validate(item)
    resp.correspondence = _correspondence_map(db).get(item.id)
    resp.search_query = _search_query(item)
    if resp.correspondence is not None:
        resp.provenance = _provenance_map(db).get(resp.correspondence.track_id)
    tasks = [t for t in list_tasks(db, ref=f"source_item:{item_id}") if t.type in DOWNLOAD_TASK_TYPES]
    if tasks:
        resp.download = DownloadStatus(
            task_state=tasks[0].state,
            error=tasks[0].error,
            cooling_down_until=_cooling_down_until(tasks[0]),
            via=_via(tasks[0]),
        )
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


# --- Suppliers (soulseek-supplier issue 03) ---------------------------------


class SupplierInfo(BaseModel):
    id: str
    kind: str  # "direct" | "search"


class SoulseekSearchRequest(BaseModel):
    # None/empty => use the Cleanup-derived default query
    query: str | None = None


class SoulseekResult(BaseModel):
    """One candidate file, shaped for the picker (PRD story 4)."""

    download_token: str
    filename: str
    format: str
    bitrate_kbps: int | None
    size_bytes: int | None
    duration_ms: int | None
    queue_length: int | None


class SoulseekSearchResponse(BaseModel):
    query: str  # the query actually searched (echoes the default when unset)
    results: list[SoulseekResult]


@router.get("/suppliers", response_model=list[SupplierInfo])
def list_suppliers(
    supplier: "SearchSupplier | None" = Depends(get_soulseek_supplier),
) -> list[SupplierInfo]:
    """The configured Suppliers. An unconfigured Supplier is absent, not
    disabled — the UI shows no affordance for it (PRD story 10)."""
    suppliers: list[SupplierInfo] = []
    if get_config().soundcloud.oauth_token:
        suppliers.append(SupplierInfo(id="soundcloud", kind="direct"))
    if supplier is not None:
        suppliers.append(SupplierInfo(id="soulseek", kind="search"))
    return suppliers


@router.post("/items/{item_id}/soulseek/search", response_model=SoulseekSearchResponse)
def soulseek_search(
    item_id: int,
    body: SoulseekSearchRequest,
    db: Session = Depends(get_db),
    supplier: "SearchSupplier | None" = Depends(get_soulseek_supplier),
) -> SoulseekSearchResponse:
    """Search Soulseek for candidates for an unfulfilled item."""
    sup = _require_soulseek(supplier)
    try:
        item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    except NoResultFound:
        raise HTTPException(status_code=404, detail="source item not found")
    query = (body.query or "").strip() or _search_query(item)
    results = sup.search(query)
    return SoulseekSearchResponse(
        query=query,
        results=[SoulseekResult(**vars(r)) for r in results],
    )


@router.post("/items/{item_id}/soulseek/pick", response_model=SourceItemResponse)
def soulseek_pick(
    item_id: int,
    body: SoulseekResult,
    db: Session = Depends(get_db),
    supplier: "SearchSupplier | None" = Depends(get_soulseek_supplier),
) -> SourceItemResponse:
    """The operator picked a candidate: start the transfer, queue the task."""
    sup = _require_soulseek(supplier)
    result = SupplierSearchResult(**body.model_dump())
    try:
        pick_supplier_result(db, item_id, sup, result)
    except NoResultFound:
        raise HTTPException(status_code=404, detail="source item not found")
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _item_response(db, item_id)
