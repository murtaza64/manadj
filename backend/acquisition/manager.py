"""Acquisition manager: Refresh and Source Item queries.

manadj no longer downloads audio (gh#488/#489): Source Items are a
wishlist. Refresh only ever adds Source Items — removal upstream never
deletes local state, and existing items are never rewritten (see CONTEXT.md:
Refresh).
"""

import logging
from dataclasses import dataclass
from typing import cast

from sqlalchemy.exc import NoResultFound
from sqlalchemy.orm import Session

from ..models import Track
from ..track_metadata.file_facts import refresh_file_facts
from .classification import CLASSIFICATIONS, ClassificationConfig, classify
from .matching import MatchingConfig, duration_status, score_pair
from .models import SourceCorrespondence, SourceItem
from .source import Source

logger = logging.getLogger(__name__)


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
    matching_config: MatchingConfig | None = None,
) -> RefreshStats:
    """Fetch the Source's current items and persist the ones we've never seen.

    Also classifies every unclassified Source Item (new rows and NULL
    backfill; items with an existing Classification are never touched), then
    backfills Track durations and runs the matching pass.
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

    refresh_file_facts(db)
    run_matching(db, matching_config or MatchingConfig(), source_name=source_name)

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


def list_source_items(db: Session, source_name: str | None = "soundcloud") -> list[SourceItem]:
    """Source Items for a Source (None = every Source), most recently liked first."""
    query = db.query(SourceItem)
    if source_name is not None:
        query = query.filter(SourceItem.source == source_name)
    return query.order_by(SourceItem.liked_at.desc(), SourceItem.id.desc()).all()



@dataclass(frozen=True)
class MatchStats:
    auto_confirmed: int
    proposed: int


def run_matching(
    db: Session, config: MatchingConfig, source_name: str = "soundcloud"
) -> MatchStats:
    """The matching pass: propose/confirm Source Correspondences for new items.

    Items with any existing correspondence row (proposed, confirmed, or
    rejected) are skipped — rejections are remembered, never re-proposed.
    """
    items = (
        db.query(SourceItem)
        .filter(
            SourceItem.source == source_name,
            SourceItem.state == "new",
            ~SourceItem.id.in_(db.query(SourceCorrespondence.source_item_id)),
        )
        .all()
    )
    tracks = db.query(Track).all()

    auto_confirmed = 0
    proposed = 0
    for item in items:
        best_track: Track | None = None
        best_score = 0.0
        best_duration = "unknown"
        for track in tracks:
            # cast: legacy Column-style Track model confuses mypy at instance level
            dur = duration_status(
                item.duration_ms, cast(float | None, track.duration_secs), config
            )
            if dur == "mismatch":
                continue
            score = score_pair(
                item_title=item.title,
                item_uploader=item.uploader,
                track_title=cast(str | None, track.title),
                track_artist=cast(str | None, track.artist),
                track_filename=str(track.filename),
            )
            if score > best_score:
                best_track, best_score, best_duration = track, score, dur
        if best_track is None:
            continue
        if best_score >= config.auto_accept_score and best_duration == "exact":
            db.add(
                SourceCorrespondence(
                    source_item_id=item.id,
                    track_id=best_track.id,
                    status="confirmed",
                    score=best_score,
                )
            )
            item.state = "fulfilled"
            auto_confirmed += 1
        elif best_score >= config.proposal_score:
            db.add(
                SourceCorrespondence(
                    source_item_id=item.id,
                    track_id=best_track.id,
                    status="proposed",
                    score=best_score,
                )
            )
            proposed += 1
    db.commit()
    if auto_confirmed or proposed:
        logger.info("matching: %d auto-confirmed, %d proposed", auto_confirmed, proposed)
    return MatchStats(auto_confirmed=auto_confirmed, proposed=proposed)


def get_correspondence(db: Session, item_id: int) -> SourceCorrespondence | None:
    """The item's live correspondence (proposed or confirmed), if any."""
    return (
        db.query(SourceCorrespondence)
        .filter(
            SourceCorrespondence.source_item_id == item_id,
            SourceCorrespondence.status.in_(("proposed", "confirmed")),
        )
        .one_or_none()
    )


def accept_proposal(db: Session, item_id: int) -> SourceCorrespondence:
    """Confirm a proposed correspondence; the Source Item becomes fulfilled."""
    corr = get_correspondence(db, item_id)
    if corr is None or corr.status != "proposed":
        raise LookupError(f"source item {item_id} has no proposed correspondence")
    corr.status = "confirmed"
    db.query(SourceItem).filter(SourceItem.id == item_id).one().state = "fulfilled"
    db.commit()
    return corr


def reject_proposal(db: Session, item_id: int) -> None:
    """Reject a proposal. Remembered: matching never re-proposes this item."""
    corr = get_correspondence(db, item_id)
    if corr is None or corr.status != "proposed":
        raise LookupError(f"source item {item_id} has no proposed correspondence")
    corr.status = "rejected"
    db.commit()


