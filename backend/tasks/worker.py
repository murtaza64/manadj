"""The in-process background worker thread (ADR-0003)."""

import logging
import threading

from sqlalchemy.orm import sessionmaker

from .manager import Handler, recover_interrupted, run_pending

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECS = 2.0


class TaskWorker:
    """Polls for pending tasks and runs them, one at a time."""

    def __init__(
        self,
        session_factory: "sessionmaker",  # type: ignore[type-arg]
        handlers: dict[str, Handler],
        poll_interval: float = POLL_INTERVAL_SECS,
        delays: dict[str, float] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._handlers = handlers
        self._poll_interval = poll_interval
        self._delays = delays or {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        db = self._session_factory()
        try:
            recover_interrupted(db)
        finally:
            db.close()
        self._thread = threading.Thread(target=self._loop, name="task-worker", daemon=True)
        self._thread.start()
        logger.info("task worker started (types: %s)", sorted(self._handlers))

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
                logger.exception("task worker iteration failed")
            finally:
                db.close()
            self._stop.wait(self._poll_interval)
