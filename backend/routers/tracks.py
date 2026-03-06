"""API routes for tracks."""

import logging
import mimetypes
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import crud, schemas, models
from ..database import get_db
from ..id3_utils import extract_id3_metadata, write_id3_metadata
from ..key import Key

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=schemas.PaginatedTracks)
def list_tracks(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=10000),
    tag_ids: List[int] | None = Query(None),
    search: str | None = Query(None),
    energy_min: int | None = Query(None, ge=1, le=5),
    energy_max: int | None = Query(None, ge=1, le=5),
    tag_match_mode: str = Query("ANY", pattern="^(ANY|ALL)$"),
    bpm_center: int | None = Query(None, ge=1, le=300),
    bpm_threshold_percent: int | None = Query(None, ge=0, le=100),
    key_camelot_ids: List[str] | None = Query(None),
    unprocessed: bool | None = Query(None),
    sort_column: str | None = Query(None, pattern="^(key|bpm|energy|title|artist|created_at)$"),
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db)
):
    # Validate energy range
    if energy_min is not None and energy_max is not None and energy_min > energy_max:
        raise HTTPException(status_code=400, detail="energy_min must be <= energy_max")

    # Validate BPM parameters (both or neither required)
    if (bpm_center is None) != (bpm_threshold_percent is None):
        raise HTTPException(
            status_code=400,
            detail="Both bpm_center and bpm_threshold_percent must be provided together"
        )

    skip = (page - 1) * per_page
    items, total, library_total = crud.get_tracks(
        db,
        skip=skip,
        limit=per_page,
        tag_ids=tag_ids,
        search=search,
        energy_min=energy_min,
        energy_max=energy_max,
        tag_match_mode=tag_match_mode,
        bpm_center=bpm_center,
        bpm_threshold_percent=bpm_threshold_percent,
        key_camelot_ids=key_camelot_ids,
        unprocessed=unprocessed,
        sort_column=sort_column,
        sort_direction=sort_direction
    )

    return {
        "items": items,
        "total": total,
        "library_total": library_total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page
    }


@router.get("/{track_id}", response_model=schemas.Track)
def get_track(track_id: int, db: Session = Depends(get_db)):
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


@router.post("/", response_model=schemas.Track, status_code=201)
def create_track(track: schemas.TrackCreate, db: Session = Depends(get_db)):
    return crud.create_track(db, track)


@router.patch("/{track_id}", response_model=schemas.Track)
def update_track(
    track_id: int,
    update_data: schemas.TrackUpdate,
    db: Session = Depends(get_db)
):
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    title_or_artist_updated = False
    write_kwargs: dict[str, str | None] = {}

    # Update title if provided
    if update_data.title is not None:
        if track.title != update_data.title:
            title_or_artist_updated = True
            write_kwargs["title"] = update_data.title
        track.title = update_data.title

    # Update artist if provided
    if update_data.artist is not None:
        if track.artist != update_data.artist:
            title_or_artist_updated = True
            write_kwargs["artist"] = update_data.artist
        track.artist = update_data.artist

    # Update energy if provided
    if update_data.energy is not None:
        if not 1 <= update_data.energy <= 5:
            raise HTTPException(status_code=400, detail="Energy must be 1-5")
        track.energy = update_data.energy

    # Update BPM if provided
    if update_data.bpm is not None:
        track.bpm = update_data.bpm  # Already converted to centiBPM by validator

    # Update key if provided
    if update_data.key is not None:
        track.key = update_data.key

    # Update tags if provided
    if update_data.tag_ids is not None:
        track = crud.update_track_tags(db, track_id, update_data.tag_ids)

    # Best-effort: write title/artist to file metadata immediately.
    # DB commit still proceeds if file write fails.
    if title_or_artist_updated and write_kwargs:
        try:
            success = write_id3_metadata(track.filename, **write_kwargs)
            if not success:
                logger.warning(
                    "Best-effort metadata write failed for track_id=%s file=%s",
                    track.id,
                    track.filename,
                )
        except Exception:
            logger.exception(
                "Unexpected error during best-effort metadata write for track_id=%s file=%s",
                track.id,
                track.filename,
            )

    db.commit()
    db.refresh(track)

    # Reload to get tags with categories
    track = crud.get_track(db, track_id)
    return track


