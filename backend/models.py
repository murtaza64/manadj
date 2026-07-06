"""SQLAlchemy models for music library database."""

import json

from sqlalchemy import Boolean, CheckConstraint, Column, Integer, LargeBinary, String, Text, Float, ForeignKey, DateTime, Index, and_, select
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import backref, deferred, relationship, DeclarativeBase
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, unique=True, nullable=False, index=True)
    file_hash = Column(String, index=True)
    energy = Column(Integer)  # 1-5 energy level
    title = Column(String, nullable=True)
    artist = Column(String, nullable=True)
    key = Column(Integer, nullable=True)  # Engine DJ key ID (0-23)
    bpm = Column(Integer, nullable=True)  # Beats per minute
    duration_secs = Column(Float, nullable=True)  # audio duration, read from the file
    # Main cue (seconds) — performance data, lives with the Track (moved off
    # the waveform row in waveform-overhaul issue 06).
    cue_point_time = Column(Float, nullable=True)
    codec = Column(String, nullable=True)  # mp3/aac/alac/flac/pcm, from the file
    bitrate_kbps = Column(Integer, nullable=True)  # from the file
    filesize_bytes = Column(Integer, nullable=True)  # from the file
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    # Archived (CONTEXT.md): curation verdict — out of the active Library.
    # NULL = active. Record/file/provenance persist; nothing is deleted.
    archived_at = Column(DateTime, nullable=True)

    @hybrid_property
    def is_active(self) -> bool:
        """Not Archived. THE predicate for every listing/Export/discovery
        query — one place to change if the verdict ever grows states."""
        return self.archived_at is None

    @is_active.expression
    def is_active(cls):
        return cls.archived_at.is_(None)

    # Relationships
    track_tags = relationship("TrackTag", back_populates="track", cascade="all, delete-orphan")

    @hybrid_property
    def needs_attention(self) -> bool:
        """The analysis worklist predicate (ADR 0024): native grid Analysis
        bailed and the Track still has no saved grid. A generated placeholder
        is not saved info; a grid gained from ANY saved origin (edited,
        imported, or a later successful analysis) clears the flag."""
        diag = self.grid_analysis
        if diag is None or not diag.bailed:
            return False
        grid = self.beatgrid
        return grid is None or grid.origin == "generated"

    @needs_attention.expression
    def needs_attention(cls):
        bailed = (
            select(GridAnalysis.id)
            .where(GridAnalysis.track_id == cls.id, GridAnalysis.bailed.is_(True))
            .exists()
        )
        saved_grid = (
            select(Beatgrid.id)
            .where(Beatgrid.track_id == cls.id, Beatgrid.origin != "generated")
            .exists()
        )
        return and_(bailed, ~saved_grid)

    @property
    def bpm_effective(self) -> float | None:
        """Grid-first BPM (ADR 0016): the Beatgrid's dominant tempo when a
        grid exists, else the bpm column projected to float BPM. THE tempo
        value tempo consumers must read — the bpm column is only the grid's
        cached projection and can be stale (the Kambi→Raskal 2× incident)."""
        # Lazy imports: track_metadata.manager imports this module.
        from .beatgrid_utils import dominant_bpm
        from .track_metadata.units import centibpm_to_bpm

        grid = self.beatgrid
        if grid is not None:
            tempo_changes = json.loads(grid.tempo_changes_json)
            if tempo_changes:
                return dominant_bpm(tempo_changes, self.duration_secs)
        return centibpm_to_bpm(self.bpm)


class Waveform(Base):
    """Waveform data (ADR 0014): one style-agnostic analysis blob per Track."""

    __tablename__ = "waveforms"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    sample_rate = Column(Integer, nullable=False)
    duration = Column(Float, nullable=False)
    samples_per_peak = Column(Integer, nullable=False)
    # Waveform data v2 blob (ADR 0014). Deferred: multi-hundred-KB per row —
    # never load it via relationship traversal (see the 21s sync-status incident).
    data_blob = deferred(Column(LargeBinary, nullable=True))
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship (one-to-one: track_id is unique)
    track = relationship("Track", backref=backref("waveform", uselist=False))


class TagCategory(Base):
    __tablename__ = "tag_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    display_order = Column(Integer, default=0)
    color = Column(String)  # Hex color

    # Relationships
    tags = relationship("Tag", back_populates="category", cascade="all, delete-orphan")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    category_id = Column(Integer, ForeignKey("tag_categories.id"), nullable=False)
    name = Column(String, nullable=False)
    display_order = Column(Integer, default=0)
    color = Column(String)

    # Relationships
    category = relationship("TagCategory", back_populates="tags")
    track_tags = relationship("TrackTag", back_populates="tag", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_tags_category", "category_id"),
    )


