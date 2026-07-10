"""The download tasks: Supplier audio -> tracks directory -> Track.

The chain (issue 05): Cleanup names the file, the Supplier delivers it, the
normal Disk Import path creates the Track, then Source Correspondence +
Audio Provenance are recorded and the Source Item becomes fulfilled.

Two task types share that chain and differ only in how the bytes arrive:

- `download` (Direct Supplier, SoundCloud): the handler downloads straight
  into the tracks directory via the base `Supplier` seam.
- `soulseek-download` (Search Supplier): the operator's pick already asked
  the peer for the file (`pick_supplier_result`); the handler polls the
  transfer per worker tick — no blocking waits — and on completion moves the
  staged file into the tracks directory. A hard TTL from pick time fails
  stuck transfers; failure returns the item to searchable state (candidates
  are ephemeral — no stored pick, no retry of a pick).
"""

import logging
import shutil
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from ..library.import_manager import LibraryImportManager
from ..models import Track
from ..track_metadata import FileMetadataError, write_file_metadata
from ..track_metadata.file_facts import refresh_file_facts
from .cleanup import CleanedMetadata, CleanupConfig, clean_metadata, safe_basename
from .manager import upsert_confirmed_correspondence
from .models import AudioProvenance, SourceItem
from .supplier import SearchSupplier, Supplier, SupplierSearchResult, TransferState

if TYPE_CHECKING:
    from ..tasks.models import Task

logger = logging.getLogger(__name__)

SOULSEEK_TASK_TYPE = "soulseek-download"
# Hard TTL for a picked transfer, measured from task creation regardless of
# transfer state (PRD: transfers finish in minutes once started).
SOULSEEK_TTL = timedelta(hours=24)
# How long the handler defers between transfer-state polls.
SOULSEEK_POLL_SECS = 15.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _adoptable_orphan(db: Session, tracks_dir: Path, basename: str) -> Path | None:
    """A `basename.*` collision left by a crashed previous attempt, if any.

    A collision file already owned by a Track is a missed correspondence —
    an error, not silent adoption.
    """
    collisions = list(tracks_dir.glob(f"{basename}.*"))
    if not collisions:
        return None
    referenced = (
        db.query(Track).filter(Track.filename.in_([str(c) for c in collisions])).first()
    )
    if referenced is not None:
        raise FileExistsError(
            f"file already exists for {basename!r}: {collisions[0].name} "
            "— probably a missed correspondence; link it manually or remove the file"
        )
    logger.info("adopting orphaned file from previous attempt: %s", collisions[0])
    return collisions[0]


def _finish_acquisition(
    db: Session,
    item: SourceItem,
    path: Path,
    meta: CleanedMetadata,
    tracks_dir: Path,
    provenance: AudioProvenance,
) -> None:
    """The shared tail of every acquisition: file on disk -> fulfilled item.

    Embeds cleaned tags (best-effort), runs the normal Disk Import path,
    asserts Cleanup output on the Track, records Correspondence + the given
    Provenance row, and marks the item fulfilled.
    """
    # Export the cleaned metadata to Disk before the import scan: the
    # file carries what the Library will assert, and Disk Import + file
    # facts see the final bytes. Best-effort — a file mutagen can't tag
    # must not lose the acquisition.
    try:
        write_file_metadata(path, title=meta.title, artist=meta.artist)
    except FileMetadataError as e:
        logger.warning("could not embed metadata in %s: %s", path, e)

    # the normal Disk Import path (no parallel track-creation code)
    importer = LibraryImportManager(db, str(tracks_dir))
    candidates = [
        c for c in importer.get_import_candidates().candidates if Path(c.filepath) == path
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"downloaded file {path.name!r} not found by Disk Import scan")
    # provenance is recorded below by this handler — don't derive
    result = importer.import_tracks(candidates, derive_provenance=False)
    if result.errors:
        raise RuntimeError(f"Disk Import failed: {'; '.join(result.error_messages)}")

    track = db.query(Track).filter(Track.filename == str(path)).one()
    # Cleanup output is authoritative for a fresh acquisition
    track.title = meta.title  # type: ignore[assignment]
    track.artist = meta.artist  # type: ignore[assignment]
    refresh_file_facts(db)

    # repoints any existing proposal — INSERTing here crashed on the
    # unique source_item_id when the operator downloaded despite a match
    upsert_confirmed_correspondence(db, item.id, track.id)
    provenance.track_id = track.id
    db.add(provenance)
    item.state = "fulfilled"
    db.commit()
    logger.info("acquired %s - %s (track %d)", meta.artist, meta.title, track.id)


