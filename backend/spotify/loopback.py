"""Fixed-port loopback redirect listener for the Spotify sign-in (#347).

Spotify's dashboard needs the redirect URI registered up front, and the
backend's own port varies (lane apps, packaged random ports), so sign-in
redirects to a dedicated listener on a fixed loopback port instead:
http://127.0.0.1:<REDIRECT_PORT>/callback. It runs only while a sign-in is
pending and stops after the callback (or the pending window) ends.
"""

from __future__ import annotations

import html
import logging
import os
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)

DEFAULT_REDIRECT_PORT = 43827
CALLBACK_PATH = "/callback"


def redirect_port() -> int:
    raw = os.environ.get("MANADJ_SPOTIFY_REDIRECT_PORT")
    return int(raw) if raw and raw.isdigit() else DEFAULT_REDIRECT_PORT


def redirect_uri(port: int | None = None) -> str:
    return f"http://127.0.0.1:{redirect_port() if port is None else port}{CALLBACK_PATH}"


# (params) -> (ok, title, message); params = single-valued query params
CallbackHandler = Callable[[dict[str, str]], tuple[bool, str, str]]


def result_page(ok: bool, title: str, message: str) -> str:
    color = "#00e05a" if ok else "#ff2a2a"
    close = "<script>setTimeout(() => window.close(), 1500)</script>" if ok else ""
    return f"""<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title>
<body style="background:#000;color:#fff;font:16px system-ui;display:grid;place-items:center;height:90vh">
<div style="max-width:32em;text-align:center"><h1 style="color:{color}">{html.escape(title)}</h1>
<p>{html.escape(message)}</p></div>{close}</body>"""


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    # Windows SO_REUSEADDR would let us bind a port someone else listens on
    allow_reuse_address = os.name != "nt"

    def server_bind(self) -> None:
        # skip HTTPServer's reverse-DNS getfqdn() (stalls on some macOS hosts)
        import socket
        import socketserver

        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)  # type: ignore[attr-defined]
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "127.0.0.1", self.server_address[1]


class LoopbackListener:
    """One-shot-ish HTTP listener: serves /callback until stopped."""

    def __init__(self, port: int, on_callback: CallbackHandler) -> None:
        self._requested_port = port
        self._on_callback = on_callback
        self._server: _Server | None = None
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return self._server is not None

    @property
    def port(self) -> int:
        return self._server.server_address[1] if self._server else self._requested_port

    def start(self) -> None:
        """Bind and serve (idempotent). Raises OSError when the port is taken."""
        with self._lock:
            if self._server is not None:
                return
            listener = self

            class Handler(BaseHTTPRequestHandler):
                def do_GET(self) -> None:  # noqa: N802
                    url = urlparse(self.path)
                    if url.path != CALLBACK_PATH:
                        self.send_error(404)
                        return
                    params = {k: v[0] for k, v in parse_qs(url.query).items()}
                    ok, title, message = listener._on_callback(params)
                    body = result_page(ok, title, message).encode("utf-8")
                    self.send_response(200 if ok else 400)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    if ok:
                        threading.Thread(target=listener.stop, daemon=True).start()

                def log_message(self, format: str, *args: object) -> None:
                    logger.info("spotify loopback: " + format, *args)

            self._server = _Server(("127.0.0.1", self._requested_port), Handler)
            threading.Thread(
                target=self._server.serve_forever, name="spotify-loopback", daemon=True
            ).start()
            logger.info("spotify loopback listener on 127.0.0.1:%d", self.port)

    def stop(self) -> None:
        with self._lock:
            server, self._server = self._server, None
        if server is not None:
            server.shutdown()
            server.server_close()
