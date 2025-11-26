"""Track model for Engine DJ database."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, relationship, mapped_column

from ..base import Base, intpk

if TYPE_CHECKING:
    from .album_art import AlbumArt
    from .performance_data import PerformanceData
    from .playlist_entity import PlaylistEntity
    from .preparelist import PreparelistEntity
    from .history import HistorylistEntity


class Track(Base):
    """
    Track metadata and file information.

    Represents a music track with all its metadata, file information, analysis data,
    and relationships to playlists and performance data.

    Note: Database triggers handle ID validation, origin defaults, and timestamp updates.
    These are not enforced by SQLAlchemy in read-only mode.
    """

    __tablename__ = "Track"

    # Primary Key
    id: Mapped[intpk]

    # Playback & Analysis
    playOrder: Mapped[int | None]
    length: Mapped[int | None]  # Duration in seconds/milliseconds
    bpm: Mapped[int | None]
    bpmAnalyzed: Mapped[float | None]
    key: Mapped[int | None]  # 0-23 (Camelot wheel mapping)

    # File Info
    path: Mapped[str | None] = mapped_column(unique=True)
    filename: Mapped[str | None]
    fileType: Mapped[str | None]
    fileBytes: Mapped[int | None]
    bitrate: Mapped[int | None]

    # Metadata
    title: Mapped[str | None]
    artist: Mapped[str | None]
    album: Mapped[str | None]
    genre: Mapped[str | None]
    comment: Mapped[str | None]
    label: Mapped[str | None]
    composer: Mapped[str | None]
    remixer: Mapped[str | None]
    year: Mapped[int | None]
    rating: Mapped[int | None]

    # Foreign Keys
    albumArtId: Mapped[int | None] = mapped_column(
        ForeignKey("AlbumArt.id", ondelete="RESTRICT")
    )
    albumArt: Mapped[str | None]  # Legacy field, use albumArtId instead

    # Status Flags
    isAnalyzed: Mapped[bool | None]
    isPlayed: Mapped[bool | None]
    isAvailable: Mapped[bool | None]
    isMetadataImported: Mapped[bool | None]
    isMetadataOfPackedTrackChanged: Mapped[bool | None]
    isPerfomanceDataOfPackedTrackChanged: Mapped[bool | None]
    isBeatGridLocked: Mapped[bool | None]
    explicitLyrics: Mapped[bool | None]

    # Timestamps (stored as Unix timestamps - integers)
    dateCreated: Mapped[int | None]
    dateAdded: Mapped[int | None]
    timeLastPlayed: Mapped[int | None]
    lastEditTime: Mapped[int | None]

    # Origin Tracking (for sync across devices)
    originDatabaseUuid: Mapped[str | None]
    originTrackId: Mapped[int | None]

    # Streaming
    streamingSource: Mapped[str | None]
    uri: Mapped[str | None]
    streamingFlags: Mapped[int | None]

    # Other
    playedIndicator: Mapped[int | None]
    pdbImportKey: Mapped[int | None]

    # Relationships
    album_art_obj: Mapped["AlbumArt | None"] = relationship(back_populates="tracks")
    performance_data: Mapped["PerformanceData | None"] = relationship(
        back_populates="track",
        uselist=False,
        cascade="all, delete-orphan"
    )
    playlist_entities: Mapped[list["PlaylistEntity"]] = relationship(
        back_populates="track",
        cascade="all, delete-orphan"
    )
    preparelist_entities: Mapped[list["PreparelistEntity"]] = relationship(
        back_populates="track",
        cascade="all, delete-orphan"
    )
    history_entities: Mapped[list["HistorylistEntity"]] = relationship(
        back_populates="track",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("originDatabaseUuid", "originTrackId",
                        name="C_originDatabaseUuid_originTrackId"),
        Index("index_Track_filename", "filename"),
        Index("index_Track_albumArtId", "albumArtId"),
        Index("index_Track_uri", "uri"),
        Index("index_Track_title", "title"),
        Index("index_Track_length", "length"),
        Index("index_Track_rating", "rating"),
        Index("index_Track_year", "year"),
        Index("index_Track_dateAdded", "dateAdded"),
        Index("index_Track_genre", "genre"),
        Index("index_Track_artist", "artist"),
        Index("index_Track_album", "album"),
        Index("index_Track_key", "key"),
    )

    def __repr__(self) -> str:
        return f"<Track(id={self.id}, title={self.title!r}, artist={self.artist!r})>"
