"""History models for Engine DJ database."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, relationship, mapped_column

from ..base import Base, intpk

if TYPE_CHECKING:
    from .track import Track


class Historylist(Base):
    """
    DJ session history metadata.

    Tracks DJ sessions and their metadata. Located in hm.db database.
    """

    __tablename__ = "Historylist"

    id: Mapped[intpk]
    sessionId: Mapped[str | None]
    title: Mapped[str | None]
    startTime: Mapped[int | None]  # Unix timestamp
    timezone: Mapped[str | None]

    # Origin tracking
    originDriveName: Mapped[str | None]
    originDatabaseUuid: Mapped[str | None]
    originListId: Mapped[int | None]

    # Status
    isDeleted: Mapped[bool | None]

    # Timestamps (stored as Unix timestamps - integers)
    editTime: Mapped[int | None]

    # Relationships
    entities: Mapped[list["HistorylistEntity"]] = relationship(
        back_populates="historylist",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("originDatabaseUuid", "originListId",
                        name="C_UNIQUE_ORIGIN_UUID_AND_LIST_ID"),
    )

    def __repr__(self) -> str:
        return f"<Historylist(id={self.id}, title={self.title!r}, session={self.sessionId})>"


class HistorylistEntity(Base):
    """
    Tracks played during a DJ session.

    Links tracks to history sessions with play timestamps. Located in hm.db database.
    """

    __tablename__ = "HistorylistEntity"

    id: Mapped[intpk]

    # Foreign Keys
    listId: Mapped[int | None] = mapped_column(
        ForeignKey("Historylist.id", ondelete="CASCADE")
    )
    trackId: Mapped[int | None] = mapped_column(
        ForeignKey("Track.id", ondelete="CASCADE")
    )

    # When track was played in this session (Unix timestamp)
    startTime: Mapped[int | None]

    # Relationships
    historylist: Mapped["Historylist | None"] = relationship(back_populates="entities")
    track: Mapped["Track | None"] = relationship(back_populates="history_entities")

    __table_args__ = (
        Index("index_HistorylistEntity_listId", "listId"),
        Index("index_HistorylistEntity_trackId", "trackId"),
    )

    def __repr__(self) -> str:
        return (f"<HistorylistEntity(id={self.id}, listId={self.listId}, "
                f"trackId={self.trackId})>")
