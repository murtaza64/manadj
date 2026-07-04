"""SQLAlchemy models for music library database."""

from sqlalchemy import Boolean, Column, Integer, String, Text, Float, ForeignKey, DateTime, Index
from sqlalchemy.orm import backref, relationship, DeclarativeBase
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
    codec = Column(String, nullable=True)  # mp3/aac/alac/flac/pcm, from the file
    bitrate_kbps = Column(Integer, nullable=True)  # from the file
    filesize_bytes = Column(Integer, nullable=True)  # from the file
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    track_tags = relationship("TrackTag", back_populates="track", cascade="all, delete-orphan")


class Waveform(Base):
    __tablename__ = "waveforms"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    sample_rate = Column(Integer, nullable=False)
    duration = Column(Float, nullable=False)
    samples_per_peak = Column(Integer, nullable=False)
    low_peaks_json = Column(Text, nullable=False)  # JSON array for low frequency band (20-250Hz)
    mid_peaks_json = Column(Text, nullable=False)  # JSON array for mid frequency band (250-4000Hz)
    high_peaks_json = Column(Text, nullable=False)  # JSON array for high frequency band (4000-20000Hz)
    png_path = Column(String, nullable=True)  # Relative path to PNG waveform file
    cue_point_time = Column(Float, nullable=True)  # CUE point in seconds
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
    )


class Beatgrid(Base):
    __tablename__ = "beatgrids"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    tempo_changes_json = Column(Text, nullable=False)  # JSON array of tempo changes
    # Where the grid came from: "generated" (placeholder from track BPM, not
    # saved info), "edited" (user-touched), or "imported" (External Import).
    origin = Column(String, nullable=False, default="edited", server_default="edited")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship (one-to-one: track_id is unique)
    track = relationship("Track", backref=backref("beatgrid", uselist=False))


class BPMAnalysis(Base):
    __tablename__ = "bpm_analyses"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False, unique=True, index=True)
    estimates_json = Column(Text, nullable=False)  # JSON array of {method, bpm, confidence}
    recommended_bpms_json = Column(Text, nullable=False)  # JSON array of deduplicated BPMs
    recommended_bpm = Column(Integer, nullable=False)  # Most accurate BPM
    duration = Column(Float, nullable=False)  # Track duration in seconds
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship
    track = relationship("Track", backref="bpm_analysis", uselist=False)


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
    """A saved Transition template (mix-editor issue 03; ADR 0010 Amendment 2).

    A beat-domain recipe for producing a Transition: per-side anchor rules
    (base = a cue slot or the grid origin, plus a whole-beat delta on that
    track's own grid), a length in beats, scalable flag, and sparse
    normalized lanes. Global — no track FKs; applying to a pair happens
    entirely client-side. Identity is the client-generated `uuid`; names
    are cosmetic and may duplicate. Anchor rule columns are queryable by
    design (unlike Transitions' opaque payload, the recipe's shape is
    settled); only the lanes stay opaque JSON.
    """

    __tablename__ = "transition_templates"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String, nullable=False)
    name = Column(String, nullable=False)
    align_a_base = Column(String, nullable=False)  # "cue_1".."cue_8" | "grid_origin"
    align_a_delta_beats = Column(Integer, nullable=False)
    align_b_base = Column(String, nullable=False)
    align_b_delta_beats = Column(Integer, nullable=False)
    length_beats = Column(Integer, nullable=False)
    scalable = Column(Boolean, nullable=False, default=False, server_default="0")
    lanes_json = Column(Text, nullable=False)  # sparse normalized lanes (opaque)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_transition_templates_uuid", "uuid", unique=True),
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
