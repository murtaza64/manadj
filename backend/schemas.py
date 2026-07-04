"""Pydantic schemas for API validation."""

from pydantic import BaseModel, ConfigDict, field_serializer
from datetime import datetime

from backend.track_metadata.units import centibpm_to_bpm


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
    track_count: int = 0
    model_config = ConfigDict(from_attributes=True)


# Track Schemas
class TrackBase(BaseModel):
    filename: str
    file_hash: str | None = None
    energy: int | None = None  # 1-5 energy level
    title: str | None = None
    artist: str | None = None
    key: int | None = None  # Engine DJ key ID (0-23)
    bpm: float | None = None  # Exposed as float, stored as int * 100
    duration_secs: float | None = None  # audio duration, read from the file
    codec: str | None = None  # mp3/aac/alac/flac/pcm, from the file
    bitrate_kbps: int | None = None  # from the file
    filesize_bytes: int | None = None  # from the file


class TrackCreate(TrackBase):
    """bpm is float BPM; conversion to the storage unit happens in crud.create_track."""


class TrackProvenance(BaseModel):
    """Audio Provenance summary for track list responses."""
    label: str
    url: str | None = None
    asserted: bool = True


class Track(TrackBase):
    id: int
    created_at: datetime
    updated_at: datetime
    tags: list[Tag] = []
    provenance: TrackProvenance | None = None
    model_config = ConfigDict(from_attributes=True)

    @field_serializer('bpm')
    def serialize_bpm(self, bpm: int | None, _info) -> float | None:
        """Convert stored centiBPM back to float BPM for API responses."""
        return centibpm_to_bpm(bpm)


# Pagination
class PaginatedTracks(BaseModel):
    items: list[Track]
    total: int
    library_total: int
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


# Beatgrid Schemas
class TempoChange(BaseModel):
    """Single tempo change point."""
    start_time: float
    bpm: float
    time_signature_num: int
    time_signature_den: int
    bar_position: int


class BeatgridData(BaseModel):
    """Beatgrid data for API responses."""
    tempo_changes: list[TempoChange]
    beat_times: list[float]
    downbeat_times: list[float]


class BeatgridResponse(BaseModel):
    """Full beatgrid API response."""
    id: int
    track_id: int
    data: BeatgridData
    origin: str  # "generated" (placeholder), "edited", or "imported"
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Analysis Schemas

class BPMEstimate(BaseModel):
    """Single BPM estimate from a detection method."""
    method: str
    bpm: int
    confidence: float | None = None


class BPMAnalysisMetadata(BaseModel):
    """Metadata about BPM analysis."""
    duration: float
    analyzed_at: str


class BPMAnalysisResponse(BaseModel):
    """BPM analysis response with multiple estimates."""
    track_id: int
    estimates: list[BPMEstimate]
    recommended_bpms: list[int]
    recommended_bpm: int
    metadata: BPMAnalysisMetadata


class KeyFormats(BaseModel):
    """Musical key in different notation formats."""
    musical: str
    openkey: str | None
    camelot: str | None
    engine_id: int | None


class KeyAnalysisMetadata(BaseModel):
    """Metadata about key analysis."""
    scale: str
    analyzed_at: str


class KeyAnalysisResponse(BaseModel):
    """Key analysis response."""
    track_id: int
    key: str
    formats: KeyFormats
    confidence: float
    metadata: KeyAnalysisMetadata


# Hot Cue Schemas

class HotCueSet(BaseModel):
    """Request to set a hot cue."""
    time_seconds: float
    label: str | None = None
    color: str | None = None


class HotCue(BaseModel):
    """Hot cue response."""
    id: int
    track_id: int
    slot_number: int
    time_seconds: float
    label: str | None
    color: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Transition Schemas (ADR 0011 — client-authoritative pair-replace)

class TransitionItem(BaseModel):
    """One saved Transition as the client materializes it.

    `uuid` is the client-generated identity; `data` is the opaque drawn
    payload (anchors, lanes, tempo-match, hidden lanes) — never queried.
    Position is NOT in the payload: it is the item's index in the list.
    """
    uuid: str
    name: str
    favorite: bool = False
    data: dict


class TransitionPairReplace(BaseModel):
    """Full replacement of an ordered pair's Transition set."""
    items: list[TransitionItem]


class TransitionRow(BaseModel):
    """A persisted Transition (GET response)."""
    a_track_id: int
    b_track_id: int
    uuid: str
    position: int
    name: str
    favorite: bool
    data: dict
