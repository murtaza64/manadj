"""Smartlist model for Engine DJ database."""

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


class Smartlist(Base):
    """
    Dynamic playlists with rule-based track selection.

    Uses TEXT UUID as primary key and path-based hierarchy.
    Rules are stored as TEXT (format not parsed in read-only mode).
    """

    __tablename__ = "Smartlist"

    # UUID as primary key (TEXT, not INTEGER)
    listUuid: Mapped[str] = mapped_column(String, primary_key=True)

    title: Mapped[str | None]

    # Path-based hierarchy
    parentPlaylistPath: Mapped[str | None]
    nextPlaylistPath: Mapped[str | None]
    nextListUuid: Mapped[str | None]

    # Rules stored as TEXT (JSON or custom format - kept opaque)
    rules: Mapped[str | None]

    # Timestamps (stored as Unix timestamps - integers)
    lastEditTime: Mapped[int | None]

    __table_args__ = (
        UniqueConstraint("title", "parentPlaylistPath",
                        name="C_NAME_UNIQUE_FOR_PARENT"),
        UniqueConstraint("parentPlaylistPath", "nextPlaylistPath", "nextListUuid",
                        name="C_NEXT_LIST_UNIQUE_FOR_PARENT"),
    )

    def __repr__(self) -> str:
        return f"<Smartlist(uuid={self.listUuid}, title={self.title!r})>"
