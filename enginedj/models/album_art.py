"""AlbumArt model for Engine DJ database."""

from typing import TYPE_CHECKING

from sqlalchemy import Index
from sqlalchemy.orm import Mapped, relationship

from ..base import Base, intpk

if TYPE_CHECKING:
    from .track import Track


class AlbumArt(Base):
    """Album artwork storage with hash-based deduplication."""

    __tablename__ = "AlbumArt"

    id: Mapped[intpk]
    hash: Mapped[str | None]
    albumArt: Mapped[bytes | None]  # Raw image data (JPEG/PNG)

    # Relationships
    tracks: Mapped[list["Track"]] = relationship(back_populates="album_art_obj")

    __table_args__ = (
        Index("index_AlbumArt_hash", "hash"),
    )

    def __repr__(self) -> str:
        return f"<AlbumArt(id={self.id}, hash={self.hash})>"