class TrackTag(Base):
    __tablename__ = "track_tags"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    tag_id = Column(Integer, ForeignKey("tags.id"), nullable=False)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    track = relationship("Track", back_populates="track_tags")
    tag = relationship("Tag", back_populates="track_tags")

    __table_args__ = (
        Index("idx_track_tags_track", "track_id"),
        Index("idx_track_tags_tag", "tag_id"),
        Index("idx_track_tags_unique", "track_id", "tag_id", unique=True),
    )


class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    color = Column(String)  # Hex color
    display_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    playlist_tracks = relationship("PlaylistTrack", back_populates="playlist", cascade="all, delete-orphan")


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"

    id = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(Integer, ForeignKey("playlists.id"), nullable=False)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    position = Column(Integer, nullable=False)  # Order within playlist (0-indexed)
    created_at = Column(DateTime, default=func.now())

    # Relationships
    playlist = relationship("Playlist", back_populates="playlist_tracks")
    track = relationship("Track")

    __table_args__ = (
        Index("idx_playlist_tracks_playlist", "playlist_id"),
        Index("idx_playlist_tracks_track", "track_id"),
        Index("idx_playlist_tracks_position", "playlist_id", "position"),
        # A Track appears at most once per Playlist (entry identity).
        Index("uq_playlist_tracks_playlist_track", "playlist_id", "track_id", unique=True),
    )


class Beatgrid(Base):
    __tablename__ = "beatgrids"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    tempo_changes_json = Column(Text, nullable=False)  # JSON array of tempo changes
    # Where the grid came from: "generated" (placeholder from track BPM, not
    # saved info), "analyzed" (native grid Analysis, ADR 0024), "edited"
    # (user-touched), or "imported" (External Import).
    origin = Column(String, nullable=False, default="edited", server_default="edited")
    # The downbeat the user explicitly marked (track-time seconds, ADR 0016).
    # Anchor-preserving re-tempo respaces beats around it; nudges shift it
    # with the grid. NULL = no mark; fall back to the first downbeat.
    anchor_time = Column(Float, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship (one-to-one: track_id is unique)
    track = relationship("Track", backref=backref("beatgrid", uselist=False))


class GridAnalysis(Base):
    """Native grid Analysis diagnostics (ADR 0024): the fit's verdict and
    evidence, one row per Track, overwritten on every run (no versioning —
    supersedes the old BPMAnalysis estimate rows). The grid itself lives on
    Beatgrid (origin "analyzed"); a bailed row with no saved grid puts the
    Track on the needs-attention worklist."""

    __tablename__ = "grid_analyses"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    candidate = Column(String, nullable=False)  # analyzer name (e.g. "madmom_dbn")
    bailed = Column(Boolean, nullable=False)
    bpm = Column(Float, nullable=True)  # NULL when bailed
    phase = Column(Float, nullable=True)  # first-beat time mod period (seconds)
    residual_ms = Column(Float, nullable=True)  # RMS tick deviation from the grid
    evidence_json = Column(Text, nullable=False)  # fit evidence / bail reason
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship (one-to-one: track_id is unique)
    track = relationship("Track", backref=backref("grid_analysis", uselist=False))


class KeyAnalysis(Base):
    __tablename__ = "key_analyses"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    key = Column(String, nullable=False)  # Musical notation (e.g., "Am", "C")
    musical = Column(String, nullable=False)  # Musical notation
    openkey = Column(String, nullable=True)  # OpenKey notation
    camelot = Column(String, nullable=True)  # Camelot notation
    engine_id = Column(Integer, nullable=True)  # Engine DJ key ID (0-23)
    confidence = Column(Float, nullable=False)  # Detection confidence
    scale = Column(String, nullable=False)  # "major" or "minor"
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship
    track = relationship("Track", backref="key_analysis", uselist=False)


class Transition(Base):
    """A saved Transition between an ordered Track pair (ADR 0010/0011).

    Identity is the client-generated `uuid` (stable across renames/deletes);
    `position` is cosmetic append order within the pair and may renumber.
    The drawn payload (anchors, lanes, tempo-match, hidden lanes) is opaque
    JSON — never queried, still churning. Write model is client-authoritative
    pair-replace (see routers/transitions.py).
    """

    __tablename__ = "transitions"

    id = Column(Integer, primary_key=True, index=True)
    a_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    b_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    uuid = Column(String, nullable=False)
    position = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    favorite = Column(Boolean, nullable=False, default=False, server_default="0")
    data_json = Column(Text, nullable=False)  # anchors + lanes (opaque drawing)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # ORM-level cascade (SQLite FK PRAGMA is off in this app; the ondelete
    # markers above record intent). ADR 0011: revisit when soft-delete lands.
    a_track = relationship(
        "Track",
        foreign_keys=[a_track_id],
        backref=backref("transitions_out", cascade="all, delete-orphan"),
    )
    b_track = relationship(
        "Track",
        foreign_keys=[b_track_id],
        backref=backref("transitions_in", cascade="all, delete-orphan"),
    )

    __table_args__ = (
        Index("idx_transitions_a", "a_track_id"),
        Index("idx_transitions_b", "b_track_id"),
        Index("idx_transitions_pair_uuid", "a_track_id", "b_track_id", "uuid", unique=True),
    )


class TransitionTemplate(Base):
    """A saved Transition template (mix-editor issues 03 + 28).

    A beat-domain recipe for producing a Transition, in two parts: the
    ALIGNMENT RULE — B's anchor (a cue slot or the grid origin) lands on
    A's anchor plus a single whole-beat delta on A's grid — and the WINDOW,
    whole beats before/after the alignment instant (free-signed; total
    ≥ 0, zero being a hard cut at the anchor). Plus scalable flag and
    sparse normalized lanes. Global — no track FKs; applying to a pair
    happens entirely client-side. Identity is the client-generated `uuid`;
    names are cosmetic and may duplicate. Recipe columns are queryable by
    design (unlike Transitions' opaque payload); only the lanes stay
    opaque JSON.
    """

    __tablename__ = "transition_templates"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, nullable=False)
    name = Column(String, nullable=False)
    align_a_base = Column(String, nullable=False)  # "cue_1".."cue_8" | "grid_origin"
    align_delta_beats = Column(Integer, nullable=False)
    align_b_base = Column(String, nullable=False)
    before_beats = Column(Integer, nullable=False)
    after_beats = Column(Integer, nullable=False)
    scalable = Column(Boolean, nullable=False, default=False, server_default="0")
    lanes_json = Column(Text, nullable=False)  # sparse normalized lanes (opaque)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_transition_templates_uuid", "uuid", unique=True),
    )


