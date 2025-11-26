"""CRUD operations for database."""

from sqlalchemy.orm import Session, joinedload
from . import models, schemas
from .id3_utils import extract_id3_metadata


# Tracks
def get_tracks(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    tag_ids: list[int] | None = None,
    search: str | None = None,
    energy_min: int | None = None,
    energy_max: int | None = None,
    tag_match_mode: str = "ANY"
):
    query = db.query(models.Track).options(
        joinedload(models.Track.track_tags).joinedload(models.TrackTag.tag).joinedload(models.Tag.category)
    )

    # Text search on filename
    if search:
        query = query.filter(
            models.Track.filename.ilike(f"%{search}%")
        )

    # Energy range filter
    # When range is full (1-5), include tracks with null energy
    # Otherwise, only include tracks with energy in the specified range
    if energy_min is not None or energy_max is not None:
        if energy_min == 1 and energy_max == 5:
            # Full range - include null energy tracks
            pass
        else:
            # Partial range - exclude null energy tracks
            if energy_min is not None:
                query = query.filter(models.Track.energy >= energy_min, models.Track.energy.isnot(None))
            if energy_max is not None:
                query = query.filter(models.Track.energy <= energy_max, models.Track.energy.isnot(None))

    # Tag filtering with ANY/ALL logic
    if tag_ids:
        if tag_match_mode == "ALL":
            # ALL logic: Track must have all specified tags
            for tag_id in tag_ids:
                query = query.filter(
                    models.Track.track_tags.any(
                        models.TrackTag.tag_id == tag_id
                    )
                )
        else:  # ANY logic (default)
            # ANY logic: Track must have at least one specified tag
            query = query.join(models.TrackTag).filter(
                models.TrackTag.tag_id.in_(tag_ids)
            )

    total = query.count()
    items = query.offset(skip).limit(limit).all()

    # Convert to schema format with tags list
    for item in items:
        item.tags = [tt.tag for tt in item.track_tags]

    return items, total


def get_track(db: Session, track_id: int):
    track = db.query(models.Track).options(
        joinedload(models.Track.track_tags).joinedload(models.TrackTag.tag).joinedload(models.Tag.category)
    ).filter(models.Track.id == track_id).first()

    if track:
        track.tags = [tt.tag for tt in track.track_tags]

    return track


def create_track(db: Session, track: schemas.TrackCreate):
    track_data = track.model_dump()

    # Extract ID3 metadata from the file if it exists
    if track_data.get("filename"):
        metadata = extract_id3_metadata(track_data["filename"])
        # Only set metadata if not already provided in track_data
        if track_data.get("title") is None:
            track_data["title"] = metadata["title"]
        if track_data.get("artist") is None:
            track_data["artist"] = metadata["artist"]
        if track_data.get("key") is None:
            track_data["key"] = metadata["key"]
        if track_data.get("bpm") is None:
            track_data["bpm"] = metadata["bpm"]

    db_track = models.Track(**track_data)
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track


def update_track_tags(db: Session, track_id: int, tag_ids: list[int]):
    track = db.query(models.Track).filter(models.Track.id == track_id).first()
    if not track:
        return None

    # Remove existing tags
    db.query(models.TrackTag).filter(models.TrackTag.track_id == track_id).delete()

    # Add new tags (deduplicate to prevent duplicates)
    for tag_id in set(tag_ids):
        track_tag = models.TrackTag(track_id=track_id, tag_id=tag_id)
        db.add(track_tag)

    db.commit()
    db.refresh(track)
    return track


# Tags
def get_tag_categories(db: Session):
    return db.query(models.TagCategory).order_by(
        models.TagCategory.display_order
    ).all()


def get_tags_by_category(db: Session, category_id: int):
    return db.query(models.Tag).options(
        joinedload(models.Tag.category)
    ).filter(
        models.Tag.category_id == category_id
    ).order_by(models.Tag.display_order).all()


def get_all_tags(db: Session):
    return db.query(models.Tag).options(
        joinedload(models.Tag.category)
    ).order_by(models.Tag.category_id, models.Tag.display_order).all()


def create_tag_category(db: Session, category: schemas.TagCategoryCreate):
    db_category = models.TagCategory(**category.model_dump())
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


def create_tag(db: Session, tag: schemas.TagCreate):
    db_tag = models.Tag(**tag.model_dump())
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    return db_tag



# Waveforms
def get_waveform(db: Session, track_id: int):
    """Get waveform for a track."""
    return db.query(models.Waveform).filter(
        models.Waveform.track_id == track_id
    ).first()


def create_waveform(db: Session, track_id: int, filepath: str):
    """
    Generate and store waveform data for a track.

    Returns the created Waveform model instance.
    Raises Exception if generation fails.
    """
    from .waveform_utils import generate_waveform_data, waveform_data_to_json

    # Generate waveform data
    waveform_data = generate_waveform_data(filepath)

    # Create database record
    db_waveform = models.Waveform(
        track_id=track_id,
        sample_rate=waveform_data["sample_rate"],
        duration=waveform_data["duration"],
        samples_per_peak=waveform_data["samples_per_peak"],
        peaks_json=waveform_data_to_json(waveform_data),
        cue_point_time=None
    )

    db.add(db_waveform)
    db.commit()
    db.refresh(db_waveform)

    return db_waveform


def update_waveform_cue_point(db: Session, track_id: int, cue_point_time: float | None):
    """Update the CUE point for a waveform."""
    waveform = get_waveform(db, track_id)
    if not waveform:
        return None

    waveform.cue_point_time = cue_point_time
    db.commit()
    db.refresh(waveform)

    return waveform

