"""The download task: Source audio -> tracks directory -> Track.

The chain (issue 05): Cleanup names the file, the Source downloads it, the
normal Disk Import path creates the Track, then Source Correspondence +
Audio Provenance are recorded and the Source Item becomes fulfilled.
"""

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy.orm import Session

from ..library.import_manager import LibraryImportManager
from ..models import Track
from ..track_metadata import FileMetadataError, write_file_metadata
from ..track_metadata.file_facts import refresh_file_facts
from .cleanup import CleanupConfig, clean_metadata, safe_basename
from .models import AudioProvenance, SourceCorrespondence, SourceItem

logger = logging.getLogger(__name__)


class DownloadableSource(Protocol):
    def download(self, permalink_url: str, dest_dir: Path, basename: str) -> Path: ...


def download_handler(
    source: DownloadableSource,
    tracks_dir: Path,
    cleanup_config: CleanupConfig | None = None,
) -> Callable[[Session, dict[str, Any]], None]:
    """Build the task handler for `download` tasks."""
    cleanup = cleanup_config or CleanupConfig()

    def handle(db: Session, payload: dict[str, Any]) -> None:
        item = db.query(SourceItem).filter(SourceItem.id == payload["source_item_id"]).one()

        meta = clean_metadata(item.title, item.uploader, cleanup)
        basename = safe_basename(meta.artist, meta.title)

        collisions = list(tracks_dir.glob(f"{basename}.*"))
        if collisions:
            raise FileExistsError(
                f"file already exists for {basename!r}: {collisions[0].name} "
                "— probably a missed correspondence; link it manually or remove the file"
            )

        path = source.download(item.permalink_url, tracks_dir, basename)
        logger.info("downloaded %s -> %s", item.permalink_url, path)

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
            c
            for c in importer.get_import_candidates().candidates
            if Path(c.filepath) == path
        ]
        if len(candidates) != 1:
            raise RuntimeError(f"downloaded file {path.name!r} not found by Disk Import scan")
        result = importer.import_tracks(candidates)
        if result.errors:
            raise RuntimeError(f"Disk Import failed: {'; '.join(result.error_messages)}")

        track = db.query(Track).filter(Track.filename == str(path)).one()
        # Cleanup output is authoritative for a fresh acquisition
        track.title = meta.title  # type: ignore[assignment]
        track.artist = meta.artist  # type: ignore[assignment]
        refresh_file_facts(db)

        db.add(
            SourceCorrespondence(
                source_item_id=item.id, track_id=track.id, status="confirmed"
            )
        )
        db.add(
            AudioProvenance(
                track_id=track.id,
                source=item.source,
                external_id=item.external_id,
                url=item.permalink_url,
                asserted=False,
            )
        )
        item.state = "fulfilled"
        db.commit()
        logger.info("acquired %s - %s (track %d)", meta.artist, meta.title, track.id)

    return handle
