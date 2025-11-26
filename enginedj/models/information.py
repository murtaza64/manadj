"""Information model for Engine DJ database metadata."""

from sqlalchemy.orm import Mapped

from ..base import Base, intpk


class Information(Base):
    """Database metadata and schema version information."""

    __tablename__ = "Information"

    id: Mapped[intpk]
    uuid: Mapped[str | None]
    schemaVersionMajor: Mapped[int | None]
    schemaVersionMinor: Mapped[int | None]
    schemaVersionPatch: Mapped[int | None]
    currentPlayedIndiciator: Mapped[int | None]
    lastRekordBoxLibraryImportReadCounter: Mapped[int | None]

    def __repr__(self) -> str:
        return (f"<Information(id={self.id}, uuid={self.uuid}, "
                f"version={self.schemaVersionMajor}.{self.schemaVersionMinor}."
                f"{self.schemaVersionPatch})>")
