"""Generic task observability and failure-worklist API."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from ..database import get_db
from ..tasks import manager
from ..tasks.models import TASK_STATES, Task

router = APIRouter()


class TaskRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    ref: str | None
    state: str
    error: str | None
    attempts: int
    not_before: datetime | None
    created_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    dismissed_at: datetime | None


class TaskDescriptor(BaseModel):
    type: str
    ref: str | None


class TaskSummary(BaseModel):
    counts: dict[str, int]
    running_task: TaskDescriptor | None
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


@router.get("/summary", response_model=TaskSummary)
def get_summary(db: Session = Depends(get_db)) -> TaskSummary:
    counts, running, failures = manager.task_summary(db)
    return TaskSummary(
        counts=counts,
        running_task=(
            TaskDescriptor(type=running.type, ref=running.ref) if running else None
        ),
        undismissed_failures=failures,
    )


@router.get("", response_model=list[TaskRow])
def get_tasks(
    state: str | None = None,
    type: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> list[Task]:
    if state is not None and state not in TASK_STATES:
        raise HTTPException(status_code=422, detail="Unknown task state")
    # Unfiltered activity is bounded to seven days, except unresolved failures.
    # Supplying a filter opts into older history.
    recent_days = None if state is not None or type is not None else 7
    return manager.list_tasks(
        db, state=state, type_=type, limit=limit, recent_days=recent_days
    )


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
def retry_one(task_id: int, db: Session = Depends(get_db)) -> Task:
    task = _task_or_404(db, task_id)
    try:
        return manager.retry_task(db, task)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{task_id}/dismiss", response_model=TaskRow)
def dismiss_one(task_id: int, db: Session = Depends(get_db)) -> Task:
    return manager.dismiss_task(db, _task_or_404(db, task_id))