class Take(Base):
    """A detected Handover captured during live playback (ADR 0020,
    transition-takes 02).

    a = outgoing Track, b = incoming (directional, matching Transitions).
    Immutable audit data: rows are created by the frontend detector when a
    Handover settles and only ever deleted or given a promoted-Transition
    reference (issue 03). The raw event slice and the detector-parameter
    snapshot are opaque JSON — the evidence, re-derivable as detection and
    vectorization improve; the queryable columns are the history/tuning
    metadata. Identity is the client-generated `uuid`.
    """

    __tablename__ = "takes"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, nullable=False)
    a_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    b_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    detected_at = Column(DateTime, nullable=False, default=func.now())
    window_start_s = Column(Float, nullable=False)  # capture-clock seconds
    window_end_s = Column(Float, nullable=False)
    confidence = Column(Float, nullable=False)
    detector_version = Column(Integer, nullable=False)
    params_json = Column(Text, nullable=False)  # detector-parameter snapshot (opaque)
    events_json = Column(Text, nullable=False)  # raw capture-event slice (opaque)
    promoted_transition_uuid = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # ORM-level cascade, as on Transition (SQLite FK PRAGMA is off).
    a_track = relationship(
        "Track",
        foreign_keys=[a_track_id],
        backref=backref("takes_out", cascade="all, delete-orphan"),
    )
    b_track = relationship(
        "Track",
        foreign_keys=[b_track_id],
        backref=backref("takes_in", cascade="all, delete-orphan"),
    )

    __table_args__ = (
        Index("idx_takes_uuid", "uuid", unique=True),
        Index("idx_takes_a", "a_track_id"),
        Index("idx_takes_b", "b_track_id"),
        Index("idx_takes_detected_at", "detected_at"),
    )


class HotCue(Base):
    __tablename__ = "hotcues"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    slot_number = Column(Integer, nullable=False)  # 1-8
    time_seconds = Column(Float, nullable=False)
    label = Column(String, nullable=True)
    color = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship
    track = relationship("Track", backref="hotcues")

    __table_args__ = (
        Index("idx_hotcues_track", "track_id"),
        Index("idx_hotcues_unique", "track_id", "slot_number", unique=True),
    )


class TrackLink(Base):
    """A Linked pair (linked-pairs PRD): a stored, symmetric assertion that
    two Tracks go well together. One row per unordered pair of distinct
    Tracks, stored canonically (low_track_id < high_track_id). Bare edge —
    no payload beyond created_at. Write-independent of Transition favorites.
    """

    __tablename__ = "track_links"

    id = Column(Integer, primary_key=True, index=True)
    low_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    high_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=func.now())

    # ORM-level cascade (SQLite FK PRAGMA is off in this app; the ondelete
    # markers above record intent), matching the transitions pattern.
    low_track = relationship(
        "Track",
        foreign_keys=[low_track_id],
        backref=backref("links_low", cascade="all, delete-orphan"),
    )
    high_track = relationship(
        "Track",
        foreign_keys=[high_track_id],
        backref=backref("links_high", cascade="all, delete-orphan"),
    )

    __table_args__ = (
        CheckConstraint("low_track_id < high_track_id", name="ck_track_links_ordered"),
        Index("idx_track_links_pair", "low_track_id", "high_track_id", unique=True),
        Index("idx_track_links_high", "high_track_id"),
    )


