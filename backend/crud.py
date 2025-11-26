"""CRUD operations for database."""

from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import func
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
    tag_match_mode: str = "ANY",
    bpm_center: int | None = None,
    bpm_threshold_percent: int | None = None,
    key_camelot_ids: list[str] | None = None
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

    # BPM range filter
    if bpm_center is not None and bpm_threshold_percent is not None:
        # Calculate BPM range: center ± (center × threshold%)
        threshold_value = bpm_center * (bpm_threshold_percent / 100.0)
        bpm_min = bpm_center - threshold_value
        bpm_max = bpm_center + threshold_value

        # Filter tracks within range (exclude NULL bpm)
        query = query.filter(
            models.Track.bpm >= bpm_min,
            models.Track.bpm <= bpm_max,
            models.Track.bpm.isnot(None)
        )

    # Key filter (ANY match) - convert OpenKey to Engine DJ IDs
    if key_camelot_ids:
        from .key import Key

        # Convert OpenKey notation to Engine DJ IDs
        key_ids = []
        for openkey in key_camelot_ids:
            key_obj = Key.from_openkey(openkey)
            if key_obj and key_obj.engine_id is not None:
                key_ids.append(key_obj.engine_id)

        if key_ids:
            query = query.filter(models.Track.key.in_(key_ids))

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


def update_tag(db: Session, tag_id: int, tag_update: schemas.TagUpdate):
    """Update a tag's properties."""
    tag = db.query(models.Tag).options(
        joinedload(models.Tag.category)
    ).filter(models.Tag.id == tag_id).first()

    if not tag:
        return None

    if tag_update.name is not None:
        tag.name = tag_update.name
    if tag_update.color is not None:
        tag.color = tag_update.color
    if tag_update.display_order is not None:
        tag.display_order = tag_update.display_order

    db.commit()
    db.refresh(tag)
    return tag


def delete_tag(db: Session, tag_id: int):
    """Delete a tag (cascade deletes TrackTag associations)."""
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        return None

    db.delete(tag)
    db.commit()
    return True


def reorder_tags(db: Session, tag_order: list[dict]):
    """Update display_order for multiple tags."""
    for item in tag_order:
        tag = db.query(models.Tag).filter(models.Tag.id == item['id']).first()
        if tag:
            tag.display_order = item['display_order']

    db.commit()
    return True


# Waveforms
def get_waveform(db: Session, track_id: int):
    """Get waveform for a track."""
    return db.query(models.Waveform).filter(
        models.Waveform.track_id == track_id
    ).first()


