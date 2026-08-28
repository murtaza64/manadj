"""Remembered Soulseek searches (gh#216).

Every search — operator-initiated or automatic — is persisted per Source
Item (query + shaped results), so selecting an item hydrates the picker
instantly instead of re-searching peers (~20s), and the hands-off download
(gh#214) has a candidate list to snapshot from.

The `soulseek-search` task is the automatic path: enqueued when a SoundCloud
download fails terminally, it runs the Cleanup-derived default query and
remembers the results. It never clobbers an existing remembered search — an
operator's hand-tuned query outranks the default.
"""

import json
import logging
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from .cleanup import CleanupConfig, clean_metadata
from .models import SoulseekSearch, SourceItem
from .picker import ShapedResult, shape_results
from .supplier import SearchSupplier

if TYPE_CHECKING:
    from ..tasks.models import Task

logger = logging.getLogger(__name__)

SOULSEEK_SEARCH_TASK_TYPE = "soulseek-search"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def default_search_query(item: SourceItem, cleanup: CleanupConfig | None = None) -> str:
    """The Cleanup-derived default query for Search Supplier pickers."""
    meta = clean_metadata(item.title, item.uploader, cleanup or CleanupConfig())
    return f"{meta.artist} {meta.title}" if meta.artist else meta.title


def shaped_to_dicts(shaped: list[ShapedResult]) -> list[dict[str, Any]]:
    """Picker-facing candidate dicts (the SoulseekResult wire shape)."""
    return [
        {**vars(s.result), "duration_delta_ms": s.duration_delta_ms} for s in shaped
    ]


def remember_search(
    db: Session, item_id: int, query: str, results: list[dict[str, Any]]
) -> SoulseekSearch:
    """Upsert the remembered search for an item; every search overwrites."""
    row = (
        db.query(SoulseekSearch).filter(SoulseekSearch.source_item_id == item_id).first()
    )
    if row is None:
        row = SoulseekSearch(source_item_id=item_id)
        db.add(row)
    row.query = query  # type: ignore[assignment]
    row.results_json = json.dumps(results)  # type: ignore[assignment]
    row.searched_at = _utcnow()  # type: ignore[assignment]
    db.commit()
    return row


def remembered_search(db: Session, item_id: int) -> SoulseekSearch | None:
    return (
        db.query(SoulseekSearch).filter(SoulseekSearch.source_item_id == item_id).first()
    )


def remembered_results(row: SoulseekSearch) -> list[dict[str, Any]]:
    return json.loads(row.results_json)


def enqueue_soulseek_search(db: Session, item: SourceItem) -> "Task | None":
    """Queue an automatic default-query search for an item, if useful.

    Called when a SoundCloud download fails terminally (gh#216). Skipped when
    a remembered search already exists (never clobber the operator's) or an
    automatic search is already in flight. Commits via create_task.
    """
    from ..tasks.manager import create_task, list_tasks

    if remembered_search(db, item.id) is not None:
        return None
    ref = f"source_item:{item.id}:soulseek-search"
    for task in list_tasks(db, ref=ref):
        if task.state in ("pending", "running"):
            return None
    logger.info("queueing automatic soulseek search for item %d", item.id)
    return create_task(db, SOULSEEK_SEARCH_TASK_TYPE, {"source_item_id": item.id}, ref=ref)


def soulseek_search_handler(
    supplier: SearchSupplier, cleanup_config: CleanupConfig | None = None
) -> Callable[[Session, dict[str, Any]], None]:
    """Build the task handler for `soulseek-search` tasks."""

    def handle(db: Session, payload: dict[str, Any]) -> None:
        item = db.query(SourceItem).filter(SourceItem.id == payload["source_item_id"]).one()
        if item.state in ("fulfilled", "ignored"):
            return  # no longer needs sourcing
        if remembered_search(db, item.id) is not None:
            return  # the operator (or an earlier task) got there first
        query = default_search_query(item, cleanup_config)
        shaped = shape_results(supplier.search(query), item.duration_ms)
        remember_search(db, item.id, query, shaped_to_dicts(shaped))
        logger.info(
            "auto soulseek search for item %d (%r): %d candidates",
            item.id,
            query,
            len(shaped),
        )

    return handle
