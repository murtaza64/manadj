"""The in-process background worker threads (ADR-0003, gh#224).

One TaskWorker per concurrency lane (backend.tasks.lanes): each thread polls
only its own task types, so pacing sleeps and rate-limit cool-downs in one
lane never stall another. Within a lane, tasks stay strictly serialized.
"""

import logging
import threading

from sqlalchemy.orm import sessionmaker

from .manager import Handler, recover_interrupted, run_pending

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECS = 2.0


class TaskWorker:
    """Polls for pending tasks of its lane's types and runs them, one at a time."""

    def __init__(
        self,
        session_factory: "sessionmaker",  # type: ignore[type-arg]
        handlers: dict[str, Handler],
        poll_interval: float = POLL_INTERVAL_SECS,
        delays: dict[str, float] | None = None,
        name: str = "task-worker",
    ) -> None:
        self._session_factory = session_factory
        self._handlers = handlers
        self._poll_interval = poll_interval
        self._delays = delays or {}
        self._name = name
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        db = self._session_factory()
        try:
            # Scoped to this worker's types: another lane's worker may already
            # be running a task, which must not be re-queued out from under it.
            recover_interrupted(db, types=list(self._handlers))
        finally:
            db.close()
        self._thread = threading.Thread(target=self._loop, name=self._name, daemon=True)
        self._thread.start()
        logger.info("task worker %s started (types: %s)", self._name, sorted(self._handlers))

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=10)

    def _loop(self) -> None:
        while not self._stop.is_set():
            db = self._session_factory()
            try:
                run_pending(db, self._handlers, delays=self._delays)
            except Exception:
                logger.exception("task worker %s iteration failed", self._name)
            finally:
                db.close()
            self._stop.wait(self._poll_interval)
