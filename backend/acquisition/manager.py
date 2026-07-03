"""Acquisition manager: Refresh and Source Item queries.

Refresh only ever adds Source Items — removal upstream never deletes local
state, and existing items are never rewritten (see CONTEXT.md: Refresh).
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from .classification import CLASSIFICATIONS, ClassificationConfig, classify
from .models import SourceItem
from .source import Source


@dataclass(frozen=True)
class RefreshStats:
    added: int
    total_remote: int
    total_local: int


def refresh(
    db: Session,
    source: Source,
    source_name: str = "soundcloud",
    classification_config: ClassificationConfig | None = None,
) -> RefreshStats:
    """Fetch the Source's current items and persist the ones we've never seen.

    Also classifies every unclassified Source Item (new rows and NULL
    backfill); items with an existing Classification are never touched.
    """
    cfg = classification_config or ClassificationConfig()
    remote_items = source.list_items()

    existing_ids: set[str] = {
        row[0]
        for row in db.query(SourceItem.external_id).filter(SourceItem.source == source_name).all()
    }

    added = 0
    for data in remote_items:
        if data.external_id in existing_ids:
            continue
        db.add(
            SourceItem(
                source=source_name,
                external_id=data.external_id,
                title=data.title,
                uploader=data.uploader,
                duration_ms=data.duration_ms,
                permalink_url=data.permalink_url,
                liked_at=data.liked_at,
            )
        )
        existing_ids.add(data.external_id)
        added += 1
    db.flush()  # sessions run with autoflush=False; new rows must be visible below

    unclassified = (
        db.query(SourceItem)
        .filter(SourceItem.source == source_name, SourceItem.classification.is_(None))
        .all()
    )
    for item in unclassified:
        item.classification = classify(item.title, item.duration_ms, cfg)
    db.commit()

    total_local = db.query(SourceItem).filter(SourceItem.source == source_name).count()
    return RefreshStats(added=added, total_remote=len(remote_items), total_local=total_local)


def set_classification(db: Session, item_id: int, classification: str) -> SourceItem:
    """Override a Source Item's Classification. Overrides win: Refresh never rewrites."""
    if classification not in CLASSIFICATIONS:
        raise ValueError(
            f"invalid classification {classification!r}; expected one of {CLASSIFICATIONS}"
        )
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    item.classification = classification
    db.commit()
    return item


def list_source_items(db: Session, source_name: str = "soundcloud") -> list[SourceItem]:
    """All Source Items for a Source, most recently liked first."""
    return (
        db.query(SourceItem)
        .filter(SourceItem.source == source_name)
        .order_by(SourceItem.liked_at.desc())
        .all()
    )
