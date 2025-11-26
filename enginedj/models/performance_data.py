"""PerformanceData model for Engine DJ database."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, relationship, mapped_column

from ..base import Base

if TYPE_CHECKING:
    from .track import Track


class PerformanceData(Base):
    """
    Performance and analysis data for tracks.

    Stores waveforms, beat grids, cues, and loops as compressed BLOBs.
    Has a one-to-one relationship with Track.

    Note: BLOBs are zlib-compressed and kept as opaque bytes in read-only mode.
    """

    __tablename__ = "PerformanceData"

    # trackId is both PK and FK (one-to-one)
    trackId: Mapped[int] = mapped_column(
        ForeignKey("Track.id", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True
    )

    # All BLOB fields - zlib compressed, kept as opaque bytes
    trackData: Mapped[bytes | None]  # Analysis metadata
    overviewWaveFormData: Mapped[bytes | None]  # Waveform visualization
    beatData: Mapped[bytes | None]  # Beat grid
    quickCues: Mapped[bytes | None]  # Hot cues
    loops: Mapped[bytes | None]  # Saved loops

    # Other fields
    thirdPartySourceId: Mapped[int | None]
    activeOnLoadLoops: Mapped[int | None]

    # Relationships
    track: Mapped["Track"] = relationship(back_populates="performance_data")

    def __repr__(self) -> str:
        return f"<PerformanceData(trackId={self.trackId})>"
