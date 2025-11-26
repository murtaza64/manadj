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


class TagCreate(TagBase):
    pass


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
    key: str | None = None
    bpm: int | None = None


class TrackCreate(TrackBase):
    pass


class TrackUpdate(BaseModel):
    filename: str | None = None
    energy: int | None = None
    title: str | None = None
    artist: str | None = None
    key: str | None = None
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
class WaveformData(BaseModel):
    """Waveform data response."""
    sample_rate: int
    duration: float
    peaks: list[float]  # [max, min, max, min, ...]
    samples_per_peak: int
    cue_point_time: float | None = None


class WaveformResponse(BaseModel):
    """Full waveform response with metadata."""
    id: int
    track_id: int
    data: WaveformData
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
