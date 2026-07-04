"""Track metadata operations: the single write path for Track metadata.

Every route that creates or updates a Track's scalar metadata flows through
apply_update; the compare/sync/write-to-files flows live here too. Units and
key conversion happen at this interface, nowhere else.
"""

import logging
from pathlib import Path

from sqlalchemy.orm import Session

from backend import models
from backend.key import Key

from .file_metadata import FileMetadataError, read_file_metadata, write_file_metadata
from .models import (
    MetadataComparison,
    MetadataComparisonResult,
    MetadataComparisonStats,
    MetadataSyncRequest,
    MetadataSyncResult,
    MetadataSyncStats,
    MetadataValues,
    TrackChanges,
)
from .units import bpm_to_centibpm, centibpm_to_bpm

logger = logging.getLogger(__name__)

COMPARABLE_FIELDS = ["title", "artist", "bpm", "key"]


def apply_update(
    db: Session, track: models.Track, changes: TrackChanges, *, write_files: bool = True
) -> models.Track:
    """Apply changes to a Track. The only sanctioned way to update Track metadata.

    Policy: title/artist changes are written back to the audio file
    best-effort (DB update proceeds if the file write fails); key/bpm/energy
    reach files only via the explicit write_to_files flow.
    """
    file_updates: dict[str, str] = {}

    if changes.title is not None:
        if track.title != changes.title:
            file_updates["title"] = changes.title
        track.title = changes.title
    if changes.artist is not None:
        if track.artist != changes.artist:
            file_updates["artist"] = changes.artist
        track.artist = changes.artist
    if changes.energy is not None:
        track.energy = changes.energy
    if changes.key is not None:
        track.key = changes.key
    if changes.bpm is not None:
        track.bpm = bpm_to_centibpm(changes.bpm)
    if changes.tag_ids is not None:
        db.query(models.TrackTag).filter(models.TrackTag.track_id == track.id).delete()
        for tag_id in set(changes.tag_ids):
            db.add(models.TrackTag(track_id=track.id, tag_id=tag_id))

    # Archived Tracks leave Export, including ID3 writes to Disk
    # (CONTEXT.md: Archived) — DB edits still apply.
    if write_files and file_updates and track.archived_at is None:
        try:
            write_file_metadata(
                str(track.filename),
                title=file_updates.get("title"),
                artist=file_updates.get("artist"),
            )
        except FileMetadataError as e:
            logger.warning(
                "best-effort file write failed for track %s (%s): %s",
                track.id,
                track.filename,
                e,
            )

    db.commit()
    db.refresh(track)
    return track


def refresh_from_files(db: Session, track_id: int | None = None) -> int:
    """Overwrite DB title/artist/key/bpm from file tags (file wins).

    Returns the number of tracks refreshed. Unreadable/missing files are
    skipped and logged. Raises ValueError for an unknown track_id.
    """
    if track_id is not None:
        track = _get_track(db, track_id)
        if not track:
            raise ValueError(f"track {track_id} not found")
        tracks = [track]
    else:
        tracks = db.query(models.Track).all()

    refreshed = 0
    for track in tracks:
        try:
            meta = read_file_metadata(track.filename)
        except FileMetadataError as e:
            logger.warning("skipping refresh for track %s: %s", track.id, e)
            continue
        track.title = meta.title
        track.artist = meta.artist
        track.key = meta.key
        track.bpm = bpm_to_centibpm(meta.bpm)
        refreshed += 1

    db.commit()
    return refreshed


