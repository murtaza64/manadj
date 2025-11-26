"""Pydantic schemas for API validation."""

from pydantic import BaseModel, ConfigDict
from datetime import datetime


# Tag Category Schemas
class TagCategoryBase(BaseModel):
    name: str
    display_order: int = 0
    color: str | None = None


class TagCategoryCreate(TagCategoryBase):
    pass


class TagCategory(TagCategoryBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


# Tag Schemas
class TagBase(BaseModel):
    name: str
    category_id: int
    display_order: int = 0
    color: str | None = None


class TagCreate(TagBase):
    pass


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    display_order: int | None = None


class Tag(TagBase):
    id: int
    category: TagCategory
    model_config = ConfigDict(from_attributes=True)


# Track Schemas
class TrackBase(BaseModel):
    filename: str
    file_hash: str | None = None
    energy: int | None = None  # 1-5 energy level
    title: str | None = None
    artist: str | None = None
    key: int | None = None  # Engine DJ key ID (0-23)
    bpm: int | None = None


class TrackCreate(TrackBase):
    pass


class TrackUpdate(BaseModel):
    filename: str | None = None
    energy: int | None = None
    title: str | None = None
    artist: str | None = None
    key: int | None = None  # Engine DJ key ID (0-23)
    bpm: int | None = None
    tag_ids: list[int] | None = None


class Track(TrackBase):
    id: int
    created_at: datetime
    updated_at: datetime
    tags: list[Tag] = []
    model_config = ConfigDict(from_attributes=True)


# Pagination
class PaginatedTracks(BaseModel):
    items: list[Track]
    total: int
    page: int
    per_page: int
    total_pages: int


# Waveform Schemas
class WaveformBands(BaseModel):
    """3-band frequency waveform data."""
    low: list[float]  # Bass: 20-250Hz
    mid: list[float]  # Mids: 250-4000Hz
    high: list[float]  # Highs: 4000-20000Hz


class WaveformData(BaseModel):
    """Waveform data response."""
    sample_rate: int
    duration: float
    samples_per_peak: int
    cue_point_time: float | None = None
    bands: WaveformBands


class WaveformResponse(BaseModel):
    """Full waveform response with metadata."""
    id: int
    track_id: int
    data: WaveformData
    png_url: str | None = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# Playlist Schemas
class PlaylistBase(BaseModel):
    name: str
    color: str | None = None
    display_order: int = 0


class PlaylistCreate(PlaylistBase):
    pass


class PlaylistUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    display_order: int | None = None


class Playlist(PlaylistBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PlaylistWithTracks(Playlist):
    """Playlist with full track details in order."""
    tracks: list[Track] = []


class PlaylistTrackAdd(BaseModel):
    """Request to add track to playlist."""
    track_id: int
    position: int | None = None  # If None, append to end


class PlaylistTrackReorder(BaseModel):
    """Request to reorder tracks in playlist."""
    track_positions: list[dict]  # [{"id": playlist_track_id, "position": new_position}, ...]
