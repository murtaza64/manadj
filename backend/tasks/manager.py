"""Task lifecycle: create, run, recover, inspect (ADR-0003).

run_pending is the synchronous entry point; the background thread in
backend.tasks.worker just calls it in a loop.
"""

import json
import logging
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from ..acquisition.source import RateLimitedError
from .models import Task

logger = logging.getLogger(__name__)

Handler = Callable[[Session, dict[str, Any]], None]

# Rate-limit backoff schedule (issue 08): minutes to defer a task on each
# successive 429. The final entry is the last retry; beyond it the task fails.
BACKOFF_MINUTES = (5, 10, 20, 40, 80)
MAX_ATTEMPTS = len(BACKOFF_MINUTES)


def create_task(
    db: Session, type_: str, payload: dict[str, Any], ref: str | None = None
) -> Task:
    task = Task(type=type_, payload_json=json.dumps(payload), ref=ref)
    db.add(task)
    db.commit()
    return task


def run_pending(
    db: Session,
    handlers: dict[str, Handler],
    delays: dict[str, float] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """Run all pending tasks THIS worker has handlers for, oldest first.
    Returns the number processed.

    Tasks of other types are left pending — a worker without a handler
    (a stale pre-restart process, or one with a handler disabled by env)
    must not claim work it cannot do: during the waveform-overhaul landing,
    an old in-memory backend drained and failed ~1000 freshly-enqueued
    waveform tasks it had no handler for.

    A failing task records its error and never stops the queue.

    `delays` maps task type -> seconds to pace between tasks of that type
    (issue 08): after running such a task, the worker sleeps before the next.
    `sleep` is injectable so tests don't actually wait.
    """
    if not handlers:
        return 0
    delays = delays or {}
    processed = 0
    while True:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        task = (
            db.query(Task)
            .filter(
                Task.state == "pending",
                Task.type.in_(handlers.keys()),
                (Task.not_before.is_(None)) | (Task.not_before <= now),
            )
            .order_by(Task.id)
            .first()
        )
        if task is None:
            return processed
        task_type = task.type
        task.state = "running"
        task.started_at = now
        db.commit()
        try:
            handler = handlers[task_type]
            handler(db, task.payload)
        except RateLimitedError as e:
            db.rollback()
            _defer_for_rate_limit(db, task, e)
            processed += 1
            continue
        except Exception as e:
            db.rollback()
            task.state = "failed"
            task.error = str(e)
            logger.warning("task %d (%s) failed: %s", task.id, task_type, e)
        else:
            task.state = "done"
        task.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        processed += 1
        # Pace successive tasks of a delayed type (issue 08).
        delay = delays.get(task_type, 0.0)
        if delay > 0:
            sleep(delay)


def _defer_for_rate_limit(db: Session, task: Task, error: RateLimitedError) -> None:
    """Handle a 429 on `task`: back off this task and cool down its whole type.

    The offending task returns to `pending` with an incremented attempt count
    and a `not_before` set per the backoff schedule — until attempts are
    exhausted, at which point it becomes a real `failed`. On any 429 the entire
    remaining pending queue of the same type is deferred by the same cool-down
    so the sequential worker does not fast-fail the rest (issue 08).
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    task.attempts += 1
    task.started_at = None
    if task.attempts >= MAX_ATTEMPTS:
        task.state = "failed"
        task.error = f"rate-limited after {task.attempts} attempts: {error}"
        task.finished_at = now
        logger.warning("task %d (%s) failed after %d rate-limit attempts", task.id, task.type, task.attempts)
        db.commit()
        return

    backoff = timedelta(minutes=BACKOFF_MINUTES[task.attempts - 1])
    cooldown_until = now + backoff
    task.state = "pending"
    task.not_before = cooldown_until
    task.error = None

    # Queue-wide cool-down: one 429 means the budget is spent — hold back
    # every other pending task of this type too (never pull anything forward).
    others = (
        db.query(Task)
        .filter(
            Task.state == "pending",
            Task.type == task.type,
            Task.id != task.id,
            (Task.not_before.is_(None)) | (Task.not_before < cooldown_until),
        )
        .all()
    )
    for other in others:
        other.not_before = cooldown_until
    db.commit()
    logger.info(
        "task %d (%s) rate-limited (attempt %d); deferred %d tasks until %s",
        task.id,
        task.type,
        task.attempts,
        len(others) + 1,
        cooldown_until.isoformat(),
    )


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