class Set(Base):
    """A Set (sets PRD): an ordered sequence of Tracks whose adjacencies
    pin evidence (issue 02). Sidebar sibling of Playlist — but where a
    Playlist's identity is hand-curated order for Export, a Set's identity
    is its adjacencies and what they pin. A Set is a plan over the library,
    never an owner: deleting one touches no Track/Transition/Take.
    """

    __tablename__ = "sets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    color = Column(String)  # Hex color (sidebar accent)
    display_order = Column(Integer, nullable=False, default=0, server_default="0")
    # Tempo policy (sets 06): "riding" (Tempo returns after each window)
    # or "fixed" (everything pitched to set_tempo_bpm). One policy per Set.
    tempo_policy = Column(String, nullable=False, default="riding", server_default="riding")
    # Explicit Set tempo (Fixed policy); null = default from the first
    # track's native BPM at plan time.
    set_tempo_bpm = Column(Float, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    entries = relationship(
        "SetEntry",
        back_populates="set",
        cascade="all, delete-orphan",
        order_by="SetEntry.position",
    )
    # Dormant pins (sets 07): broken-pin memories, per ordered pair.
    dormant_pins = relationship(
        "SetDormantPin",
        back_populates="set",
        cascade="all, delete-orphan",
        order_by="SetDormantPin.id",
    )


class SetEntry(Base):
    """One ordered Set entry. A Track appears at most once per Set (same
    invariant as Playlist), which makes track_id the entry identity — the
    client-authoritative wholesale replace (ADR 0011 pattern) reconciles
    by it. Position is the payload index.

    The pin columns (sets 02) describe the adjacency this entry HEADS
    (this entry → the next): an explicit, nullable, stable reference to a
    saved Transition (by uuid), a Take (by uuid — ADR 0023), or nothing
    (Unresolved = playback hard-cuts). Deliberately NOT foreign keys: the
    backend stores what the client asserts, and dangling pins degrade to
    unresolved client-side rather than break (PRD). The last entry's pin
    is always null.
    """

    __tablename__ = "set_entries"

    id = Column(Integer, primary_key=True, index=True)
    set_id = Column(Integer, ForeignKey("sets.id", ondelete="CASCADE"), nullable=False)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    position = Column(Integer, nullable=False)
    pin_kind = Column(String, nullable=True)  # "transition" | "take" | "hardcut" | NULL
    pin_uuid = Column(String, nullable=True)  # NULL for hardcut (references nothing)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    set = relationship("Set", back_populates="entries")
    track = relationship("Track")

    __table_args__ = (
        Index("idx_set_entries_set", "set_id"),
        Index("idx_set_entries_position", "set_id", "position"),
        # A Track appears at most once per Set (entry identity).
        Index("uq_set_entries_set_track", "set_id", "track_id", unique=True),
    )


class SetDormantPin(Base):
    """A Set's memory of a broken pin (sets 07, "Dormant pin"): when a
    reorder/removal breaks a pinned adjacency, the pin is remembered per
    ORDERED track pair, per Set, and restored automatically when that
    pair becomes adjacent in that Set again. Strictly per-Set — other
    Sets never see it. At most one memory per (set, ordered pair).

    Like SetEntry pins, pin_uuid is deliberately NOT a foreign key (the
    backend stores what the client asserts) — but the deletion paths
    DROP Dormant memories referencing deleted artifacts (degrade_pins),
    and promotion re-points Dormant Take pins, exactly like active pins.
    Track ids ARE foreign keys: a Track deleted from the library takes
    its memories with it.
    """

    __tablename__ = "set_dormant_pins"

    id = Column(Integer, primary_key=True, index=True)
    set_id = Column(Integer, ForeignKey("sets.id", ondelete="CASCADE"), nullable=False)
    a_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    b_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    pin_kind = Column(String, nullable=False)  # "transition" | "take" | "hardcut"
    pin_uuid = Column(String, nullable=True)  # NULL for hardcut (sets 26)
    created_at = Column(DateTime, default=func.now())

    set = relationship("Set", back_populates="dormant_pins")

    __table_args__ = (
        Index("idx_set_dormant_pins_set", "set_id"),
        # One memory per ordered pair per Set (a fresh break overwrites).
        Index(
            "uq_set_dormant_pins_set_pair", "set_id", "a_track_id", "b_track_id", unique=True
        ),
    )
