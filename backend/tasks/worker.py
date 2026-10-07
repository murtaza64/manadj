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

    def add_handlers(self, handlers: dict[str, Handler], delays: dict[str, float] | None = None) -> None:
        """Register handlers on a running worker (copy-on-write: the loop
        may be iterating the current dict)."""
        self._handlers = {**self._handlers, **handlers}
        if delays:
            self._delays = {**self._delays, **delays}
        logger.info("task worker handlers added: %s", sorted(handlers))

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


class TaskWorkerPool:
    """One TaskWorker per concurrency lane (backend.tasks.lanes, gh#224).

    Presents the same start/stop/add_handlers surface as a single TaskWorker;
    `add_handlers` routes each handler to its lane, extending that lane's
    running worker or starting a fresh one (a setup guide configuring
    SoundCloud/soulseek mid-session brings the lane up without a restart).
    """

    def __init__(
        self,
        session_factory: "sessionmaker",  # type: ignore[type-arg]
        handlers: dict[str, Handler],
        poll_interval: float = POLL_INTERVAL_SECS,
        delays: dict[str, float] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._poll_interval = poll_interval
        self._workers: dict[str, TaskWorker] = {}
        self._started = False
        self._add_lane_workers(handlers, delays or {})

    def _add_lane_workers(self, handlers: dict[str, Handler], delays: dict[str, float]) -> None:
        from .lanes import split_handlers

        for lane, lane_handlers in split_handlers(handlers).items():
            lane_delays = {t: delays[t] for t in lane_handlers if t in delays}
            worker = self._workers.get(lane)
            if worker is not None:
                worker.add_handlers(lane_handlers, delays=lane_delays)
                continue
            worker = TaskWorker(
                self._session_factory,
                lane_handlers,
                poll_interval=self._poll_interval,
                delays=lane_delays,
                name=f"task-worker-{lane}",
            )
            self._workers[lane] = worker
            if self._started:
                worker.start()

    def start(self) -> None:
        self._started = True
        for worker in self._workers.values():
            worker.start()

    def add_handlers(self, handlers: dict[str, Handler], delays: dict[str, float] | None = None) -> None:
        self._add_lane_workers(handlers, delays or {})

    def stop(self) -> None:
        self._started = False
        for worker in self._workers.values():
            worker.stop()
