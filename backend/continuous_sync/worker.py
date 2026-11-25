"""One application-owned sync loop with cancellation and bounded offline backoff.

No automatic enrollment or startup side effects. Host supplies authenticated
transport and starts/stops this worker with the managed app lifetime.
"""
import logging
from threading import Event, Thread

log = logging.getLogger(__name__)


class Worker:
    def __init__(self, pump, active_seconds=5, idle_seconds=60, max_backoff_seconds=300):
        if not 5 <= active_seconds <= idle_seconds <= max_backoff_seconds <= 3600:
            raise ValueError('bounded_sync_cadence_required')
        self.pump = pump
        self.active_seconds, self.idle_seconds, self.max_backoff_seconds = active_seconds, idle_seconds, max_backoff_seconds
        self.stopped = Event()
        self.thread = None
        self.failures = 0
        self.state = 'stopped'

    def step(self):
        try:
            result = self.pump.tick(limit=8)
            self.failures = 0
            self.state = 'synced'
            return self.active_seconds if result['published'] or result['applied'] else self.idle_seconds
        except Exception:
            # No payload, labels, tokens, paths or raw transport errors in logs.
            self.failures += 1
            self.state = 'retrying'
            log.warning('Continuous sync cycle failed; durable outbox retained')
            return min(self.max_backoff_seconds, self.active_seconds * 2 ** min(self.failures, 10))

    def start(self):
        if self.thread is not None:
            return
        self.stopped.clear()
        self.thread = Thread(target=self._run, name='continuous-sync', daemon=True)
        self.thread.start()

    def _run(self):
        while not self.stopped.is_set():
            self.stopped.wait(self.step())
        self.state = 'stopped'

    def stop(self):
        self.stopped.set()
        if self.thread is not None:
            self.thread.join(timeout=60)
            if self.thread.is_alive():
                raise RuntimeError('sync_worker_stop_timeout')
            self.thread = None
        self.state = 'stopped'
