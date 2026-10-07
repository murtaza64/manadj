"""Spotify connection (#347): Authorization Code with PKCE, no client secret.

The user creates their own Spotify app (Development Mode) and gives manaDJ
its Client ID. Connect sends the browser to Spotify's authorize page with a
loopback redirect to this backend (`/api/spotify/callback` on 127.0.0.1 —
Spotify accepts any port for loopback IP literals, RFC 8252 §7.3); the
callback exchanges the code for tokens.

Persisted in the data root's .env (settings_file.update_secrets):
SPOTIFY_CLIENT_ID (not a secret, but per-user setup) and
SPOTIFY_REFRESH_TOKEN. The access token lives in memory and is refreshed
server-side. A refresh Spotify refuses (invalid_grant: revoked, expired —
refresh tokens last 6 months) flips the connection to `reconnect` until the
user connects again.

Network I/O goes through a `SpotifyTransport` so tests fake Spotify at the
HTTP-shape level (ADR-0002); `HttpTransport` is the thin real adapter.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import urlencode

import requests

logger = logging.getLogger(__name__)

CLIENT_ID_KEY = "SPOTIFY_CLIENT_ID"
REFRESH_TOKEN_KEY = "SPOTIFY_REFRESH_TOKEN"

AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"
SCOPES = ("user-library-read", "playlist-read-private", "playlist-read-collaborative")
CALLBACK_PATH = "/api/spotify/callback"
# What the user registers in the Spotify dashboard: loopback IP literal, no
# port (Spotify matches any port for loopback redirects).
REGISTERED_REDIRECT_URI = f"http://127.0.0.1{CALLBACK_PATH}"

REQUEST_TIMEOUT_SECS = 15.0
PENDING_TTL_SECS = 15 * 60
# refresh this long before Spotify's expiry
EXPIRY_MARGIN_SECS = 60.0

State = Literal["no_client", "disconnected", "connected", "reconnect"]


class SpotifyTransport(Protocol):
    def post_token(self, form: dict[str, str]) -> tuple[int, dict[str, Any]]: ...
    def get(self, url: str, params: dict[str, Any] | None, access_token: str) -> tuple[int, dict[str, Any], dict[str, str]]: ...


class HttpTransport:
    def post_token(self, form: dict[str, str]) -> tuple[int, dict[str, Any]]:
        resp = requests.post(TOKEN_URL, data=form, timeout=REQUEST_TIMEOUT_SECS)
        return resp.status_code, _json(resp)

    def get(
        self, url: str, params: dict[str, Any] | None, access_token: str
    ) -> tuple[int, dict[str, Any], dict[str, str]]:
        resp = requests.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=REQUEST_TIMEOUT_SECS,
        )
        return resp.status_code, _json(resp), dict(resp.headers)


def _json(resp: requests.Response) -> dict[str, Any]:
    try:
        body = resp.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


class SpotifyError(Exception):
    """A Spotify call failed; `status` is the HTTP code to surface."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


class NotConnected(SpotifyError):
    def __init__(self, message: str = "Spotify isn't connected — connect it in Settings → Spotify.") -> None:
        super().__init__(message, 409)


class NeedsReconnect(SpotifyError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 409)


class RateLimited(SpotifyError):
    def __init__(self, retry_after: float | None, quota: bool) -> None:
        msg = (
            "Spotify quota exceeded for this app (Development Mode) — try again later"
            if quota
            else "Spotify rate limit — try again shortly"
        )
        super().__init__(msg, 429)
        self.retry_after = retry_after


def pkce_pair() -> tuple[str, str]:
    """(code_verifier, S256 code_challenge)."""
    verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def redirect_uri_for_port(port: int | None) -> str:
    return f"http://127.0.0.1{':' + str(port) if port else ''}{CALLBACK_PATH}"


@dataclass
class _Pending:
    verifier: str
    redirect_uri: str
    created: float


@dataclass(frozen=True)
class SpotifyAccount:
    id: str
    display_name: str


