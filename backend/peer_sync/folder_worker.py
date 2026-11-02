"""One application-owned polling thread; no import-time or OS service effects."""
import logging
from threading import Event, Thread

from .folder import FolderTransport

log = logging.getLogger(__name__)


class FolderWorker:
    def __init__(self, session_factory, interval=5):
        self.transport = FolderTransport(session_factory)
        self.interval = interval
        self.stopped = Event()
        self.thread = None

    def start(self):
        if self.thread is not None:
            return
        self.stopped.clear()
        self.thread = Thread(target=self._run, name="peer-folder", daemon=True)
        self.thread.start()

    def _run(self):
        while not self.stopped.is_set():
            try:
                self.transport.run_once()
            except Exception:
                # DB contention/failure retries next tick; never kills application workers.
                log.exception("peer folder cycle failed")
            self.stopped.wait(self.interval)

    def stop(self):
        self.stopped.set()
        if self.thread is not None:
            self.thread.join()
            self.thread = None
