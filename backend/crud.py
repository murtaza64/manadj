"""CRUD operations for database."""

import json
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import func
from . import models, schemas
from .beatgrid_utils import generate_beatgrid_from_bpm
from .track_metadata import FileMetadataError, read_file_metadata
from .track_metadata.units import bpm_to_centibpm, centibpm_to_bpm


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
    bpm_center: float | None = None,
    bpm_threshold_percent: int | None = None,
    key_camelot_ids: list[str] | None = None,
    unprocessed: bool | None = None,
    archived: bool = False,
    sort_column: str | None = None,
    sort_direction: str = "desc"
):
    query = db.query(models.Track).options(
        joinedload(models.Track.track_tags).joinedload(models.TrackTag.tag).joinedload(models.Tag.category),
        # served bpm reads the grid (ADR 0027) — eager, not N+1 lazy loads.
        joinedload(models.Track.beatgrid),
    )

    # Archived (CONTEXT.md): out of the active Library. Default listings
    # exclude archived Tracks; archived=True lists ONLY them (the Archived view).
    if archived:
        query = query.filter(~models.Track.is_active)
    else:
        query = query.filter(models.Track.is_active)

    # Text search on filename, title, or artist
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                models.Track.filename.ilike(pattern),
                models.Track.title.ilike(pattern),
                models.Track.artist.ilike(pattern),
            )
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

    # Unprocessed tracks filter - tracks with no tags OR no energy
    if unprocessed:
        query = query.filter(
            (models.Track.energy.is_(None)) |
            (~models.Track.track_tags.any())
        )

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

        # Convert BPM range to centiBPM for database comparison
        bpm_min_centi = int(bpm_min * 100)
        bpm_max_centi = int(bpm_max * 100)

        # Filter tracks within range (exclude NULL bpm). The centibpm
        # column is internal-only (ADR 0027): it exists so SQL sort/filter
        # work without parsing grid JSON, kept honest by compliant writers.
        query = query.filter(
            models.Track.bpm >= bpm_min_centi,
            models.Track.bpm <= bpm_max_centi,
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

    # Apply sorting
    if sort_column == "provenance":
        # sort by Audio Provenance origin label
        from backend.acquisition.models import AudioProvenance

        query = query.outerjoin(AudioProvenance, AudioProvenance.track_id == models.Track.id)
        order_column = func.lower(AudioProvenance.source)
    elif sort_column:
        order_column = getattr(models.Track, sort_column)

        # Handle string columns with case-insensitive sorting
        if sort_column in ['title', 'artist']:
            order_column = func.lower(order_column)

    if sort_column:
        # Apply sort direction with NULL values always last
        if sort_direction == "asc":
            query = query.order_by(order_column.asc().nullslast())
        else:
            query = query.order_by(order_column.desc().nullslast())
    else:
        # Default sort: newest first
        query = query.order_by(models.Track.created_at.desc())

    total = query.count()
    items = query.offset(skip).limit(limit).all()

    # Convert to schema format with tags list
    for item in items:
        item.tags = [tt.tag for tt in item.track_tags]

    # Total ACTIVE library size (archived Tracks are out of the Library)
    total_library_size = (
        db.query(models.Track).filter(models.Track.is_active).count()
    )

    return items, total, total_library_size


def get_playlists_containing_track(db: Session, track_id: int):
    """The Playlists a Track is a member of (sidebar order)."""
    return (
        db.query(models.Playlist)
        .join(models.PlaylistTrack, models.PlaylistTrack.playlist_id == models.Playlist.id)
        .filter(models.PlaylistTrack.track_id == track_id)
        .order_by(models.Playlist.display_order)
        .all()
    )


def archive_track(db: Session, track_id: int):
    """Archive a Track (CONTEXT.md): curation verdict — out of the active
    Library. Removes it from every Playlist (positions compact); the
    record, file, provenance, and correspondences persist. Idempotent.

    Returns (track, removed_from_playlists) or None if the Track is missing.
    """
    track = db.query(models.Track).filter(models.Track.id == track_id).first()
    if not track:
        return None

    # Already archived: full no-op. (Playlist entries added while archived —
    # auditioning from the Archived view — must survive a re-archive.)
    if track.archived_at is not None:
        return track, 0

    playlists = get_playlists_containing_track(db, track_id)
    for playlist in playlists:
        remove_track_from_playlist(db, playlist.id, track_id)

    track.archived_at = func.now()
    db.commit()
    db.refresh(track)
    return track, len(playlists)


def unarchive_track(db: Session, track_id: int):
    """Reverse the verdict. Playlist membership is NOT restored (stated
    asymmetry — it was removed at archive time). Idempotent."""
    track = db.query(models.Track).filter(models.Track.id == track_id).first()
    if not track:
        return None
    if track.archived_at is not None:
        track.archived_at = None
        db.commit()
        db.refresh(track)
    return track


def get_track(db: Session, track_id: int):
    track = db.query(models.Track).options(
        joinedload(models.Track.track_tags).joinedload(models.TrackTag.tag).joinedload(models.Tag.category),
        joinedload(models.Track.beatgrid),
    ).filter(models.Track.id == track_id).first()

    if track:
        track.tags = [tt.tag for tt in track.track_tags]

    return track


def get_all_tracks(db: Session):
    """Get all tracks without pagination."""
    return db.query(models.Track).all()


def create_track(db: Session, track: schemas.TrackCreate):
    track_data = track.model_dump()
    # API carries float BPM; the column stores centiBPM.
    track_data["bpm"] = bpm_to_centibpm(track_data.get("bpm"))

    # Fall back to file tags for fields not provided
    if track_data.get("filename"):
        try:
            metadata = read_file_metadata(track_data["filename"])
        except FileMetadataError:
            metadata = None
        if metadata is not None:
            if track_data.get("title") is None:
                track_data["title"] = metadata.title
            if track_data.get("artist") is None:
                track_data["artist"] = metadata.artist
            if track_data.get("key") is None:
                track_data["key"] = metadata.key
            if track_data.get("bpm") is None:
                track_data["bpm"] = bpm_to_centibpm(metadata.bpm)

    db_track = models.Track(**track_data)
    db.add(db_track)
    db.commit()
    db.refresh(db_track)

    # New Tracks get Waveform data via the task system (lazy import: cycle).
    from .waveform_tasks import enqueue_waveform_task
    enqueue_waveform_task(db, db_track.id)

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
    from sqlalchemy import func
    tags = db.query(
        models.Tag,
        func.count(models.TrackTag.track_id).label('track_count')
    ).outerjoin(
        models.TrackTag, models.Tag.id == models.TrackTag.tag_id
    ).options(
        joinedload(models.Tag.category)
    ).group_by(
        models.Tag.id
    ).order_by(
        models.Tag.category_id, models.Tag.display_order
    ).all()

    # Convert to list of Tag objects with track_count attribute
    result = []
    for tag, track_count in tags:
        tag.track_count = track_count
        result.append(tag)
    return result


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
    """Generate and store Waveform data (ADR 0014) for a track.

    Returns the created Waveform model instance; raises on analysis failure.
    """
    from .waveform_data import PEAK_HOP, SAMPLE_RATE, analyze, build_blob

    peaks, bands, duration = analyze(filepath)
    db_waveform = models.Waveform(
        track_id=track_id,
        sample_rate=SAMPLE_RATE,
        duration=duration,
        samples_per_peak=PEAK_HOP,
        data_blob=build_blob(peaks, bands, duration),
    )
    db.add(db_waveform)
    db.commit()
    db.refresh(db_waveform)
    return db_waveform


def update_track_cue_point(db: Session, track_id: int, cue_point_time: float | None):
    """Update a Track's Main cue (performance data, lives on the Track)."""
    track = get_track(db, track_id)
    if not track:
        return None
    track.cue_point_time = cue_point_time
    db.commit()
    db.refresh(track)
    return track


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
    """Add a track to a playlist at specified position (or end if None).

    Returns (playlist_with_tracks, skipped). Adding a track already in the
    playlist is an idempotent no-op with skipped=True (entry identity is
    (playlist, track); a Track appears at most once per Playlist).
    """
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return None

    already_present = db.query(models.PlaylistTrack).filter(
        models.PlaylistTrack.playlist_id == playlist_id,
        models.PlaylistTrack.track_id == track_id,
    ).first()
    if already_present:
        return get_playlist_with_tracks(db, playlist_id), True

    # If position is None, append to end
    if position is None:
        max_position = db.query(func.max(models.PlaylistTrack.position)).filter(
            models.PlaylistTrack.playlist_id == playlist_id
        ).scalar()
        position = 0 if max_position is None else max_position + 1
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

    return get_playlist_with_tracks(db, playlist_id), False


def remove_track_from_playlist(db: Session, playlist_id: int, track_id: int):
    """Remove a track from a playlist (keyed by track_id) and compact positions."""
    playlist_track = db.query(models.PlaylistTrack).filter(
        models.PlaylistTrack.track_id == track_id,
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


def reorder_playlist_tracks(db: Session, playlist_id: int, track_positions: list[schemas.PlaylistTrackPosition]):
    """Set the Play order of a playlist from (track_id, position) pairs.

    The payload must be a full permutation: every track in the playlist
    exactly once, with positions exactly 0..n-1. Raises ValueError otherwise.
    """
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return None

    entries = db.query(models.PlaylistTrack).filter(
        models.PlaylistTrack.playlist_id == playlist_id
    ).all()

    current_track_ids = {e.track_id for e in entries}
    payload_track_ids = [tp.track_id for tp in track_positions]
    if sorted(payload_track_ids) != sorted(current_track_ids):
        raise ValueError("reorder payload must include every playlist track exactly once")
    if sorted(tp.position for tp in track_positions) != list(range(len(entries))):
        raise ValueError("reorder positions must be exactly 0..n-1")

    new_position = {tp.track_id: tp.position for tp in track_positions}
    for entry in entries:
        entry.position = new_position[entry.track_id]

    db.commit()
    return get_playlist_with_tracks(db, playlist_id)


def reorder_playlists(db: Session, playlist_order: list[schemas.PlaylistOrderItem]):
    """Update display_order for multiple playlists."""
    for item in playlist_order:
        playlist = db.query(models.Playlist).filter(
            models.Playlist.id == item.id
        ).first()
        if playlist:
            playlist.display_order = item.display_order

    db.commit()
    return True


# Beatgrids
def get_beatgrid(db: Session, track_id: int):
    """Get beatgrid for a track."""
    return db.query(models.Beatgrid).filter(
        models.Beatgrid.track_id == track_id
    ).first()


def create_beatgrid_from_track_bpm(db: Session, track_id: int):
    """
    Generate beatgrid from track's BPM value.
    Requires waveform to exist (for duration).
    """
    track = get_track(db, track_id)
    if not track:
        raise ValueError("Track not found")

    if not track.bpm:
        raise ValueError("Track has no BPM set")

    waveform = get_waveform(db, track_id)
    if not waveform:
        raise ValueError("Waveform must exist before generating beatgrid")

    beatgrid_data = generate_beatgrid_from_bpm(centibpm_to_bpm(track.bpm), waveform.duration)

    db_beatgrid = models.Beatgrid(
        track_id=track_id,
        tempo_changes_json=json.dumps(beatgrid_data["tempo_changes"]),
        origin="generated",  # placeholder grid, not saved info
    )

    db.add(db_beatgrid)
    db.commit()
    db.refresh(db_beatgrid)
    return db_beatgrid


# Sentinel: "leave anchor_time as it is" (None is meaningful — it clears the mark)
_ANCHOR_UNCHANGED = object()


def update_beatgrid_tempo_changes(
    db: Session,
    track_id: int,
    tempo_changes: list[dict],
    origin: str = "edited",
    anchor_time: float | None | object = _ANCHOR_UNCHANGED,
) -> models.Beatgrid:
    """
    Update or create beatgrid with new tempo_changes.

    Args:
        db: Database session
        track_id: Track ID
        tempo_changes: New tempo changes array
        origin: Where the new grid came from — "edited" (default: user edits
            like set-downbeat/nudge) or "imported" (External Import)
        anchor_time: The user-marked downbeat (ADR 0016). Omit to leave the
            stored mark untouched; pass a float to record a mark (or its
            nudged position); pass None to clear it.

    Returns:
        Updated or created Beatgrid model
    """
    beatgrid = get_beatgrid(db, track_id)

    if beatgrid:
        # Update existing
        beatgrid.tempo_changes_json = json.dumps(tempo_changes)
        beatgrid.origin = origin
        beatgrid.updated_at = func.now()
    else:
        # Create new
        beatgrid = models.Beatgrid(
            track_id=track_id,
            tempo_changes_json=json.dumps(tempo_changes),
            origin=origin,
        )
        db.add(beatgrid)

    if anchor_time is not _ANCHOR_UNCHANGED:
        beatgrid.anchor_time = anchor_time

    db.commit()
    db.refresh(beatgrid)
    return beatgrid


# BPM Analysis CRUD operations

def get_bpm_analysis(db: Session, track_id: int):
    """Get BPM analysis for a track."""
    return db.query(models.BPMAnalysis).filter(models.BPMAnalysis.track_id == track_id).first()


def create_or_update_bpm_analysis(
    db: Session,
    track_id: int,
    estimates: list[dict],
    recommended_bpms: list[int],
    recommended_bpm: int,
    duration: float
):
    """Create or update BPM analysis for a track."""
    analysis = db.query(models.BPMAnalysis).filter(models.BPMAnalysis.track_id == track_id).first()

    if analysis:
        # Update existing
        analysis.estimates_json = json.dumps(estimates)
        analysis.recommended_bpms_json = json.dumps(recommended_bpms)
        analysis.recommended_bpm = recommended_bpm
        analysis.duration = duration
    else:
        # Create new
        analysis = models.BPMAnalysis(
            track_id=track_id,
            estimates_json=json.dumps(estimates),
            recommended_bpms_json=json.dumps(recommended_bpms),
            recommended_bpm=recommended_bpm,
            duration=duration
        )
        db.add(analysis)

    db.commit()
    db.refresh(analysis)
    return analysis


# Key Analysis CRUD operations

def get_key_analysis(db: Session, track_id: int):
    """Get key analysis for a track."""
    return db.query(models.KeyAnalysis).filter(models.KeyAnalysis.track_id == track_id).first()


def create_or_update_key_analysis(
    db: Session,
    track_id: int,
    key: str,
    formats: dict,
    confidence: float,
    scale: str
):
    """Create or update key analysis for a track."""
    analysis = db.query(models.KeyAnalysis).filter(models.KeyAnalysis.track_id == track_id).first()

    if analysis:
        # Update existing
        analysis.key = key
        analysis.musical = formats['musical']
        analysis.openkey = formats['openkey']
        analysis.camelot = formats['camelot']
        analysis.engine_id = formats['engine_id']
        analysis.confidence = confidence
        analysis.scale = scale
    else:
        # Create new
        analysis = models.KeyAnalysis(
            track_id=track_id,
            key=key,
            musical=formats['musical'],
            openkey=formats['openkey'],
            camelot=formats['camelot'],
            engine_id=formats['engine_id'],
            confidence=confidence,
            scale=scale
        )
        db.add(analysis)

    db.commit()
    db.refresh(analysis)
    return analysis


# Hot Cue Functions

def get_hotcues(db: Session, track_id: int):
    """Get all hot cues for a track."""
    return db.query(models.HotCue).filter(
        models.HotCue.track_id == track_id
    ).order_by(models.HotCue.slot_number).all()


def get_hotcues_bulk(db: Session, track_ids: list[int]):
    """Hot cues for many tracks in one query (set open fetches per-track
    cues for every entry; issue 43 collapsed N GETs into this)."""
    return db.query(models.HotCue).filter(
        models.HotCue.track_id.in_(track_ids)
    ).order_by(models.HotCue.track_id, models.HotCue.slot_number).all()


def set_hotcue(
    db: Session,
    track_id: int,
    slot_number: int,
    time_seconds: float,
    label: str | None = None,
    color: str | None = None
):
    """Set or update a hot cue.

    Stores the position verbatim: Quantize snapping is a client-side,
    gesture-time concern (looping 01) — the API stores what it's told.
    """
    # Get existing hot cue if it exists
    hotcue = db.query(models.HotCue).filter(
        models.HotCue.track_id == track_id,
        models.HotCue.slot_number == slot_number
    ).first()

    if hotcue:
        # Update existing
        hotcue.time_seconds = time_seconds
        if label is not None:
            hotcue.label = label
        if color is not None:
            hotcue.color = color
    else:
        # Create new
        hotcue = models.HotCue(
            track_id=track_id,
            slot_number=slot_number,
            time_seconds=time_seconds,
            label=label,
            color=color
        )
        db.add(hotcue)

    db.commit()
    db.refresh(hotcue)
    return hotcue


def delete_hotcue(db: Session, track_id: int, slot_number: int):
    """Delete a hot cue."""
    hotcue = db.query(models.HotCue).filter(
        models.HotCue.track_id == track_id,
        models.HotCue.slot_number == slot_number
    ).first()

    if hotcue:
        db.delete(hotcue)
        db.commit()
        return True
    return False



def get_provenance_map(db: Session, track_ids: list[int]) -> dict:
    """track_id -> Audio Provenance dict for attaching to track responses."""
    from backend.acquisition.models import AudioProvenance

    if not track_ids:
        return {}
    rows = (
        db.query(AudioProvenance).filter(AudioProvenance.track_id.in_(track_ids)).all()
    )
    return {
        p.track_id: {
            "label": p.source,
            "url": p.url,
            "asserted": p.asserted,
        }
        for p in rows
    }
