"""SQLAlchemy models for music library database."""

import json

from sqlalchemy import Boolean, CheckConstraint, Column, Integer, LargeBinary, String, Text, Float, ForeignKey, DateTime, Index, and_, select, text
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
    # Where the key came from (ADR 0024): "analyzed" (native key Analysis),
    # "imported" (External Import), "manual" (direct user edit). NULL =
    # unknown (e.g. seeded from file tags) — ranks below everything on the
    # overwrite ladder, freely overwritable by bulk runs.
    key_provenance = Column(String, nullable=True)
    # Which backend produced the current `analyzed` key (currency marker for
    # the backfill, issue 11). NULL = not from the current native path.
    # Only meaningful while key_provenance == "analyzed".
    key_analysis_candidate = Column(String, nullable=True)
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

    # Hot-path indexes (performance-hardening 03, migration 0031). Session/
    # Take/Transition/Set lookups are already indexed — Track was the gap.
    __table_args__ = (
        # The is_active predicate (archived_at IS NULL) on every listing.
        Index("ix_tracks_archived_at", "archived_at"),
        # Default browse: active rows, newest-first (crud.get_tracks). Partial
        # over the active rows only — covers the default listing exactly.
        Index(
            "ix_tracks_active_created_at",
            "created_at",
            sqlite_where=text("archived_at IS NULL"),
        ),
        # Follow mode's dyadic BPM-fold gate (crud.get_tracks:104-117).
        Index("ix_tracks_bpm", "bpm"),
    )

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
    def bpm_projected(self) -> float | None:
        """Grid-first BPM (ADR 0027): the Beatgrid's dominant tempo when a
        real (non-generated) grid exists, else the bpm column projected to
        float BPM. THE served tempo — schemas.Track.bpm reads this; the bpm
        column is internal (SQL sort/filter, exports' cache) and can be
        stale (the Kambi→Raskal 2× incident). Dominant-tempo duration is
        the waveform's duration, duration_secs fallback (a NULL duration on
        a variable grid would silently yield the first segment's tempo)."""
        # Lazy imports: track_metadata.manager imports this module.
        from .beatgrid_utils import dominant_bpm
        from .track_metadata.units import centibpm_to_bpm

        grid = self.beatgrid
        if grid is not None and grid.origin != "generated":
            tempo_changes = json.loads(grid.tempo_changes_json)
            if tempo_changes:
                duration = self.duration_secs
                if len(tempo_changes) > 1:
                    # Only variable grids weight by duration — skip the
                    # waveform load for the constant-grid common case.
                    waveform = self.waveform
                    if waveform is not None:
                        duration = waveform.duration
                return dominant_bpm(tempo_changes, duration)
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


class MetricLadder(Base):
    """Persisted Metric-ladder deviation (ADR 0029): Reset marks + arities.

    Deviation-only (placeholder posture): no row = the computed default
    ladder (duple tiers, Grid origin, no marks) — rows come into existence
    only through authoring gestures. Reset marks are track-time seconds
    resolving to the nearest downbeat at read; grid operations never
    rewrite or invalidate them. Manadj-internal: outside Divergence,
    Sync, and Export."""

    __tablename__ = "metric_ladders"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    # Arity stack bottom-up from the bar (JSON list of 2|3). v1 authoring
    # keeps this at the duple default; stored for forward-compatibility.
    arities_json = Column(Text, nullable=False)
    # JSON list of Reset marks, track-time seconds, sorted ascending.
    reset_marks_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship (one-to-one: track_id is unique)
    track = relationship("Track", backref=backref("metric_ladder", uselist=False))


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


