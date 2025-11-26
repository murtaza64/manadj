"""PlaylistEntity model for Engine DJ database."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, relationship, mapped_column

from ..base import Base, intpk

if TYPE_CHECKING:
    from .playlist import Playlist
    from .track import Track


class PlaylistEntity(Base):
    """
    Link between playlists and tracks with ordering.

    Uses linked list ordering via nextEntityId for track order within playlists.
    Supports cross-database track references via databaseUuid.

    Note: nextEntityId implements a linked list for track ordering.
    """

    __tablename__ = "PlaylistEntity"

    id: Mapped[intpk]

    # Foreign Keys
    listId: Mapped[int | None] = mapped_column(
        ForeignKey("Playlist.id", ondelete="CASCADE")
    )
    trackId: Mapped[int | None] = mapped_column(
        ForeignKey("Track.id")  # FK to Track, might reference external DB in practice
    )
    databaseUuid: Mapped[str | None]

    # Linked list ordering (nextEntityId points to next track in playlist)
    nextEntityId: Mapped[int | None]

    # Membership tracking
    membershipReference: Mapped[int | None]

    # Relationships
    playlist: Mapped["Playlist | None"] = relationship(back_populates="entities")
    track: Mapped["Track | None"] = relationship(back_populates="playlist_entities")

    __table_args__ = (
        UniqueConstraint("listId", "databaseUuid", "trackId",
                        name="C_NAME_UNIQUE_FOR_LIST"),
        Index("index_PlaylistEntity_nextEntityId_listId", "nextEntityId", "listId"),
    )

    def __repr__(self) -> str:
        return (f"<PlaylistEntity(id={self.id}, listId={self.listId}, "
                f"trackId={self.trackId})>")
