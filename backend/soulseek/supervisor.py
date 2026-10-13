"""Supervise the managed slskd process (setup-guides #291).

Lifecycle: started with the backend when the Soulseek guide has stored
credentials and the binary is shipped; stopped on backend shutdown;
restarted when credentials change. A crash restarts with backoff, giving up
after MAX_CRASH_RESTARTS consecutive failures (status says `crashed`). A
pidfile in the app dir lets the next start reap an orphan left by a hard
backend kill.

Health is read on demand from slskd's own API (`/api/v0/server`); the last
warning/error line of slskd's log is surfaced so a wrong password reads as
something better than "not logged in".
"""

from __future__ import annotations

import logging
import os
import re
import signal
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import requests

from .managed import (
    PREFERRED_WEB_PORT,
    ManagedSoulseek,
    ManagedSoulseekStore,
    _port_free,
    pick_port,
    write_slskd_config,
)

logger = logging.getLogger(__name__)

STOP_TIMEOUT_SECS = 10.0
MAX_CRASH_RESTARTS = 5
HEALTH_TIMEOUT_SECS = 1.5
LOG_NAME = "slskd.log"
PID_NAME = "slskd.pid"

ProcessState = Literal["stopped", "starting", "running", "crashed"]

_LOG_ISSUE = re.compile(r"^\[[\d:]+ (WRN|ERR|FTL)\] (.*)$")


@dataclass
class ServerState:
    connected: bool
    logged_in: bool
    # mid connect/login handshake: an issue logged now may be transient
    connecting: bool
    state: str


@dataclass
class SupervisorStatus:
    process: ProcessState
    pid: int | None
    exit_code: int | None
    web_url: str | None
    server: ServerState | None
    last_issue: str | None
    restarts: int = 0