def create_waveform(db: Session, track_id: int, filepath: str):
    """
    Generate and store waveform data for a track.

    Generates both JSON data (for Canvas renderer) and PNG file (for PNG renderer).

    Returns the created Waveform model instance.
    Raises Exception if generation fails.
    """
    from .waveform_utils import (
        generate_multiband_waveform_data,
        multiband_waveform_to_json,
        generate_waveform_png_file
    )
    from pathlib import Path

    # Generate multiband waveform data (512 samples/peak for higher detail PNG)
    multiband_data = generate_multiband_waveform_data(filepath, samples_per_peak=512)

    # Generate PNG waveform file
    png_filename = f"track_{track_id}.png"
    png_path = Path("waveforms") / png_filename

    # Ensure waveforms directory exists
    png_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        generate_waveform_png_file(
            audio_path=filepath,
            output_path=str(png_path),
            samples_per_peak=512,
            pixels_per_point=2,
            height_per_band=60
        )
    except Exception as e:
        print(f"Warning: PNG generation failed for track {track_id}: {e}")
        # Continue without PNG - Canvas renderer will still work
        png_path = None

    # Create database record with multiband data and PNG path
    db_waveform = models.Waveform(
        track_id=track_id,
        sample_rate=multiband_data["sample_rate"],
        duration=multiband_data["duration"],
        samples_per_peak=multiband_data["samples_per_peak"],
        low_peaks_json=multiband_waveform_to_json(multiband_data["bands"]["low"]),
        mid_peaks_json=multiband_waveform_to_json(multiband_data["bands"]["mid"]),
        high_peaks_json=multiband_waveform_to_json(multiband_data["bands"]["high"]),
        png_path=str(png_path) if png_path else None,
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


# Playlists
def get_playlists(db: Session):
    """Get all playlists ordered by display_order."""
    return db.query(models.Playlist).order_by(
        models.Playlist.display_order
    ).all()


def get_playlist(db: Session, playlist_id: int):
    """Get a single playlist by ID."""
    return db.query(models.Playlist).filter(
        models.Playlist.id == playlist_id
    ).first()


def get_playlist_with_tracks(db: Session, playlist_id: int):
    """Get playlist with full track details in order."""
    playlist = db.query(models.Playlist).filter(
        models.Playlist.id == playlist_id
    ).first()

    if not playlist:
        return None

    # Get tracks in order via playlist_tracks junction
    playlist_tracks = db.query(models.PlaylistTrack).filter(
        models.PlaylistTrack.playlist_id == playlist_id
    ).order_by(models.PlaylistTrack.position).all()

    # Load full track data with tags
    tracks = []
    for pt in playlist_tracks:
        track = get_track(db, pt.track_id)
        if track:
            tracks.append(track)

    # Attach tracks to playlist object
    playlist.tracks = tracks
    return playlist


def create_playlist(db: Session, playlist: schemas.PlaylistCreate):
    """Create a new playlist."""
    db_playlist = models.Playlist(**playlist.model_dump())
    db.add(db_playlist)
    db.commit()
    db.refresh(db_playlist)
    return db_playlist


def update_playlist(db: Session, playlist_id: int, playlist_update: schemas.PlaylistUpdate):
    """Update playlist properties."""
    playlist = db.query(models.Playlist).filter(
        models.Playlist.id == playlist_id
    ).first()

    if not playlist:
        return None

    if playlist_update.name is not None:
        playlist.name = playlist_update.name
    if playlist_update.color is not None:
        playlist.color = playlist_update.color
    if playlist_update.display_order is not None:
        playlist.display_order = playlist_update.display_order

    db.commit()
    db.refresh(playlist)
    return playlist


def delete_playlist(db: Session, playlist_id: int):
    """Delete a playlist (cascade deletes PlaylistTrack entries)."""
    playlist = db.query(models.Playlist).filter(
        models.Playlist.id == playlist_id
    ).first()

    if not playlist:
        return None

    db.delete(playlist)
    db.commit()
    return True


def add_track_to_playlist(db: Session, playlist_id: int, track_id: int, position: int | None = None):
    """Add a track to a playlist at specified position (or end if None)."""
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return None

    # If position is None, append to end
    if position is None:
        max_position = db.query(func.max(models.PlaylistTrack.position)).filter(
            models.PlaylistTrack.playlist_id == playlist_id
        ).scalar()
        position = (max_position or -1) + 1
    else:
        # Shift existing tracks at or after this position
        db.query(models.PlaylistTrack).filter(
            models.PlaylistTrack.playlist_id == playlist_id,
            models.PlaylistTrack.position >= position
        ).update({models.PlaylistTrack.position: models.PlaylistTrack.position + 1})

    # Add new track
    playlist_track = models.PlaylistTrack(
        playlist_id=playlist_id,
        track_id=track_id,
        position=position
    )
    db.add(playlist_track)
    db.commit()

    return get_playlist_with_tracks(db, playlist_id)


def remove_track_from_playlist(db: Session, playlist_id: int, playlist_track_id: int):
    """Remove a track from a playlist and reorder remaining tracks."""
    playlist_track = db.query(models.PlaylistTrack).filter(
        models.PlaylistTrack.id == playlist_track_id,
        models.PlaylistTrack.playlist_id == playlist_id
    ).first()

    if not playlist_track:
        return None

    removed_position = playlist_track.position

    # Delete the track
    db.delete(playlist_track)

    # Shift tracks after removed position down
    db.query(models.PlaylistTrack).filter(
        models.PlaylistTrack.playlist_id == playlist_id,
        models.PlaylistTrack.position > removed_position
    ).update({models.PlaylistTrack.position: models.PlaylistTrack.position - 1})

    db.commit()
    return get_playlist_with_tracks(db, playlist_id)


def reorder_playlist_tracks(db: Session, playlist_id: int, track_positions: list[dict]):
    """
    Update positions for multiple tracks in a playlist.
    track_positions format: [{"id": playlist_track_id, "position": new_position}, ...]
    """
    for item in track_positions:
        playlist_track = db.query(models.PlaylistTrack).filter(
            models.PlaylistTrack.id == item['id'],
            models.PlaylistTrack.playlist_id == playlist_id
        ).first()
        if playlist_track:
            playlist_track.position = item['position']

    db.commit()
    return get_playlist_with_tracks(db, playlist_id)


def reorder_playlists(db: Session, playlist_order: list[dict]):
    """
    Update display_order for multiple playlists.
    playlist_order format: [{"id": playlist_id, "display_order": new_order}, ...]
    """
    for item in playlist_order:
        playlist = db.query(models.Playlist).filter(
            models.Playlist.id == item['id']
        ).first()
        if playlist:
            playlist.display_order = item['display_order']

    db.commit()
    return True

