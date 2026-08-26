"""Pydantic schemas for API validation."""

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator
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
    # Key provenance (ADR 0024): analyzed | imported | manual; NULL = unknown
    key_provenance: str | None = None
    # Worklist flag (ADR 0024): analysis bailed and no saved grid yet
    needs_attention: bool = False
    tags: list[Tag] = []
    provenance: TrackProvenance | None = None
    # One served BPM (ADR 0027): the grid-first projection
    # (models.Track.bpm_projected — float BPM), not the centibpm column.
    # The alias reads the model property when validating from ORM objects;
    # plain-dict construction still accepts "bpm".
    bpm: float | None = Field(
        default=None, validation_alias=AliasChoices("bpm_projected", "bpm")
    )
    model_config = ConfigDict(from_attributes=True)


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


class DropHypothesis(BaseModel):
    """One possible drop (structure-analysis 02): analysis opinion, not a cue."""
    time: float  # seconds, on a downbeat
    strength: float  # detector score, min-max normalized to [0, 1]


class DropsResponse(BaseModel):
    """Detected possible drops, ranked earliest-strong-first. Empty when the
    track has no Waveform blob or no Beatgrid (never an error)."""
    track_id: int
    drops: list[DropHypothesis]


class BeatgridResponse(BaseModel):
    """Full beatgrid API response.

    A computed placeholder (ADR 0027 §3: gridless tracks project the bpm
    column on the fly, no row) has id/created_at/updated_at = None.
    """
    id: int | None = None
    track_id: int
    data: BeatgridData
    origin: str  # "generated" (placeholder), "edited", or "imported"
    # User-marked downbeat (seconds, ADR 0016); None = no mark
    anchor_time: float | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


# Metric Ladder Schemas (ADR 0029)

class MetricLadderResponse(BaseModel):
    """The EFFECTIVE Metric ladder for a track (metric-ladder 02).

    `persisted=False` means the computed default (duple arities, no Reset
    marks — no row exists; placeholder posture). Marks are track-time
    seconds; downbeat resolution happens client-side at read.
    """
    track_id: int
    arities: list[int]
    reset_marks: list[float]
    persisted: bool
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class MetricLadderPut(BaseModel):
    """Full-state upsert: the authoritative mark list. Marks are the ONLY
    editable surface (ADR 0029: arity editing deferred; stored arities are
    preserved, never written through this API). Sorting/dedup is
    server-side; an empty body on default arities clears the row."""
    reset_marks: list[float]


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
    # Last edit instant (sets 26: unresolved-adjacency resolution ranks by
    # "most recently edited"). Naive UTC, like every updated_at here.
    updated_at: datetime | None = None


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
    for detector/vectorizer tuning (issue 05). `session_uuid` is the
    Session this Take was born from (provenance, nullable; ADR 0033) and
    `origin` marks how — `detected` (default) or `manual` (issue 06).
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
    session_uuid: str | None = None
    origin: str = "detected"


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
    session_uuid: str | None = None
    origin: str = "detected"


class TakeDetail(TakeRow):
    """One Take with its evidence (GET /{uuid} response)."""
    params: dict
    events: list[dict]


class TakePromotedPatch(BaseModel):
    """Set/clear a Take's promoted-Transition reference (issue 03)."""
    promoted_transition_uuid: str | None


# Session Schemas (Sessions PRD, ADR 0033)


class SessionCreate(BaseModel):
    """Open a Session — one stretch of live performance, opened on the
    first Master-audible instant (sessions 11). The client mints the uuid
    so chunk appends can start immediately (fire-and-forget, no round-trip
    for the id). `started_at` optional: the backend defaults to now."""
    uuid: str
    started_at: datetime | None = None


class SessionChunkAppend(BaseModel):
    """One append-only batch of capture events (~5s flush; ADR 0033).

    `seq` is the append order within the Session; `events` is an opaque
    JSON array of the capture event vocabulary, stored verbatim."""
    seq: int
    events: list[dict]


class SessionEndPatch(BaseModel):
    """Close a Session (set ended_at). Optional timestamp; defaults to now."""
    ended_at: datetime | None = None


class SessionRow(BaseModel):
    """Sessions-list metadata: no chunks, just the header + Take count."""
    uuid: str
    started_at: datetime
    ended_at: datetime | None = None
    take_count: int


class SessionDetail(SessionRow):
    """One Session with its whole event log — chunks concatenated in seq
    order into one opaque event array. The inspection/diagnostic read model
    (Sessions PRD, ADR 0033): fetch the persisted events through the app
    boundary; clients read them with the capture vocabulary's real types."""
    events: list[dict]


class RoutineCandidateRow(BaseModel):
    """A miner-suggested Routine span (ADR 0035, routines 157). `cast` is
    entry-ordered track ids (slot order); the window is capture-clock
    seconds on the owning Session; `entry_offsets` gives each slot's entry
    as seconds from window start (slot 0 = 0.0)."""
    uuid: str
    session_uuid: str
    cast: list[int]
    window_start_s: float
    window_end_s: float
    entry_offsets: list[float]
    evidence: dict[str, int]
    miner_version: int
    created_at: datetime | None = None