class SlskdSupervisor:
    def __init__(
        self,
        binary: Path | None,
        app_dir: Path,
        store: ManagedSoulseekStore,
        popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
    ) -> None:
        self.binary = binary
        self.app_dir = app_dir
        self.store = store
        self._popen = popen
        self._lock = threading.RLock()
        self._proc: subprocess.Popen[bytes] | None = None
        self._managed: ManagedSoulseek | None = None
        self._stopping = False
        self._crashed = False
        self._restarts = 0
        self._last_exit: int | None = None
        self._monitor: threading.Thread | None = None

    # lifecycle ----------------------------------------------------------
    def start(self) -> bool:
        """Start slskd if credentials are stored and the binary is shipped.

        Returns whether a process is (now) running. Idempotent.
        """
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return True
            managed = self.store.load()
            if managed is None or self.binary is None:
                return False
            self._stopping = False
            self._crashed = False
            self._reap_orphan()
            managed = self._ensure_port(managed)
            self._spawn(managed)
            return True

    def stop(self) -> None:
        with self._lock:
            self._stopping = True
            proc = self._proc
            self._proc = None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(STOP_TIMEOUT_SECS)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            logger.info("slskd stopped (pid %s)", proc.pid)
        (self.app_dir / PID_NAME).unlink(missing_ok=True)

    def restart(self) -> bool:
        self.stop()
        with self._lock:
            self._restarts = 0
        return self.start()

    # status -------------------------------------------------------------
    def status(self) -> SupervisorStatus:
        with self._lock:
            proc, managed = self._proc, self._managed
            crashed, restarts, last_exit = self._crashed, self._restarts, self._last_exit
        running = proc is not None and proc.poll() is None
        server = self._server_state(managed) if running and managed else None
        if running:
            process: ProcessState = "running" if server is not None else "starting"
        else:
            process = "crashed" if crashed else "stopped"
        return SupervisorStatus(
            process=process,
            pid=proc.pid if running and proc else None,
            exit_code=None if running else last_exit,
            web_url=managed.url if running and managed else None,
            server=server,
            last_issue=self._last_log_issue() if (running or crashed) else None,
            restarts=restarts,
        )

    # internals ----------------------------------------------------------
    def _spawn(self, managed: ManagedSoulseek) -> None:
        assert self.binary is not None
        config = write_slskd_config(managed, self.app_dir)
        log = open(self.app_dir / LOG_NAME, "wb")
        env = dict(os.environ, SLSKD_APP_DIR=str(self.app_dir))
        proc = self._popen(
            [str(self.binary), "--app-dir", str(self.app_dir), "--config", str(config)],
            env=env,
            cwd=str(self.binary.parent),
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
        )
        log.close()
        self._proc = proc
        self._managed = managed
        (self.app_dir / PID_NAME).write_text(f"{proc.pid}\n")
        logger.info("slskd started (pid %s, %s)", proc.pid, managed.url)
        self._monitor = threading.Thread(target=self._watch, args=(proc,), daemon=True, name="slskd-monitor")
        self._monitor.start()

    def _watch(self, proc: subprocess.Popen[bytes]) -> None:
        code = proc.wait()
        with self._lock:
            if self._stopping or self._proc is not proc:
                return
            self._last_exit = code
            self._proc = None
            self._restarts += 1
            if self._restarts > MAX_CRASH_RESTARTS:
                self._crashed = True
                logger.error("slskd exited (code %s); giving up after %d restarts", code, MAX_CRASH_RESTARTS)
                return
            delay = min(2 ** self._restarts, 60)
            logger.warning("slskd exited (code %s); restarting in %ss", code, delay)
        time.sleep(delay)
        with self._lock:
            if self._stopping or self._proc is not None:
                return
            managed = self.store.load()
            if managed is None:
                return
            self._spawn(self._ensure_port(managed))

    def _ensure_port(self, managed: ManagedSoulseek) -> ManagedSoulseek:
        """Move the web port if something else holds it (persisted)."""
        if _port_free(managed.web_port):
            return managed
        managed.web_port = pick_port(PREFERRED_WEB_PORT, avoid={managed.web_port, managed.listen_port})
        self.store.save(managed)
        logger.warning("slskd web port taken; moved to %s", managed.web_port)
        return managed

    def _reap_orphan(self) -> None:
        pidfile = self.app_dir / PID_NAME
        try:
            pid = int(pidfile.read_text().strip())
        except (FileNotFoundError, ValueError):
            return
        try:
            comm = subprocess.run(
                ["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True, check=False
            ).stdout.strip()
        except OSError:
            comm = ""
        if comm.endswith("slskd"):
            logger.warning("reaping orphaned slskd (pid %s)", pid)
            try:
                os.kill(pid, signal.SIGTERM)
                for _ in range(int(STOP_TIMEOUT_SECS * 10)):
                    time.sleep(0.1)
                    os.kill(pid, 0)
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        pidfile.unlink(missing_ok=True)

    def _server_state(self, managed: ManagedSoulseek) -> ServerState | None:
        try:
            resp = requests.get(
                managed.url + "/api/v0/server",
                headers={"X-API-Key": managed.api_key},
                timeout=HEALTH_TIMEOUT_SECS,
            )
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError):
            return None
        return ServerState(
            connected=bool(data.get("isConnected")),
            logged_in=bool(data.get("isLoggedIn")),
            connecting=any(bool(data.get(k)) for k in ("isConnecting", "isLoggingIn", "isTransitioning")),
            state=str(data.get("state", "")),
        )

    def _last_log_issue(self) -> str | None:
        try:
            with open(self.app_dir / LOG_NAME, "rb") as f:
                f.seek(0, os.SEEK_END)
                f.seek(max(0, f.tell() - 16_384))
                lines = f.read().decode("utf-8", "replace").splitlines()
        except FileNotFoundError:
            return None
        for line in reversed(lines):
            match = _LOG_ISSUE.match(line.strip())
            if match and "SIGTERM" not in match.group(2):
                return match.group(2).strip()
        return None


_supervisor: SlskdSupervisor | None = None


def get_supervisor() -> SlskdSupervisor:
    global _supervisor
    if _supervisor is None:
        from .managed import get_store, resolve_binary, slskd_app_dir

        _supervisor = SlskdSupervisor(resolve_binary(), slskd_app_dir(), get_store())
    return _supervisor