def upsert_confirmed_correspondence(
    db: Session, item_id: int, track_id: int
) -> SourceCorrespondence:
    """Confirm a correspondence for the item, repointing any existing row
    (a proposal, or an earlier confirmation) — source_item_id is unique."""
    existing = (
        db.query(SourceCorrespondence)
        .filter(SourceCorrespondence.source_item_id == item_id)
        .one_or_none()
    )
    if existing is not None:
        existing.track_id = track_id
        existing.status = "confirmed"
        existing.score = None
        return existing
    corr = SourceCorrespondence(source_item_id=item_id, track_id=track_id, status="confirmed")
    db.add(corr)
    return corr


def link_item_to_track(
    db: Session, item_id: int, track_id: int, audio_from: str | None = None
) -> SourceCorrespondence:
    """Manually link a Source Item to a Track (escape hatch for missed matches).

    audio_from optionally asserts Audio Provenance for the Track's audio: a
    URL (origin label derived from its host) or a bare label like "cd-rip".
    """
    db.query(Track).filter(Track.id == track_id).one()  # existence check
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    corr = upsert_confirmed_correspondence(db, item_id, track_id)
    item.state = "fulfilled"

    if audio_from:
        _write_asserted_provenance(db, track_id, audio_from)
    db.commit()
    return corr


def _write_asserted_provenance(db: Session, track_id: int, audio_from: str) -> None:
    """Overwrite a Track's provenance with a user assertion.

    Recorded provenance (asserted=False) is manadj's own download receipt —
    ground truth, never overwritable by an assertion.
    """
    from .models import AudioProvenance
    from .provenance import derive_label, is_url

    existing = (
        db.query(AudioProvenance).filter(AudioProvenance.track_id == track_id).one_or_none()
    )
    if existing is not None and not existing.asserted:
        raise ValueError(
            f"track {track_id} has recorded provenance ({existing.source}) — "
            "manadj downloaded this audio itself; assertion refused"
        )
    if existing is not None:
        db.delete(existing)
        db.flush()
    if is_url(audio_from):
        db.add(
            AudioProvenance(
                track_id=track_id, source=derive_label(audio_from), url=audio_from, asserted=True
            )
        )
    else:
        db.add(AudioProvenance(track_id=track_id, source=audio_from.strip(), asserted=True))


def assert_provenance(db: Session, item_id: int, audio_from: str) -> None:
    """Set/update asserted provenance for a fulfilled item's Track."""
    corr = get_correspondence(db, item_id)
    if corr is None or corr.status != "confirmed":
        raise LookupError(f"source item {item_id} has no confirmed correspondence")
    _write_asserted_provenance(db, corr.track_id, audio_from)
    db.commit()


def link_track_by_url(db: Session, url: str, track_id: int) -> SourceCorrespondence:
    """Manually link from the Track end by pasting a Source permalink URL."""
    normalized = url.split("?")[0].rstrip("/")
    item = (
        db.query(SourceItem)
        .filter(SourceItem.permalink_url.in_((normalized, normalized + "/")))
        .one_or_none()
    )
    if item is None:
        raise LookupError(f"no source item with permalink {normalized!r} — refresh first?")
    return link_item_to_track(db, item.id, track_id)


def ignore_item(db: Session, item_id: int) -> SourceItem:
    """Mark an item ignored, from new. A legacy `queued` row (pre-removal,
    gh#488/#489) counts as new: no download path remains for it."""
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    if item.state in ("new", "queued"):
        item.state = "ignored"
        db.commit()
        return item
    raise ValueError(f"source item {item_id} is {item.state}; cannot ignore")


@dataclass(frozen=True)
class BulkStats:
    done: int
    skipped: int


def ignore_bulk(db: Session, item_ids: list[int]) -> BulkStats:
    """Ignore every ignorable item (new, or queued-and-failed); skip the rest."""
    done = skipped = 0
    for item_id in item_ids:
        try:
            ignore_item(db, item_id)
            done += 1
        except (ValueError, NoResultFound):
            skipped += 1
    return BulkStats(done=done, skipped=skipped)


def accept_bulk(db: Session, item_ids: list[int]) -> BulkStats:
    """Confirm every pending proposal among the ids; skip items without one."""
    done = skipped = 0
    for item_id in item_ids:
        try:
            accept_proposal(db, item_id)
            done += 1
        except LookupError:
            skipped += 1
    return BulkStats(done=done, skipped=skipped)


def restore_item(db: Session, item_id: int) -> SourceItem:
    """Bring an ignored item back to new."""
    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    if item.state != "ignored":
        raise ValueError(f"source item {item_id} is {item.state}; only ignored items restore")
    item.state = "new"
    db.commit()
    return item