def download_handler(
    supplier: Supplier,
    tracks_dir: Path,
    cleanup_config: CleanupConfig | None = None,
) -> Callable[[Session, dict[str, Any]], None]:
    """Build the task handler for `download` tasks (Direct Supplier)."""
    cleanup = cleanup_config or CleanupConfig()

    def handle(db: Session, payload: dict[str, Any]) -> None:
        item = db.query(SourceItem).filter(SourceItem.id == payload["source_item_id"]).one()

        meta = clean_metadata(item.title, item.uploader, cleanup)
        basename = safe_basename(meta.artist, meta.title)

        path = _adoptable_orphan(db, tracks_dir, basename)
        if path is None:
            path = supplier.download(item.permalink_url, tracks_dir, basename)
            logger.info("downloaded %s -> %s", item.permalink_url, path)

        _finish_acquisition(
            db,
            item,
            path,
            meta,
            tracks_dir,
            AudioProvenance(
                source=item.source,
                external_id=item.external_id,
                url=item.permalink_url,
                asserted=False,
            ),
        )

    return handle


def pick_supplier_result(
    db: Session,
    item_id: int,
    supplier: SearchSupplier,
    result: SupplierSearchResult,
    ttl: timedelta = SOULSEEK_TTL,
) -> "Task":
    """The operator picked a search candidate: start the transfer, queue the task.

    Asks the peer for the file immediately (candidates are ephemeral — there
    is no stored pick to retry later) and creates a `soulseek-download` task
    that polls the transfer. The peer/remote-filename live in the task log
    only (PRD caveat 1).
    """
    from ..tasks.manager import create_task, list_tasks

    item = db.query(SourceItem).filter(SourceItem.id == item_id).one()
    if item.state not in ("new", "queued"):
        raise ValueError(f"source item {item_id} is {item.state}; cannot pick for it")
    ref = f"source_item:{item_id}"
    for task in list_tasks(db, ref=ref):
        if task.state in ("pending", "running"):
            raise ValueError(
                f"source item {item_id} already has a {task.type} task in flight"
            )

    transfer_id = supplier.request(result)
    logger.info(
        "soulseek pick for item %d: %s (token %s) -> transfer %s",
        item_id,
        result.filename,
        result.download_token,
        transfer_id,
    )
    task = create_task(
        db,
        SOULSEEK_TASK_TYPE,
        {
            "source_item_id": item_id,
            "transfer_id": transfer_id,
            "filename": result.filename,
            "deadline": (_utcnow() + ttl).isoformat(),
        },
        ref=ref,
    )
    item.state = "queued"
    db.commit()
    return task


def soulseek_download_handler(
    supplier: SearchSupplier,
    tracks_dir: Path,
    cleanup_config: CleanupConfig | None = None,
) -> Callable[[Session, dict[str, Any]], None]:
    """Build the task handler for `soulseek-download` tasks (Search Supplier).

    One non-blocking step per run: adopt a crashed attempt's file if present;
    enforce the hard TTL; otherwise poll the transfer and either finish the
    chain, fail, or defer until the next tick.
    """
    from ..tasks.manager import Deferred

    cleanup = cleanup_config or CleanupConfig()

    def handle(db: Session, payload: dict[str, Any]) -> None:
        item = db.query(SourceItem).filter(SourceItem.id == payload["source_item_id"]).one()

        meta = clean_metadata(item.title, item.uploader, cleanup)
        basename = safe_basename(meta.artist, meta.title)

        def finish(path: Path) -> None:
            # label-only recorded row: Soulseek has no stable addresses
            # (no URL, no external ID) — glossary-sanctioned.
            _finish_acquisition(
                db,
                item,
                path,
                meta,
                tracks_dir,
                AudioProvenance(source="soulseek", asserted=False),
            )

        # crashed-attempt recovery: the file was already moved into the
        # tracks directory but the Track never landed — adopt it
        adopted = _adoptable_orphan(db, tracks_dir, basename)
        if adopted is not None:
            finish(adopted)
            return

        if _utcnow() >= datetime.fromisoformat(payload["deadline"]):
            hours = SOULSEEK_TTL.total_seconds() / 3600
            raise RuntimeError(
                f"soulseek download not completed within {hours:g}h of the pick "
                f"({payload['filename']!r}) — search and pick again"
            )

        status = supplier.transfer_status(payload["transfer_id"])
        if status.state in (TransferState.QUEUED, TransferState.IN_PROGRESS):
            raise Deferred(SOULSEEK_POLL_SECS, f"transfer {status.state.value}")
        if status.state is TransferState.FAILED:
            raise RuntimeError(
                f"soulseek transfer failed ({payload['filename']!r}) — "
                "search and pick again"
            )

        # completed: move the staged file to the tracks directory under the
        # Cleanup basename, extension from the picked file
        if status.local_path is None:
            raise RuntimeError(
                f"soulseek transfer completed but the downloaded file could not "
                f"be located ({payload['filename']!r})"
            )
        suffix = Path(payload["filename"].replace("\\", "/")).suffix
        dest = tracks_dir / f"{basename}{suffix}"
        shutil.move(str(status.local_path), dest)
        logger.info("soulseek transfer complete: %s -> %s", status.local_path, dest)
        finish(dest)

    return handle
