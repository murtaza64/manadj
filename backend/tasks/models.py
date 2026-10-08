"""SQLAlchemy model for tasks (ADR-0003)."""

import json
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..models import Base

TASK_STATES = ("pending", "running", "done", "failed")


class Task(Base):
    """One unit of background work, observable through its state."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    # Optional pointer to the domain object this task serves, e.g. "source_item:42"
    ref: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    state: Mapped[str] = mapped_column(String, nullable=False, default="pending", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Rate-limit backoff (issue 08): retry accounting and a deferral floor.
    # A pending task is only eligible once now() >= not_before (NULL = ready).
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    not_before: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Progress (gh#342): 0..1 and a short label ("4.2 / 9.0 MB"), written by
    # handlers that can measure their work; NULL = unmeasured. Survives a
    # Deferred re-queue (a polling download keeps its bar between ticks).
    progress: Mapped[float | None] = mapped_column(Float, nullable=True)
    progress_label: Mapped[str | None] = mapped_column(String, nullable=True)

    @property
    def payload(self) -> dict[str, Any]:
        data: dict[str, Any] = json.loads(self.payload_json)
        return data
