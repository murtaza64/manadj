"""SQLAlchemy models for Acquisition."""

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..models import Base


class SourceItem(Base):
    """A track on a Source that manadj considers a candidate for acquisition."""

    __tablename__ = "source_items"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_source_external_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source: Mapped[str] = mapped_column(String, nullable=False, default="soundcloud")
    external_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    uploader: Mapped[str] = mapped_column(String, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    permalink_url: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False, default="new", index=True)
    # Classification: track/mix/clip/other. NULL = not yet classified; Refresh
    # fills NULLs from heuristics, so overrides (always non-NULL) are never touched.
    classification: Mapped[str | None] = mapped_column(String, nullable=True)
    liked_at: Mapped[str | None] = mapped_column(String, nullable=True)  # ISO ts from the Source
    first_fetched_at: Mapped[datetime | None] = mapped_column(DateTime, default=func.now())


# Correspondence statuses: 'proposed' awaits user review; 'confirmed' fulfills
# the Source Item; 'rejected' is remembered so matching never re-proposes it.
CORRESPONDENCE_STATUSES = ("proposed", "confirmed", "rejected")


class SourceCorrespondence(Base):
    """Source Correspondence: 'this Track is that Source track' (see CONTEXT.md).

    Keyed to the Source Item row (which carries the Source's stable external
    ID). Independent of where the Track's audio came from.
    """

    __tablename__ = "source_correspondences"
    __table_args__ = (
        UniqueConstraint("source_item_id", name="uq_correspondence_source_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("source_items.id"), nullable=False, index=True
    )
    track_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracks.id"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="proposed")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=func.now())
