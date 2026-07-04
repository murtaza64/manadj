"""Task lifecycle: create, run, recover, inspect (ADR-0003).

run_pending is the synchronous entry point; the background thread in
backend.tasks.worker just calls it in a loop.
"""

import json
import logging
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from .models import Task

logger = logging.getLogger(__name__)

Handler = Callable[[Session, dict[str, Any]], None]


def create_task(
    db: Session, type_: str, payload: dict[str, Any], ref: str | None = None
) -> Task:
    task = Task(type=type_, payload_json=json.dumps(payload), ref=ref)
    db.add(task)
    db.commit()
    return task


def run_pending(db: Session, handlers: dict[str, Handler]) -> int:
    """Run all pending tasks THIS worker has handlers for, oldest first.
    Returns the number processed.

    Tasks of other types are left pending — a worker without a handler
    (a stale pre-restart process, or one with a handler disabled by env)
    must not claim work it cannot do: during the waveform-overhaul landing,
    an old in-memory backend drained and failed ~1000 freshly-enqueued
    waveform tasks it had no handler for.

    A failing task records its error and never stops the queue.
    """
    if not handlers:
        return 0
    processed = 0
    while True:
        task = (
            db.query(Task)
            .filter(Task.state == "pending", Task.type.in_(handlers.keys()))
            .order_by(Task.id)
            .first()
        )
        if task is None:
            return processed
        task.state = "running"
        task.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        try:
            handler = handlers[task.type]
            handler(db, task.payload)
        except Exception as e:
            db.rollback()
            task.state = "failed"
            task.error = str(e)
            logger.warning("task %d (%s) failed: %s", task.id, task.type, e)
        else:
            task.state = "done"
        task.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        processed += 1


def recover_interrupted(db: Session) -> int:
    """Re-queue tasks caught mid-flight by a crash or restart."""
    tasks = db.query(Task).filter(Task.state == "running").all()
    for task in tasks:
        task.state = "pending"
        task.started_at = None
    db.commit()
    if tasks:
        logger.info("recovered %d interrupted tasks", len(tasks))
    return len(tasks)


def list_tasks(
    db: Session, ref: str | None = None, state: str | None = None
) -> list[Task]:
    query = db.query(Task)
    if ref is not None:
        query = query.filter(Task.ref == ref)
    if state is not None:
        query = query.filter(Task.state == state)
    return query.order_by(Task.id.desc()).all()
