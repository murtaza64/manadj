"""SQLAlchemy models for music library database."""

from sqlalchemy import Column, Integer, String, Text, Float, ForeignKey, DateTime, Index
from sqlalchemy.orm import relationship, DeclarativeBase
from sqlalchemy.sql import func
from datetime import datetime


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

    # Relationship
    track = relationship("Track", backref="waveform", uselist=False)


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
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationship
    track = relationship("Track", backref="beatgrid", uselist=False)