@router.post("/refresh-metadata")
def refresh_metadata(
    track_id: int | None = Query(None),
    db: Session = Depends(get_db)
):
    """
    Refresh ID3 metadata for tracks.

    If track_id is provided, refresh only that track.
    Otherwise, refresh metadata for all tracks.
    """
    if track_id is not None:
        # Refresh single track
        track = crud.get_track(db, track_id)
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")

        metadata = extract_id3_metadata(track.filename)
        track.title = metadata["title"]
        track.artist = metadata["artist"]
        track.key = metadata["key"]
        # Convert BPM to centiBPM (multiply by 100) for storage
        track.bpm = int(metadata["bpm"] * 100) if metadata["bpm"] is not None else None

        db.commit()
        db.refresh(track)

        return {"message": f"Refreshed metadata for track {track_id}", "track": track}

    else:
        # Refresh all tracks
        tracks = db.query(models.Track).all()
        updated_count = 0

        for track in tracks:
            metadata = extract_id3_metadata(track.filename)
            track.title = metadata["title"]
            track.artist = metadata["artist"]
            track.key = metadata["key"]
            # Convert BPM to centiBPM (multiply by 100) for storage
            track.bpm = int(metadata["bpm"] * 100) if metadata["bpm"] is not None else None
            updated_count += 1

        db.commit()

        return {"message": f"Refreshed metadata for {updated_count} tracks", "count": updated_count}


@router.get("/{track_id}/audio")
def get_track_audio(track_id: int, db: Session = Depends(get_db)):
    """Stream audio file for a track."""
    track = crud.get_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    file_path = Path(track.filename)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Detect MIME type
    mime_type, _ = mimetypes.guess_type(str(file_path))
    if mime_type is None:
        mime_type = "audio/mpeg"

    # Stream file
    def iterfile():
        with open(file_path, "rb") as f:
            yield from f

    # Encode filename for Content-Disposition header (RFC 5987)
    # Use ASCII-safe filename and add UTF-8 encoded filename* parameter
    from urllib.parse import quote
    ascii_filename = file_path.name.encode('ascii', 'ignore').decode('ascii')
    utf8_filename = quote(file_path.name.encode('utf-8'))

    return StreamingResponse(
        iterfile(),
        media_type=mime_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f"inline; filename=\"{ascii_filename}\"; filename*=UTF-8''{utf8_filename}"
        }
    )


@router.get("/metadata/compare", response_model=schemas.MetadataComparisonResult)
def compare_metadata(db: Session = Depends(get_db)):
    """
    Compare database metadata with ID3 tags for all tracks.
    Returns only tracks with differences.
    """
    tracks = crud.get_all_tracks(db)

    comparisons = []
    stats = schemas.MetadataComparisonStats(
        total_tracks=len(tracks),
        tracks_with_changes=0,
        tracks_with_conflicts=0,
        missing_files=0
    )

    for track in tracks:
        # Get file path (filename is already a full path)
        file_path = Path(track.filename)

        if not file_path.exists():
            stats.missing_files += 1
            continue

        # Read ID3 metadata
        try:
            id3_data = extract_id3_metadata(str(file_path))
        except Exception as e:
            print(f"Error reading ID3 for {track.filename}: {e}")
            continue

        # Convert key to musical notation
        current_key = None
        if track.key is not None:
            try:
                current_key = Key(track.key).to_musical()
            except:
                pass

        file_key = None
        if id3_data.get("key") is not None:
            try:
                file_key = Key(id3_data["key"]).to_musical()
            except:
                pass

        # Build current and file values
        current = schemas.MetadataValues(
            title=track.title,
            artist=track.artist,
            bpm=track.bpm / 100.0 if track.bpm else None,
            key=current_key
        )

        file_values = schemas.MetadataValues(
            title=id3_data.get("title"),
            artist=id3_data.get("artist"),
            bpm=float(id3_data["bpm"]) if id3_data.get("bpm") else None,
            key=file_key
        )

        # Determine differences and conflict type
        differences = []
        has_db_value = False
        has_file_value = False
        has_conflict = False

        for field in ["title", "artist", "bpm", "key"]:
            db_val = getattr(current, field)
            file_val = getattr(file_values, field)

            if db_val != file_val:
                differences.append(field)

                if db_val is not None:
                    has_db_value = True
                if file_val is not None:
                    has_file_value = True
                if db_val is not None and file_val is not None:
                    has_conflict = True

        # Skip if no differences
        if not differences:
            continue

        # Determine conflict type
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

        comparisons.append(schemas.MetadataComparison(
            track_id=track.id,
            filename=track.filename,
            current=current,
            file=file_values,
            differences=differences,
            conflict_type=conflict_type
        ))

    return schemas.MetadataComparisonResult(
        stats=stats,
        comparisons=comparisons
    )