class Cameo(Base):
    """A saved Cameo (cameos PRD, issue #140): a guest Track's bounded
    appearance inside a host Track's play — the guest becomes audible and
    silent entirely within the host's play, and the host remains current.

    The survivor rule is the boundary with Transition: whoever remains
    current classifies the move. Mirrors the Transition storage pattern
    (ADR 0011): identity is the client-generated `uuid`, `position` is
    cosmetic append order within the ordered (host, guest) pair, and the
    payload — two-edged window in host track seconds, guest alignment,
    optional guest→host tempo-match, role-addressed lanes, Jumps on both
    roles — is opaque JSON under a client-authoritative pair-replace.
    A Track may Cameo over itself (host == guest is legal).
    """

    __tablename__ = "cameos"

    id = Column(Integer, primary_key=True, index=True)
    host_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    guest_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    uuid = Column(String, nullable=False)
    position = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    favorite = Column(Boolean, nullable=False, default=False, server_default="0")
    data_json = Column(Text, nullable=False)  # window + alignment + lanes (opaque)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # ORM-level cascade, as on Transition (SQLite FK PRAGMA is off).
    host_track = relationship(
        "Track",
        foreign_keys=[host_track_id],
        backref=backref("cameos_hosted", cascade="all, delete-orphan"),
    )
    guest_track = relationship(
        "Track",
        foreign_keys=[guest_track_id],
        backref=backref("cameos_guesting", cascade="all, delete-orphan"),
    )

    __table_args__ = (
        Index("idx_cameos_host", "host_track_id"),
        Index("idx_cameos_guest", "guest_track_id"),
        Index("idx_cameos_pair_uuid", "host_track_id", "guest_track_id", "uuid", unique=True),
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


class Session(Base):
    """The persisted whole event log of one stretch of live performance
    (Sessions PRD, ADR 0033, amended sessions 11).

    One row per stretch of live performance: the client opens a row on the
    first Master-audible instant and ends it at close or after ten
    continuous minutes of silence (the auto-split); one capture clock, all
    four Decks; no 100%-silent row survives. The events themselves live
    in `session_chunks` (append-only, streamed ~5s), keeping this row a thin
    header the Sessions list reads without touching the log. `ended_at` is
    nullable: an open Session (still recording, or an orphaned partial from
    a crash) has none. Identity is the client-generated `uuid`.

    Deleting a Session cascades its chunks and never touches a Take — Takes
    keep their own event slice and remain self-contained (ADR 0033).
    """

    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, nullable=False)
    started_at = Column(DateTime, nullable=False, default=func.now())
    ended_at = Column(DateTime, nullable=True)
    # Routine-miner currency marker (routines 157): the MINER_VERSION whose
    # suggestion rows this Session currently carries. NULL = never mined;
    # != routine_miner.MINER_VERSION = stale, the startup sweep re-enqueues.
    routine_miner_version = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    chunks = relationship(
        "SessionChunk",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionChunk.seq",
    )

    __table_args__ = (
        Index("idx_sessions_uuid", "uuid", unique=True),
        Index("idx_sessions_started_at", "started_at"),
    )


class SessionChunk(Base):
    """An append-only batch of capture events within a Session (ADR 0033).

    Chunks arrive in `seq` order (~5s flush cadence, plus gate transitions
    and page-hide). `events_json` is an opaque JSON array of the capture
    event vocabulary — the same opaque-JSON posture as a Take's slice; no
    binary format (ADR 0033). Whole chunks, never edited in place.
    """

    __tablename__ = "session_chunks"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)  # append order within the Session
    events_json = Column(Text, nullable=False)  # opaque JSON array of capture events
    created_at = Column(DateTime, default=func.now())

    session = relationship("Session", back_populates="chunks")

    __table_args__ = (
        Index("idx_session_chunks_session", "session_id"),
        Index("idx_session_chunks_session_seq", "session_id", "seq", unique=True),
    )