class RoutineCandidateQuery(BaseModel):
    """Cast-prefix query (the pin picker's "Routines available" hint):
    `track_ids` is the Set's upcoming entries in order, starting with the
    adjacency's outgoing track."""
    track_ids: list[int]


# Routine Take + Routine Schemas (ADR 0035, routines 158)


class RoutineTakeCreate(BaseModel):
    """Confirm a candidate span into a Routine Take (with boundary trim).

    The client sends the FINAL window (trimmed on the Session timeline)
    plus the effective cast and per-slot entry offsets (seconds from the
    trimmed window start; slot 0 = 0.0). n ≥ 3 is enforced here — a
    2-cast confirm is a hand-cut Take and routes to POST /api/takes.
    `origin_candidate_uuid` is provenance only (candidate uuids dangle
    after a re-mine)."""
    uuid: str
    session_uuid: str
    window_start_s: float
    window_end_s: float
    cast: list[int]
    entry_offsets: list[float]
    origin_candidate_uuid: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "RoutineTakeCreate":
        if len(self.cast) < 3:
            raise ValueError(
                "n >= 3 — a 2-cast routine is a Transition; cut a hand-cut Take instead (ADR 0035)"
            )
        if len(self.entry_offsets) != len(self.cast):
            raise ValueError("entry_offsets must match the cast, slot for slot")
        if self.window_end_s <= self.window_start_s:
            raise ValueError("empty window")
        return self


class RoutineTakeRow(BaseModel):
    """Transition-history metadata for a Routine Take."""
    uuid: str
    session_uuid: str
    cast: list[int]
    window_start_s: float
    window_end_s: float
    entry_offsets: list[float]
    origin_candidate_uuid: str | None = None
    promoted_routine_uuid: str | None = None
    confirmed_at: datetime


class RoutineRow(BaseModel):
    """A saved Routine — list metadata (no event payload)."""
    uuid: str
    name: str | None = None
    cast: list[int]
    entry_offsets_beats: list[float]
    entry_positions: list[float]
    duration_beats: float
    origin_take_uuid: str | None = None
    created_at: datetime | None = None


class RoutineDetail(RoutineRow):
    """One Routine with its slot-addressed, beat-domain event replay."""
    events: list[dict]


class RoutinePatch(BaseModel):
    """Rename a Routine (the only mutable field pre-editor)."""
    name: str | None = None


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
    Transition uuid, a Take uuid, a Routine uuid (sets 160, ADR 0035 —
    pinned on the adjacency leaving the Routine's first cast track,
    covering the following adjacencies; covered entries keep their own
    pins here, shadowed client-side), an explicit Hard-cut (sets 26 — no
    uuid: it references nothing), or nothing (Unresolved). Kind and uuid
    travel together for transition/take/routine; the uuid is stored as
    asserted (never validated against the referenced tables — dangling
    degrades client-side).
    """
    track_id: int
    pin_kind: str | None = Field(default=None, pattern=r"^(transition|take|hardcut|routine)$")
    pin_uuid: str | None = None
    # Per-entry trim (sets #164): an OFFSET from neutral in mixer-knob
    # units (0 = neutral, ±0.5 spans the knob) — composes with track
    # Autogain when that lands (ADR 0034), never an absolute level.
    trim: float = Field(default=0.0, ge=-0.5, le=0.5)

    @model_validator(mode="after")
    def _pin_fields_travel_together(self) -> "SetEntryItem":
        if self.pin_kind == "hardcut":
            if self.pin_uuid is not None:
                raise ValueError("a hardcut pin carries no pin_uuid")
        elif (self.pin_kind is None) != (self.pin_uuid is None):
            raise ValueError("pin_kind and pin_uuid must both be set or both be null")
        return self


class SetDormantPinItem(BaseModel):
    """One Dormant pin (sets 07): a broken pin remembered per ORDERED
    track pair, per Set. Unlike an entry pin it always carries a pin —
    a memory of nothing is nothing (a Hard-cut pin IS a pin: dormancy
    round-trips it, sets 26). A Routine pin's memory is keyed by its
    BOUNDARY tracks (entry, exit — sets 160): it restores when the cast
    is the next n entries again, not on plain pair adjacency. The uuid
    is stored as asserted (dangling memories are DROPPED by the deletion
    paths, degrade_pins).
    """
    a_track_id: int
    b_track_id: int
    pin_kind: str = Field(pattern=r"^(transition|take|hardcut|routine)$")
    pin_uuid: str | None = None

    @model_validator(mode="after")
    def _uuid_matches_kind(self) -> "SetDormantPinItem":
        if self.pin_kind == "hardcut":
            if self.pin_uuid is not None:
                raise ValueError("a hardcut pin carries no pin_uuid")
        elif self.pin_uuid is None:
            raise ValueError("a transition/take/routine pin requires a pin_uuid")
        return self


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
    trim: float

    model_config = ConfigDict(from_attributes=True)


class SetDormantPinRow(BaseModel):
    """A persisted Dormant pin (GET response)."""
    a_track_id: int
    b_track_id: int
    pin_kind: str
    pin_uuid: str | None

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
