"""Pack model for Engine DJ database."""

from sqlalchemy.orm import Mapped

from ..base import Base, intpk


class Pack(Base):
    """Sync metadata for database packing/syncing operations."""

    __tablename__ = "Pack"

    id: Mapped[intpk]
    packId: Mapped[str | None]
    changeLogDatabaseUuid: Mapped[str | None]
    changeLogId: Mapped[int | None]
    lastPackTime: Mapped[int | None]  # Unix timestamp

    def __repr__(self) -> str:
        return f"<Pack(id={self.id}, packId={self.packId})>"
