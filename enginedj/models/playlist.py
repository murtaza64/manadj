"""Playlist model for Engine DJ database."""

from typing import TYPE_CHECKING

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped, relationship

from ..base import Base, intpk

if TYPE_CHECKING:
    from .playlist_entity import PlaylistEntity


class Playlist(Base):
    """
    Playlist with hierarchical structure and linked list ordering.

    Uses self-referential parentListId for hierarchy and nextListId for sibling ordering.
    Database triggers maintain playlist hierarchy and ordering integrity.

    Note: nextListId implements a linked list - SQLAlchemy doesn't natively support this,
    so traversal requires custom logic or loading all items.
    """

    __tablename__ = "Playlist"

    id: Mapped[intpk]
    title: Mapped[str | None]

    # Hierarchy via parent reference
    parentListId: Mapped[int | None]

    # Linked list ordering (nextListId points to next sibling)
    nextListId: Mapped[int | None]

    # Status
    isPersisted: Mapped[bool | None]
    isExplicitlyExported: Mapped[bool | None]

    # Timestamps (stored as Unix timestamps - integers)
    lastEditTime: Mapped[int | None]

    # Relationships
    entities: Mapped[list["PlaylistEntity"]] = relationship(
        back_populates="playlist",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("title", "parentListId", name="C_NAME_UNIQUE_FOR_PARENT"),
        UniqueConstraint("parentListId", "nextListId",
                        name="C_NEXT_LIST_ID_UNIQUE_FOR_PARENT"),
    )

    def __repr__(self) -> str:
        return f"<Playlist(id={self.id}, title={self.title!r}, parent={self.parentListId})>"
