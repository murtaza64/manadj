"""PreparelistEntity model for Engine DJ database."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, relationship, mapped_column

from ..base import Base, intpk

if TYPE_CHECKING:
    from .track import Track


class PreparelistEntity(Base):
    """Track preparation queue for DJs."""

    __tablename__ = "PreparelistEntity"

    id: Mapped[intpk]
    trackId: Mapped[int | None] = mapped_column(
        ForeignKey("Track.id", ondelete="CASCADE")
    )
    trackNumber: Mapped[int | None]

    # Relationships
    track: Mapped["Track | None"] = relationship(back_populates="preparelist_entities")

    __table_args__ = (
        Index("index_PreparelistEntity_trackId", "trackId"),
    )

    def __repr__(self) -> str:
        return f"<PreparelistEntity(id={self.id}, trackId={self.trackId}, pos={self.trackNumber})>"