@router.post("/metadata/sync", response_model=schemas.MetadataSyncResult)
def sync_metadata(
    request: schemas.MetadataSyncRequest,
    db: Session = Depends(get_db)
):
    """
    Apply metadata changes to database.
    If dry_run=True, returns what would be updated without making changes.
    """
    stats = schemas.MetadataSyncStats(
        total_requested=len(request.updates),
        updated=0,
        skipped=0,
        errors=0,
        error_messages=[]
    )

    for update in request.updates:
        try:
            track = crud.get_track(db, update.track_id)
            if not track:
                stats.skipped += 1
                stats.error_messages.append(f"Track {update.track_id} not found")
                continue

            # Update specified fields
            updated = False
            for field, value in update.fields.items():
                if field == "bpm" and value is not None:
                    # Convert BPM to centiBPM
                    centibpm = int(float(value) * 100)
                    if track.bpm != centibpm:
                        if not request.dry_run:
                            track.bpm = centibpm
                        updated = True
                elif field == "key" and value is not None:
                    # Convert musical notation to Engine DJ ID
                    try:
                        key_obj = Key.from_musical(str(value))
                        key_id = key_obj.to_engine()
                        if track.key != key_id:
                            if not request.dry_run:
                                track.key = key_id
                            updated = True
                    except Exception as e:
                        stats.error_messages.append(f"Invalid key '{value}' for track {track.id}: {e}")
                        continue
                elif field in ["title", "artist"]:
                    if getattr(track, field) != value:
                        if not request.dry_run:
                            setattr(track, field, value)
                        updated = True

            if updated:
                stats.updated += 1
            else:
                stats.skipped += 1

        except Exception as e:
            stats.errors += 1
            stats.error_messages.append(f"Error updating track {update.track_id}: {str(e)}")

    if not request.dry_run:
        db.commit()

    return schemas.MetadataSyncResult(
        stats=stats,
        dry_run=request.dry_run
    )


@router.post("/metadata/write-to-files", response_model=schemas.MetadataSyncResult)
def write_metadata_to_files(
    request: schemas.MetadataSyncRequest,
    db: Session = Depends(get_db)
):
    """
    Write database metadata to ID3 tags in audio files.
    If dry_run=True, returns what would be updated without making changes.
    """
    stats = schemas.MetadataSyncStats(
        total_requested=len(request.updates),
        updated=0,
        skipped=0,
        errors=0,
        error_messages=[]
    )

    for update in request.updates:
        try:
            track = crud.get_track(db, update.track_id)
            if not track:
                stats.skipped += 1
                stats.error_messages.append(f"Track {update.track_id} not found")
                continue

            # Get file path (filename is already a full path)
            file_path = Path(track.filename)

            if not file_path.exists():
                stats.skipped += 1
                stats.error_messages.append(f"File not found: {track.filename}")
                continue

            # Prepare metadata to write
            write_kwargs = {}
            for field, value in update.fields.items():
                if field == "title":
                    write_kwargs["title"] = str(value) if value is not None else None
                elif field == "artist":
                    write_kwargs["artist"] = str(value) if value is not None else None
                elif field == "bpm":
                    # Convert from centiBPM to float
                    write_kwargs["bpm"] = float(value) / 100.0 if value is not None else None
                elif field == "key":
                    # Value is already Engine DJ ID from DB
                    write_kwargs["key"] = int(value) if value is not None else None

            if not write_kwargs:
                stats.skipped += 1
                continue

            # Write to file (unless dry run)
            if not request.dry_run:
                success = write_id3_metadata(str(file_path), **write_kwargs)
                if not success:
                    stats.errors += 1
                    stats.error_messages.append(f"Failed to write to file: {track.filename}")
                    continue

            stats.updated += 1

        except Exception as e:
            stats.errors += 1
            stats.error_messages.append(f"Error processing track {update.track_id}: {str(e)}")

    return schemas.MetadataSyncResult(
        stats=stats,
        dry_run=request.dry_run
    )