class RoutineCandidate(Base):
    """A miner-suggested Routine span on a Session's timeline (ADR 0035,
    routines 157).

    Suggestion, not evidence: the miner marks candidate spans and a human
    confirms one into a Routine Take — rows here count for nothing until
    confirmed. Recomputable at will: rows are keyed by `miner_version` and
    a version bump invalidates + re-mines (the Session carries the
    currency marker). `cast_json` is the entry-ordered cast (track ids,
    slot order); `entry_offsets_json` gives each slot's entry as seconds
    from `window_start_s` (slot 0 is always 0.0); the window is
    capture-clock seconds on the owning Session. `session_uuid` matches
    the Take posture (provenance string, not FK), but unlike Takes these
    rows die with their Session — a suggestion without its timeline is
    meaningless. No track FKs: casts live in JSON, and stale suggestions
    simply stop matching.

    `entry_track_id`/`exit_track_id` denormalize the boundary tracks for
    the cast-prefix query (the pin picker's "Routines available" hint:
    match candidates whose cast covers the Set's next-n entries, entering
    and exiting on the right tracks).
    """

    __tablename__ = "routine_candidates"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, nullable=False)
    session_uuid = Column(String, nullable=False)
    entry_track_id = Column(Integer, nullable=False)
    exit_track_id = Column(Integer, nullable=False)
    cast_json = Column(Text, nullable=False)  # JSON list of track ids, entry order
    window_start_s = Column(Float, nullable=False)  # capture-clock seconds
    window_end_s = Column(Float, nullable=False)
    entry_offsets_json = Column(Text, nullable=False)  # JSON list, per slot
    evidence_json = Column(Text, nullable=False)  # {"returns": n, "triples": n}
    miner_version = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_routine_candidates_uuid", "uuid", unique=True),
        Index("idx_routine_candidates_session", "session_uuid"),
        Index("idx_routine_candidates_entry", "entry_track_id"),
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

    A Take carries the Session it was born from (`session_uuid`, provenance
    not dependency — the Session may be deleted; ADR 0033) and an `origin`
    mark (`detected` for the detector's verdicts, `manual` for hand-cut
    Takes, issue 06). Pre-Sessions Takes are sessionless (`session_uuid`
    NULL) and count as `detected`.

    Cameos (#140): `kind` records the detector's settle verdict by the
    survivor rule — `handover` (a = outgoing, b = incoming) or `guest`
    (a CAMEO TAKE: a = the surviving host, b = the visiting guest).
    `engagement_uuid` stamps every capture from one engagement (the
    pairwise offspring of a multi-deck double/triple are a first-class
    group — the Transition history groups by it, never by timestamp
    inference). Pre-#140 rows backfill kind='handover', engagement NULL.
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
    # Provenance (ADR 0033): the Session this Take was detected/cut within
    # (nullable — the Session is prunable, and pre-Sessions Takes have none).
    session_uuid = Column(String, nullable=True)
    # How the Take came to be: "detected" (the detector) or "manual"
    # (hand-cut, issue 06). Never NULL for new rows; the migration backfills.
    origin = Column(String, nullable=False, default="detected")
    # Survivor-rule verdict (#140): "handover" or "guest" (a Cameo Take).
    kind = Column(String, nullable=False, default="handover", server_default="handover")
    # The engagement this capture settled from (#140) — shared by every
    # pairwise Take/Cameo Take one multi-deck engagement emits. Nullable:
    # pre-#140 rows and hand-cut Takes without one.
    engagement_uuid = Column(String, nullable=True)
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
        Index("idx_takes_session", "session_uuid"),
        Index("idx_takes_engagement", "engagement_uuid"),
    )


class RoutineTake(Base):
    """A hand-confirmed span of a Session — deck-literal, unreviewed
    evidence (ADR 0035, routines 158).

    The captured sibling of a Routine, minted only by a human confirming a
    miner-suggested candidate on the Session timeline (suggestion-first: no
    liberal auto-minting). Unlike a Take, the event slice is a REFERENCE
    (`session_uuid` + window on the capture clock), not a copy — the span is
    read from the Session's chunks at promotion/replay time. The row itself
    survives Session deletion (it is confirmed evidence and lives in the
    Transition history), but loses replay/promotion once its timeline is
    gone. `cast_json` is the entry-ordered cast (track ids = slot order,
    n ≥ 3 enforced at confirm — a 2-cast confirm is a hand-cut Take);
    `entry_offsets_json` gives each slot's entry as seconds from
    `window_start_s` (slot 0 = 0.0). `origin_candidate_uuid` is provenance
    only — candidate rows are recomputable and their uuids dangle after a
    re-mine. `promoted_routine_uuid` mirrors Take.promoted_transition_uuid:
    promotion never mutates the raw confirm (evidence doctrine).

    `entry_track_id`/`exit_track_id` denormalize the boundary tracks for
    cast-prefix queries (pin-picker parity with routine_candidates).
    """

    __tablename__ = "routine_takes"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, nullable=False)
    session_uuid = Column(String, nullable=False)
    entry_track_id = Column(Integer, nullable=False)
    exit_track_id = Column(Integer, nullable=False)
    cast_json = Column(Text, nullable=False)  # JSON list of track ids, entry order
    window_start_s = Column(Float, nullable=False)  # capture-clock seconds
    window_end_s = Column(Float, nullable=False)
    entry_offsets_json = Column(Text, nullable=False)  # JSON list, per slot, seconds
    origin_candidate_uuid = Column(String, nullable=True)
    promoted_routine_uuid = Column(String, nullable=True)
    confirmed_at = Column(DateTime, nullable=False, default=func.now())
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_routine_takes_uuid", "uuid", unique=True),
        Index("idx_routine_takes_session", "session_uuid"),
        Index("idx_routine_takes_entry", "entry_track_id"),
    )


