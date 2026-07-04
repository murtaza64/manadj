"""Pydantic schemas for API validation."""

from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator
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
    cue_point_time: float | None = None  # Main cue (seconds), performance data
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
    archived_at: datetime | None = None  # Archived verdict; NULL = active
    tags: list[Tag] = []
    provenance: TrackProvenance | None = None
    model_config = ConfigDict(from_attributes=True)

    @field_serializer('bpm')
    def serialize_bpm(self, bpm: int | None, _info) -> float | None:
        """Convert stored centiBPM back to float BPM for API responses."""
        return centibpm_to_bpm(bpm)


class TrackArchiveResult(BaseModel):
    """Result of archiving: the verdict timestamp + how many Playlists the
    Track was removed from."""
    archived_at: datetime | None
    removed_from_playlists: int


# Pagination
class PaginatedTracks(BaseModel):
    items: list[Track]
    total: int
    library_total: int
    page: int
    per_page: int
    total_pages: int



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


class PlaylistTrackAddResult(BaseModel):
    """Result of an add: skipped=True means the track was already present (no-op)."""
    skipped: bool
    playlist: PlaylistWithTracks


class PlaylistTrackPosition(BaseModel):
    """One entry of a reorder payload, keyed by track (entry identity)."""
    track_id: int
    position: int


class PlaylistTrackReorder(BaseModel):
    """Request to reorder tracks in playlist. Must be a full permutation of the playlist."""
    track_positions: list[PlaylistTrackPosition]


class PlaylistOrderItem(BaseModel):
    """One entry of a sidebar-order payload."""
    id: int
    display_order: int


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


# Transition-template Schemas (mix-editor issue 03 — plain CRUD)

ANCHOR_BASE_PATTERN = r"^(cue_[1-8]|grid_origin)$"


class TransitionTemplateItem(BaseModel):
    """A Transition template as the client authors it (POST/PUT payload).

    `uuid` is the client-generated identity. The alignment rule: B's
    anchor (`align_b_base`) lands on A's anchor (`align_a_base`) plus
    `align_delta_beats` (whole beats, A's grid). The window sits around
    the alignment instant: `before_beats`/`after_beats` are free-signed
    whole beats whose total must be ≥ 0 (zero = hard cut at the anchor).
    `lanes` is the sparse normalized lane payload (opaque, same LanePoint
    shape as Transitions).
    """
    uuid: str
    name: str
    align_a_base: str = Field(pattern=ANCHOR_BASE_PATTERN)
    align_delta_beats: int
    align_b_base: str = Field(pattern=ANCHOR_BASE_PATTERN)
    before_beats: int
    after_beats: int
    scalable: bool = False
    lanes: dict

    @model_validator(mode="after")
    def _window_total_non_negative(self) -> "TransitionTemplateItem":
        if self.before_beats + self.after_beats < 0:
            raise ValueError("window total (before_beats + after_beats) must be >= 0")
        return self


class TransitionTemplateRow(TransitionTemplateItem):
    """A persisted Transition template (GET/POST/PUT response)."""