def compare_with_files(db: Session) -> MetadataComparisonResult:
    """Compare DB metadata with file tags for all ACTIVE tracks; report
    differences. Archived Tracks are excluded — this feeds the write-to-files
    Export flow (CONTEXT.md: Archived)."""
    tracks = db.query(models.Track).filter(models.Track.archived_at.is_(None)).all()
    stats = MetadataComparisonStats(
        total_tracks=len(tracks),
        tracks_with_changes=0,
        tracks_with_conflicts=0,
        missing_files=0,
    )
    comparisons: list[MetadataComparison] = []

    for track in tracks:
        if not Path(track.filename).exists():
            stats.missing_files += 1
            continue
        try:
            file_meta = read_file_metadata(track.filename)
        except FileMetadataError as e:
            logger.warning("skipping comparison for track %s: %s", track.id, e)
            continue

        current = MetadataValues(
            title=track.title,
            artist=track.artist,
            bpm=centibpm_to_bpm(track.bpm),
            key=_musical(track.key),
        )
        file_values = MetadataValues(
            title=file_meta.title,
            artist=file_meta.artist,
            bpm=file_meta.bpm,
            key=_musical(file_meta.key),
        )

        differences = [
            f for f in COMPARABLE_FIELDS if getattr(current, f) != getattr(file_values, f)
        ]
        if not differences:
            continue

        has_db_value = any(getattr(current, f) is not None for f in differences)
        has_file_value = any(getattr(file_values, f) is not None for f in differences)
        has_conflict = any(
            getattr(current, f) is not None and getattr(file_values, f) is not None
            for f in differences
        )

        if has_conflict:
            conflict_type = "conflict"
            stats.tracks_with_conflicts += 1
        elif has_file_value and not has_db_value:
            conflict_type = "only_in_file"
        elif has_db_value and not has_file_value:
            conflict_type = "only_in_db"
        else:
            conflict_type = "match"

        stats.tracks_with_changes += 1
        comparisons.append(
            MetadataComparison(
                track_id=track.id,
                filename=track.filename,
                current=current,
                file=file_values,
                differences=differences,
                conflict_type=conflict_type,
            )
        )

    return MetadataComparisonResult(stats=stats, comparisons=comparisons)


def sync_to_db(db: Session, request: MetadataSyncRequest) -> MetadataSyncResult:
    """Apply selected file-side values to the DB. Fields use comparison units
    (bpm: float BPM, key: musical notation)."""
    stats = _new_sync_stats(len(request.updates))

    for update in request.updates:
        track = _get_track(db, update.track_id)
        if not track:
            stats.skipped += 1
            stats.error_messages.append(f"Track {update.track_id} not found")
            continue

        updated = False
        for field, value in update.fields.items():
            if value is None:
                continue
            if field == "bpm":
                centibpm = bpm_to_centibpm(float(value))
                if track.bpm != centibpm:
                    if not request.dry_run:
                        track.bpm = centibpm
                    updated = True
            elif field == "key":
                key = Key.from_musical(str(value))
                if key is None:
                    stats.error_messages.append(
                        f"Invalid key '{value}' for track {track.id}"
                    )
                    continue
                if track.key != key.engine_id:
                    if not request.dry_run:
                        track.key = key.engine_id
                    updated = True
            elif field in ("title", "artist"):
                if getattr(track, field) != value:
                    if not request.dry_run:
                        setattr(track, field, value)
                    updated = True

        if updated:
            stats.updated += 1
        else:
            stats.skipped += 1

    if not request.dry_run:
        db.commit()
    return MetadataSyncResult(stats=stats, dry_run=request.dry_run)


def write_to_files(db: Session, request: MetadataSyncRequest) -> MetadataSyncResult:
    """Write selected DB-side values into file tags. Fields use comparison
    units (bpm: float BPM, key: musical notation)."""
    stats = _new_sync_stats(len(request.updates))

    for update in request.updates:
        track = _get_track(db, update.track_id)
        if not track:
            stats.skipped += 1
            stats.error_messages.append(f"Track {update.track_id} not found")
            continue

        write_kwargs: dict[str, str | float | int | None] = {}
        for field, value in update.fields.items():
            if value is None:
                continue
            if field in ("title", "artist"):
                write_kwargs[field] = str(value)
            elif field == "bpm":
                write_kwargs["bpm"] = float(value)
            elif field == "key":
                key = Key.from_musical(str(value))
                if key is None:
                    stats.error_messages.append(
                        f"Invalid key '{value}' for track {track.id}"
                    )
                    continue
                write_kwargs["key"] = key.engine_id

        if not write_kwargs:
            stats.skipped += 1
            continue

        if not request.dry_run:
            try:
                write_file_metadata(track.filename, **write_kwargs)  # type: ignore[arg-type]
            except FileMetadataError as e:
                stats.errors += 1
                stats.error_messages.append(str(e))
                continue
        stats.updated += 1

    return MetadataSyncResult(stats=stats, dry_run=request.dry_run)


def _get_track(db: Session, track_id: int) -> models.Track | None:
    return db.query(models.Track).filter(models.Track.id == track_id).first()


def _musical(engine_id: int | None) -> str | None:
    key = Key.from_engine_id(engine_id)
    return key.musical if key else None


def _new_sync_stats(total: int) -> MetadataSyncStats:
    return MetadataSyncStats(
        total_requested=total, updated=0, skipped=0, errors=0, error_messages=[]
    )
