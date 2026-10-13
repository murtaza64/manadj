"""Generic task observability and failure-worklist API.

Every row carries a resolved subject (what the task is about, in words), a
human type label, where its fix lives, and measured progress when the
handler reports it (gh#342). The summary is what the TopBar badge shows:
attention = failures that still need someone (newest task for their
subject, undismissed), not a raw failed-row count.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, field_serializer
from sqlalchemy.orm import Session

from ..database import get_db
from ..tasks import manager
from ..tasks.models import TASK_STATES, Task
from ..tasks.subjects import resolve_subjects, type_fix, type_label

router = APIRouter()


class SubjectOut(BaseModel):
    kind: str  # track | source_item | session | other
    id: str
    label: str
    detail: str | None = None


class TaskRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    type_label: str = ""
    # "retry" | "acquisition" | "none": where a failure's next step lives
    fix: str = "retry"
    ref: str | None
    subject: SubjectOut | None = None
    state: str
    error: str | None
    attempts: int
    progress: float | None = None
    progress_label: str | None = None
    # a newer task exists for the same subject: this one is history
    superseded: bool = False
    not_before: datetime | None
    created_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    dismissed_at: datetime | None

    @field_serializer("not_before", "created_at", "started_at", "finished_at", "dismissed_at")
    def _utc(self, value: datetime | None) -> str | None:
        # stored naive-UTC; say so on the wire or browsers read them as local
        if value is None:
            return None
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


class TaskSummary(BaseModel):
    counts: dict[str, int]
    # failures that still need someone (newest task for their subject)
    attention: int
    attention_by_type: dict[str, int]
    running: list[TaskRow]
    # queued work by type label, so the badge can say what is coming
    pending_by_type: dict[str, int]
    # kept for callers of the old shape
    undismissed_failures: int


class TaskFilters(BaseModel):
    state: Literal["pending", "running", "done", "failed"] | None = None
    type: str | None = None


class BulkResult(BaseModel):
    updated: int


def _task_or_404(db: Session, task_id: int) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def rows(db: Session, tasks: list[Task]) -> list[TaskRow]:
    subjects = resolve_subjects(db, tasks)
    latest = manager.latest_per_ref(db, tasks)
    out = []
    for t in tasks:
        row = TaskRow.model_validate(t)
        row.type_label = type_label(t.type)
        row.fix = type_fix(t.type)
        subj = subjects.get(t.id)
        row.subject = SubjectOut(**vars(subj)) if subj else None
        row.superseded = t.id not in latest
        out.append(row)
    return out


@router.get("/summary", response_model=TaskSummary)
def get_summary(db: Session = Depends(get_db)) -> TaskSummary:
    counts, _running, failures = manager.task_summary(db)
    attention = manager.attention_tasks(db)
    by_type: dict[str, int] = {}
    for t in attention:
        by_type[type_label(t.type)] = by_type.get(type_label(t.type), 0) + 1
    active = manager.active_tasks(db)
    # a polling download (Soulseek) is a pending task between ticks, but its
    # bytes are moving: measured progress makes it running for the UI
    running = [t for t in active if t.state == "running" or t.progress is not None]
    pending_by_type: dict[str, int] = {}
    for t in active:
        if t.state == "pending" and t.progress is None:
            pending_by_type[type_label(t.type)] = pending_by_type.get(type_label(t.type), 0) + 1
    counts = {**counts, "running": len(running), "pending": counts["pending"] - sum(1 for t in running if t.state == "pending")}
    return TaskSummary(
        counts=counts,
        attention=len(attention),
        attention_by_type=by_type,
        running=rows(db, running),
        pending_by_type=pending_by_type,
        undismissed_failures=failures,
    )


@router.get("/attention", response_model=list[TaskRow])
def get_attention(db: Session = Depends(get_db)) -> list[TaskRow]:
    """The failure worklist, one entry per subject, newest first."""
    return rows(db, manager.attention_tasks(db))


@router.get("/active", response_model=list[TaskRow])
def get_active(limit: int = Query(default=200, ge=1, le=1000), db: Session = Depends(get_db)) -> list[TaskRow]:
    """Running tasks (with progress), then the queue in run order."""
    return rows(db, manager.active_tasks(db)[:limit])


@router.get("", response_model=list[TaskRow])
def get_tasks(
    state: str | None = None,
    type: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[TaskRow]:
    if state is not None and state not in TASK_STATES:
        raise HTTPException(status_code=422, detail="Unknown task state")
    # Unfiltered activity is bounded to seven days, except unresolved failures.
    # Supplying a filter opts into older history.
    recent_days = None if state is not None or type is not None else 7
    return rows(db, manager.list_tasks(db, state=state, type_=type, limit=limit, recent_days=recent_days))


@router.post("/bulk/retry", response_model=BulkResult)
def retry_filtered_tasks(
    filters: TaskFilters, db: Session = Depends(get_db)
) -> BulkResult:
    if filters.state not in (None, "failed"):
        raise HTTPException(status_code=409, detail="Only failed tasks can be retried")
    return BulkResult(updated=manager.retry_tasks(db, type_=filters.type))


@router.post("/bulk/dismiss", response_model=BulkResult)
def dismiss_filtered_tasks(
    filters: TaskFilters, db: Session = Depends(get_db)
) -> BulkResult:
    return BulkResult(
        updated=manager.dismiss_tasks(db, state=filters.state, type_=filters.type)
    )


@router.post("/{task_id}/retry", response_model=TaskRow)
def retry_one(task_id: int, db: Session = Depends(get_db)) -> TaskRow:
    task = _task_or_404(db, task_id)
    try:
        return rows(db, [manager.retry_task(db, task)])[0]
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{task_id}/dismiss", response_model=TaskRow)
def dismiss_one(task_id: int, db: Session = Depends(get_db)) -> TaskRow:
    return rows(db, [manager.dismiss_task(db, _task_or_404(db, task_id))])[0]
