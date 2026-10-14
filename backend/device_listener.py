"""Opt-in LAN listener for device sync (#373).

The main backend binds loopback only. When Phone sync is enabled, a second
uvicorn server listens on all interfaces and serves ONLY the device-sync
router (/api/device-sync/*), and every request must carry the pairing code
(`X-Manadj-Pair` header). Settings → Library → Phone sync turns it on and
shows the code; rotating the code unpairs every phone.

State: `[device_sync] enabled/port` in the settings file (config.toml);
the pairing code is a secret in the data root's .env
(MANADJ_DEVICE_PAIR_CODE).
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
import socket
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .routers import device_sync

log = logging.getLogger(__name__)

PAIR_HEADER = "X-Manadj-Pair"
PAIR_SECRET = "MANADJ_DEVICE_PAIR_CODE"
DEFAULT_PORT = 48127
# Failed pairing attempts per client before 429, within the window.
MAX_FAILURES = 10
FAILURE_WINDOW_S = 60.0
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def new_pair_code() -> str:
    """10 unambiguous characters (~50 bits), shown as XXXXX-XXXXX."""
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def normalize_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


class _Failures:
    def __init__(self) -> None:
        self._by_client: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def blocked(self, client: str, now: float) -> bool:
        with self._lock:
            q = self._by_client[client]
            while q and now - q[0] > FAILURE_WINDOW_S:
                q.popleft()
            return len(q) >= MAX_FAILURES

    def record(self, client: str, now: float) -> None:
        with self._lock:
            self._by_client[client].append(now)


def build_app(get_code) -> FastAPI:
    """The LAN-facing app: device-sync only, pairing required everywhere."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    failures = _Failures()

    @app.middleware("http")
    async def require_pairing(request: Request, call_next):
        client = request.client.host if request.client else "?"
        now = time.monotonic()
        if failures.blocked(client, now):
            return JSONResponse({"detail": "Too many pairing attempts; wait a minute"}, status_code=429)
        expected = get_code()
        supplied = request.headers.get(PAIR_HEADER, "")
        if not expected or not hmac.compare_digest(normalize_code(supplied), normalize_code(expected)):
            failures.record(client, now)
            return JSONResponse({"detail": "Pairing code missing or wrong"}, status_code=401)
        return await call_next(request)

    app.include_router(device_sync.router, prefix="/api/device-sync")
    return app


def lan_addresses() -> list[str]:
    """Non-loopback IPv4 addresses a phone on the LAN could reach."""
    out: list[str] = []
    try:
        import psutil

        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if a.family == socket.AF_INET and not a.address.startswith(("127.", "169.254.")):
                    out.append(a.address)
    except Exception:  # pragma: no cover - psutil missing/odd platforms
        pass
    if not out:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("192.0.2.1", 9))  # no packets sent for UDP connect
                out.append(s.getsockname()[0])
        except OSError:
            pass
    return sorted(set(out))


@dataclass
class ListenerStatus:
    enabled: bool
    running: bool
    port: int
    pair_code: str | None
    addresses: list[str]
    error: str | None


class DeviceListener:
    """One background uvicorn server; start/stop are idempotent."""

    def __init__(self, host: str = "0.0.0.0") -> None:
        self.host = host
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None
        self._port: int | None = None
        self.error: str | None = None
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive() and self._server is not None and self._server.started

    def start(self, port: int, get_code) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                if self._port == port:
                    return
                self._stop_locked()
            self.error = None
            config = uvicorn.Config(build_app(get_code), host=self.host, port=port, log_level="warning", access_log=False)
            server = uvicorn.Server(config)
            server.install_signal_handlers = lambda: None  # type: ignore[method-assign]  # not the main thread
            thread = threading.Thread(target=self._run, args=(server,), name="device-listener", daemon=True)
            self._server, self._thread, self._port = server, thread, port
            thread.start()
            deadline = time.monotonic() + 5
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(0.02)
            if not server.started:
                self.error = self.error or f"Could not listen on port {port}"
                log.error("device listener: %s", self.error)

    def _run(self, server: uvicorn.Server) -> None:
        try:
            server.run()
        except SystemExit:
            # uvicorn exits the process-equivalent on bind failure.
            self.error = f"Port {self._port} is in use"
        except Exception as exc:  # pragma: no cover
            self.error = str(exc)

    def stop(self) -> None:
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._server = self._thread = self._port = None


# ── Settings-backed singleton ──────────────────────────────────────────

_listener = DeviceListener()


def read_settings() -> tuple[bool, int]:
    from .settings_file import _document

    table = _document().get("device_sync", {})
    enabled = bool(table.get("enabled", False))
    try:
        port = int(table.get("port", DEFAULT_PORT))
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    return enabled, port


def pair_code() -> str | None:
    from .settings_file import read_secrets

    return os.environ.get(PAIR_SECRET) or read_secrets().get(PAIR_SECRET) or None


def ensure_pair_code() -> str:
    code = pair_code()
    if code:
        return code
    from .settings_file import update_secrets

    code = new_pair_code()
    update_secrets({PAIR_SECRET: code})
    return code


def rotate_pair_code() -> str:
    from .settings_file import update_secrets

    code = new_pair_code()
    update_secrets({PAIR_SECRET: code})
    return code


def apply_settings() -> None:
    """Start or stop the listener to match the settings file (startup + edits)."""
    enabled, port = read_settings()
    if enabled:
        ensure_pair_code()
        _listener.start(port, pair_code)
    else:
        _listener.stop()


def stop() -> None:
    _listener.stop()


def status() -> ListenerStatus:
    enabled, port = read_settings()
    return ListenerStatus(
        enabled=enabled,
        running=_listener.running,
        port=port,
        pair_code=pair_code() if enabled else None,
        addresses=lan_addresses() if enabled else [],
        error=_listener.error if enabled else None,
    )
