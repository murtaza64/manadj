"""Pydantic schemas for API validation."""

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_serializer, model_validator
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
    # Grid-first BPM (ADR 0016): the Beatgrid's dominant tempo when a grid
    # exists, else bpm. Float BPM (models.Track.bpm_effective). Tempo
    # consumers (Set planner) read this, never bpm.
    bpm_effective: float | None = None
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
    # User-marked downbeat (seconds, ADR 0016); None = no mark
    anchor_time: float | None = None
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


# Track-link Schemas (linked-pairs PRD — symmetric Linked pairs)

class TrackLinkRow(BaseModel):
    """A persisted Linked pair (GET response), canonical order low < high."""
    low_track_id: int
    high_track_id: int
    created_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class TrackLinkState(BaseModel):
    """The Linked fact for an unordered pair (PUT payload and response)."""
    linked: bool


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


# Take Schemas (transition-takes 02, ADR 0020)


class TakeCreate(BaseModel):
    """A settled Handover, posted by the frontend detector.

    a = outgoing Track, b = incoming. `params` is the detector-parameter
    snapshot and `events` the raw capture-event slice — both opaque
    (stored as JSON text, never queried): the evidence, kept re-derivable
    for detector/vectorizer tuning (issue 05).
    """
    uuid: str
    a_track_id: int
    b_track_id: int
    window_start_s: float
    window_end_s: float
    confidence: float
    detector_version: int
    params: dict
    events: list[dict]


class TakeRow(BaseModel):
    """History-list metadata (GET response) — no raw slice."""
    uuid: str
    a_track_id: int
    b_track_id: int
    detected_at: datetime
    window_start_s: float
    window_end_s: float
    confidence: float
    detector_version: int
    promoted_transition_uuid: str | None = None


class TakeDetail(TakeRow):
    """One Take with its evidence (GET /{uuid} response)."""
    params: dict
    events: list[dict]


class TakePromotedPatch(BaseModel):
    """Set/clear a Take's promoted-Transition reference (issue 03)."""
    promoted_transition_uuid: str | None


# Set Schemas (sets PRD, issue 01 — client-authoritative entry replace)


class SetCreate(BaseModel):
    """Create a Set (sidebar sibling of Playlist)."""
    name: str
    color: str | None = None
    display_order: int = 0


class SetUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    display_order: int | None = None
    # Tempo policy (sets 06). set_tempo_bpm may be explicitly nulled
    # (falls back to the first track's BPM at plan time).
    tempo_policy: str | None = Field(default=None, pattern=r"^(riding|fixed)$")
    set_tempo_bpm: float | None = Field(default=None, gt=0)


class SetRow(BaseModel):
    """Set metadata (list/create/patch response)."""
    id: int
    name: str
    color: str | None
    display_order: int
    tempo_policy: str = "riding"
    set_tempo_bpm: float | None = None
    created_at: datetime | None
    updated_at: datetime | None
    # Sets 12: an Archived Track in the Set flags it (sidebar + detail)
    # rather than silently altering it — computed per response, never stored.
    has_archived_tracks: bool = False

    model_config = ConfigDict(from_attributes=True)


class SetEntryItem(BaseModel):
    """One entry of a wholesale entries replace (PUT payload).

    Position is NOT in the payload: it is the item's index in the list.
    track_id is the entry identity (a Track at most once per Set).

    The pin (sets 02) describes the adjacency this entry heads: a
    Transition uuid, a Take uuid, or nothing (Unresolved). Kind and uuid
    travel together; the uuid is stored as asserted (never validated
    against the transitions/takes tables — dangling degrades client-side).
    """
    track_id: int
    pin_kind: str | None = Field(default=None, pattern=r"^(transition|take)$")
    pin_uuid: str | None = None

    @model_validator(mode="after")
    def _pin_fields_travel_together(self) -> "SetEntryItem":
        if (self.pin_kind is None) != (self.pin_uuid is None):
            raise ValueError("pin_kind and pin_uuid must both be set or both be null")
        return self


class SetDormantPinItem(BaseModel):
    """One Dormant pin (sets 07): a broken pin remembered per ORDERED
    track pair, per Set. Unlike an entry pin it always carries a pin —
    a memory of nothing is nothing. The uuid is stored as asserted
    (dangling memories are DROPPED by the deletion paths, degrade_pins).
    """
    a_track_id: int
    b_track_id: int
    pin_kind: str = Field(pattern=r"^(transition|take)$")
    pin_uuid: str


class SetEntriesReplace(BaseModel):
    """Full replacement of a Set's ordered entry list (ADR 0011 pattern),
    plus its Dormant pins (sets 07) — both client-authoritative, both
    replaced wholesale in the same PUT (dormancy is Set state)."""
    items: list[SetEntryItem]
    dormant: list[SetDormantPinItem] = []


class SetEntryRow(BaseModel):
    """A persisted Set entry (GET response)."""
    track_id: int
    position: int
    pin_kind: str | None
    pin_uuid: str | None

    model_config = ConfigDict(from_attributes=True)


class SetDormantPinRow(BaseModel):
    """A persisted Dormant pin (GET response)."""
    a_track_id: int
    b_track_id: int
    pin_kind: str
    pin_uuid: str

    model_config = ConfigDict(from_attributes=True)


class SetWithEntries(SetRow):
    """A Set with its ordered entries and Dormant pins (sets 07)."""
    entries: list[SetEntryRow] = []
    # The ORM relationship is named dormant_pins; the wire field is dormant.
    dormant: list[SetDormantPinRow] = Field(
        default=[], validation_alias=AliasChoices("dormant", "dormant_pins")
    )


class SetOrderItem(BaseModel):
    """One entry of a sidebar-order payload."""
    id: int
    display_order: int