class Routine(Base):
    """A saved n-track choreography (ADR 0035; CONTEXT.md "Routine").

    Promoted mechanically from a Routine Take: events re-addressed from
    physical Decks to entry-ordered CAST SLOTS (slot 0 = entry track,
    slot n−1 = exit track), and the clock rebased from capture seconds to
    beats via the cast Tracks' Beatgrids — so the Routine replays under any
    Set tempo policy. No gesture idealization (v1 is slot-remapped,
    beat-rebased raw replay; lane vectorization arrives with the Routine
    editor). `events_json` is the slot-addressed, beat-domain event list
    (each event carries `beat` + `slot`; global controls carry slot null);
    `entry_offsets_beats_json` gives each slot's entry in beats from
    Routine start; `entry_positions_json` gives each slot's track position
    (track-seconds) at its entry — together with the events this makes the
    Routine self-contained for replay. `origin_take_uuid` is provenance
    (the raw Routine Take stays untouched — evidence doctrine).
    """

    __tablename__ = "routines"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, nullable=False)
    name = Column(String, nullable=True)
    entry_track_id = Column(Integer, nullable=False)
    exit_track_id = Column(Integer, nullable=False)
    cast_json = Column(Text, nullable=False)  # JSON list of track ids, slot order
    entry_offsets_beats_json = Column(Text, nullable=False)  # JSON list, per slot
    entry_positions_json = Column(Text, nullable=False)  # JSON list, track-seconds
    duration_beats = Column(Float, nullable=False)
    events_json = Column(Text, nullable=False)  # slot-addressed, beat-domain (opaque)
    origin_take_uuid = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_routines_uuid", "uuid", unique=True),
        Index("idx_routines_entry", "entry_track_id"),
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
    # Cameo pins (#140): per-entry guest ornaments, keyed on host track
    # (active and dormant rows in one table — see SetCameoPin).
    cameo_pins = relationship(
        "SetCameoPin",
        back_populates="set",
        cascade="all, delete-orphan",
        order_by="SetCameoPin.position",
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
    # Per-entry trim (sets #164): an OFFSET from neutral in mixer-knob
    # units (0 = neutral; ±0.5 spans the knob), never an absolute level —
    # track Autogain (#35–#40, ADR 0034) composes with it when it lands
    # (effective knob = autogain + offset), so its arrival changes nothing
    # here. The Conductor applies it at Deck load for the entry's tenure.
    trim = Column(Float, nullable=False, default=0.0, server_default=text("0"))
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


class SetCameoPin(Base):
    """A Cameo pin on a Set entry (cameos PRD, #140): zero or more saved
    Cameos — or, manually, Cameo Takes — hosted by that entry's Track.
    Always manual (an ornament resolves to nothing: no Unresolved state,
    never auto-filled) and adjacency-independent (reordering never touches
    them).

    Keyed on (set, host track), NOT on the entry row: the entry identity
    is its track_id anyway, and Cameo-pin dormancy keys on the host Track
    per Set (glossary "Dormant pin") — `dormant` rows are the memory kept
    while the host Track is out of the Set, restored when it returns.
    Like every pin, pin_uuid is deliberately NOT a foreign key (the
    backend stores what the client asserts); the deletion paths DROP
    rows referencing deleted artifacts (degrade_cameo_pins — there is no
    Unresolved to degrade to). Wholesale-replaced with the entries PUT.
    """

    __tablename__ = "set_cameo_pins"

    id = Column(Integer, primary_key=True, index=True)
    set_id = Column(Integer, ForeignKey("sets.id", ondelete="CASCADE"), nullable=False)
    host_track_id = Column(Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)  # order within the entry's pins
    pin_kind = Column(String, nullable=False)  # "cameo" | "cameo-take"
    pin_uuid = Column(String, nullable=False)
    # Dormant (sets 07 extended, #140): the host Track left the Set; the
    # pin restores when it returns. Keyed on host Track per Set.
    dormant = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, default=func.now())

    set = relationship("Set", back_populates="cameo_pins")

    __table_args__ = (
        Index("idx_set_cameo_pins_set", "set_id"),
        Index("idx_set_cameo_pins_host", "set_id", "host_track_id"),
    )
