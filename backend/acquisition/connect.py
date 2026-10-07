"""SoundCloud connect (setup-guides #290): the guide-entered oauth token.

The guide stores the token as SOUNDCLOUD_OAUTH_TOKEN in the data root's
.env (the secrets half of the settings file, ADR 0043) — the same key a
hand-configured setup uses, so precedence is unchanged: environment/.env >
settings file `[soundcloud] oauth_token`.

Validation = an authenticated GET /me: a valid token yields the account's
username and likes count (what the guide shows back as proof).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import requests

from .source import API_BASE, REQUEST_TIMEOUT_SECS, USER_AGENT


TOKEN_KEY = "SOUNDCLOUD_OAUTH_TOKEN"


class SoundCloudTokenStore(Protocol):
    def load(self) -> str | None: ...
    def save(self, token: str) -> None: ...
    def clear(self) -> None: ...


class DotenvSoundCloudTokenStore:
    def load(self) -> str | None:
        from ..settings_file import read_secrets

        return read_secrets().get(TOKEN_KEY) or None

    def save(self, token: str) -> None:
        from ..settings_file import update_secrets

        update_secrets({TOKEN_KEY: token})

    def clear(self) -> None:
        from ..settings_file import update_secrets

        update_secrets({TOKEN_KEY: None})


def get_token_store() -> SoundCloudTokenStore:
    return DotenvSoundCloudTokenStore()


def normalize_token(raw: str) -> str:
    """Accept the cookie value as pasted: trims whitespace, quotes, and a
    leading `OAuth ` / `oauth_token=` someone copied along with it."""
    token = raw.strip().strip("'\"").strip()
    for prefix in ("oauth_token=", "OAuth ", "oauth "):
        if token.startswith(prefix):
            token = token[len(prefix):].strip()
    return token


@dataclass(frozen=True)
class SoundCloudAccount:
    username: str
    likes_count: int


class TokenRejected(Exception):
    """SoundCloud said the token is not valid (401/403)."""


def validate_token(token: str) -> SoundCloudAccount:
    """The account behind `token`. Raises TokenRejected or requests errors."""
    resp = requests.get(
        f"{API_BASE}/me",
        headers={"Authorization": f"OAuth {token}", "User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECS,
    )
    if resp.status_code in (401, 403):
        raise TokenRejected(f"SoundCloud rejected the token (HTTP {resp.status_code})")
    resp.raise_for_status()
    me = resp.json()
    return SoundCloudAccount(
        username=str(me.get("username") or me.get("permalink") or ""),
        likes_count=int(me.get("likes_count") or me.get("public_favorites_count") or 0),
    )