class SpotifyConnection:
    """Token lifecycle + authenticated GETs. One per process (get_connection)."""

    def __init__(
        self,
        transport: SpotifyTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.transport: SpotifyTransport = transport or HttpTransport()
        self._clock = clock
        self._lock = threading.RLock()
        self._pending: dict[str, _Pending] = {}
        self._access: tuple[str, float] | None = None  # token, expires_at
        self._reconnect: str | None = None
        self._account: SpotifyAccount | None = None

    # -- persisted settings -------------------------------------------------

    @property
    def client_id(self) -> str | None:
        return os.environ.get(CLIENT_ID_KEY) or None

    @property
    def refresh_token(self) -> str | None:
        return os.environ.get(REFRESH_TOKEN_KEY) or None

    def _forget_session(self) -> None:
        self._access = None
        self._account = None
        self._reconnect = None

    def set_client_id(self, client_id: str) -> None:
        """Store the app's Client ID. A different app invalidates the token."""
        from ..settings_file import update_secrets

        client_id = client_id.strip()
        with self._lock:
            if client_id == self.client_id:
                return
            update_secrets({CLIENT_ID_KEY: client_id, REFRESH_TOKEN_KEY: None})
            self._forget_session()
            self._pending.clear()

    def forget_client(self) -> None:
        from ..settings_file import update_secrets

        with self._lock:
            update_secrets({CLIENT_ID_KEY: None, REFRESH_TOKEN_KEY: None})
            self._forget_session()
            self._pending.clear()

    def disconnect(self) -> None:
        from ..settings_file import update_secrets

        with self._lock:
            update_secrets({REFRESH_TOKEN_KEY: None})
            self._forget_session()

    # -- state --------------------------------------------------------------

    def state(self) -> State:
        if not self.client_id:
            return "no_client"
        if not self.refresh_token:
            return "disconnected"
        if self._reconnect:
            return "reconnect"
        return "connected"

    @property
    def reconnect_reason(self) -> str | None:
        return self._reconnect

    # -- authorization ------------------------------------------------------

    def begin(self, redirect_uri: str) -> str:
        """Start a PKCE authorization; returns the URL to open in a browser."""
        client_id = self.client_id
        if not client_id:
            raise SpotifyError("Enter your Spotify app's Client ID first.", 409)
        verifier, challenge = pkce_pair()
        state = secrets.token_urlsafe(24)
        now = self._clock()
        with self._lock:
            self._pending = {
                k: p for k, p in self._pending.items() if now - p.created < PENDING_TTL_SECS
            }
            self._pending[state] = _Pending(verifier, redirect_uri, now)
        query = urlencode(
            {
                "client_id": client_id,
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "code_challenge_method": "S256",
                "code_challenge": challenge,
                "state": state,
                "scope": " ".join(SCOPES),
            }
        )
        return f"{AUTHORIZE_URL}?{query}"

    def complete(self, state: str, code: str) -> SpotifyAccount:
        """The callback: exchange the code, store the refresh token."""
        from ..settings_file import update_secrets

        with self._lock:
            pending = self._pending.pop(state, None)
        if pending is None or self._clock() - pending.created >= PENDING_TTL_SECS:
            raise SpotifyError("This sign-in link expired or was already used — press Connect again.", 400)
        client_id = self.client_id
        if not client_id:
            raise SpotifyError("No Spotify Client ID is set.", 409)
        status, body = self.transport.post_token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": pending.redirect_uri,
                "client_id": client_id,
                "code_verifier": pending.verifier,
            }
        )
        if status != 200 or "access_token" not in body or "refresh_token" not in body:
            raise SpotifyError(f"Spotify refused the sign-in: {_describe(body, status)}", 400)
        with self._lock:
            update_secrets({REFRESH_TOKEN_KEY: str(body["refresh_token"])})
            self._forget_session()
            self._store_access(body)
        return self.account(fresh=True)

    def _store_access(self, body: dict[str, Any]) -> None:
        expires_in = float(body.get("expires_in") or 3600)
        self._access = (str(body["access_token"]), self._clock() + expires_in - EXPIRY_MARGIN_SECS)

    def access_token(self, force_refresh: bool = False) -> str:
        from ..settings_file import update_secrets

        with self._lock:
            state = self.state()
            if state in ("no_client", "disconnected"):
                raise NotConnected()
            if state == "reconnect":
                raise NeedsReconnect(self._reconnect or "Reconnect Spotify.")
            if not force_refresh and self._access and self._clock() < self._access[1]:
                return self._access[0]
            assert self.client_id and self.refresh_token
            status, body = self.transport.post_token(
                {
                    "grant_type": "refresh_token",
                    "refresh_token": self.refresh_token,
                    "client_id": self.client_id,
                }
            )
            if status == 200 and "access_token" in body:
                self._store_access(body)
                # Spotify may rotate the refresh token; keep the old one otherwise.
                if body.get("refresh_token") and body["refresh_token"] != self.refresh_token:
                    update_secrets({REFRESH_TOKEN_KEY: str(body["refresh_token"])})
                return self._access[0]  # type: ignore[index]
            if status in (400, 401) and body.get("error") in ("invalid_grant", "invalid_client"):
                self._access = None
                self._reconnect = (
                    f"Spotify no longer accepts manaDJ's sign-in ({_describe(body, status)}) — reconnect."
                )
                logger.warning("spotify refresh refused: %s", self._reconnect)
                raise NeedsReconnect(self._reconnect)
            raise SpotifyError(f"Couldn't refresh the Spotify session: {_describe(body, status)}")

    # -- API ----------------------------------------------------------------

    def get(self, path_or_url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Authenticated GET against the Web API (path relative to /v1 or a full URL)."""
        url = path_or_url if path_or_url.startswith("http") else f"{API_BASE}{path_or_url}"
        for attempt in range(2):
            token = self.access_token(force_refresh=attempt > 0)
            try:
                status, body, headers = self.transport.get(url, params, token)
            except requests.RequestException as e:
                raise SpotifyError(f"Couldn't reach Spotify: {e.__class__.__name__}") from e
            if status == 401 and attempt == 0:
                continue  # access token revoked/expired early: refresh once
            if status == 200:
                return body
            if status == 429:
                raw_err = body.get("error")
                err: dict[str, Any] = raw_err if isinstance(raw_err, dict) else {}
                retry = headers.get("Retry-After") or headers.get("retry-after")
                raise RateLimited(
                    float(retry) if retry and retry.isdigit() else None,
                    quota=err.get("reason") == "QUOTA_EXCEEDED",
                )
            if status == 403:
                raise SpotifyError(
                    "Spotify refused access (403). In Development Mode your Spotify account must "
                    "be on the app's Users Management list, and playlist contents are only "
                    f"readable for playlists you own or collaborate on. ({_describe(body, status)})",
                    403,
                )
            if status == 404:
                raise SpotifyError(f"Not found on Spotify ({_describe(body, status)})", 404)
            raise SpotifyError(f"Spotify error: {_describe(body, status)}")
        raise SpotifyError("Spotify kept rejecting a fresh access token (401)")

    def account(self, fresh: bool = False) -> SpotifyAccount:
        with self._lock:
            cached = self._account
        if cached is not None and not fresh:
            return cached
        me = self.get("/me")
        account = SpotifyAccount(
            id=str(me.get("id") or ""),
            display_name=str(me.get("display_name") or me.get("id") or ""),
        )
        with self._lock:
            self._account = account
        return account


def _describe(body: dict[str, Any], status: int) -> str:
    err = body.get("error")
    if isinstance(err, dict):
        return f"HTTP {status}: {err.get('message') or err}"
    if err:
        desc = body.get("error_description")
        return f"HTTP {status}: {err}{f' — {desc}' if desc else ''}"
    return f"HTTP {status}"


_connection: SpotifyConnection | None = None
_connection_lock = threading.Lock()


def get_connection() -> SpotifyConnection:
    global _connection
    with _connection_lock:
        if _connection is None:
            _connection = SpotifyConnection()
        return _connection


def set_connection(conn: SpotifyConnection | None) -> None:
    """Swap the process connection (tests)."""
    global _connection
    with _connection_lock:
        _connection = conn
