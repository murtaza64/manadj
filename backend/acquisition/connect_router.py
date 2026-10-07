"""SoundCloud guide API (setup-guides #290): /api/soundcloud.

GET    /status  connected?, token source, account (username + likes count)
PUT    /token   validate a pasted oauth_token, store it, enable the Source
DELETE /token   remove the token from the data root's .env
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Literal

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import get_config, reload_config
from .connect import (
    SoundCloudAccount,
    TokenRejected,
    get_token_store,
    normalize_token,
    validate_token,
)

router = APIRouter()

# Set by main.py: registers the download handler on the live worker.
on_connected: Callable[[], None] | None = None

# /me results per token, so status polls don't spend SoundCloud's budget.
VALIDATION_TTL_SECS = 600.0
_cache: dict[str, tuple[float, SoundCloudAccount | str]] = {}
_cache_lock = threading.Lock()

Validate = Callable[[str], SoundCloudAccount]
validate: Validate = validate_token  # swapped in tests


class TokenIn(BaseModel):
    token: str = Field(min_length=1, max_length=512)


class AccountOut(BaseModel):
    username: str
    likes_count: int


class SoundCloudStatus(BaseModel):
    connected: bool
    # secrets = the data root's .env (guide-managed); env = process
    # environment; config = settings file; None when no token anywhere
    token_source: Literal["secrets", "env", "config"] | None
    account: AccountOut | None
    # why a present token isn't connected (rejected / unreachable)
    error: str | None


def _check(token: str, fresh: bool = False) -> SoundCloudAccount | str:
    """Account, or an error message. Rejections are cached; network errors not."""
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(token)
    if hit and not fresh and now - hit[0] < VALIDATION_TTL_SECS:
        return hit[1]
    try:
        result: SoundCloudAccount | str = validate(token)
    except TokenRejected as e:
        result = f"{e}. The token may have expired — copy a fresh one."
    except requests.RequestException as e:
        return f"Couldn't reach SoundCloud: {e.__class__.__name__}"
    with _cache_lock:
        _cache[token] = (now, result)
    return result


def _status(fresh: bool = False) -> SoundCloudStatus:
    cfg = get_config().soundcloud
    if not cfg.oauth_token:
        return SoundCloudStatus(connected=False, token_source=None, account=None, error=None)
    result = _check(cfg.oauth_token, fresh)
    source = cfg.token_source
    if isinstance(result, str):
        return SoundCloudStatus(connected=False, token_source=source, account=None, error=result)
    return SoundCloudStatus(
        connected=True,
        token_source=source,
        account=AccountOut(username=result.username, likes_count=result.likes_count),
        error=None,
    )


@router.get("/status", response_model=SoundCloudStatus)
def get_status(fresh: bool = False) -> SoundCloudStatus:
    return _status(fresh)


@router.put("/token", response_model=SoundCloudStatus)
def put_token(body: TokenIn) -> SoundCloudStatus:
    if get_config().soundcloud.token_source == "env":
        raise HTTPException(
            409, "SOUNDCLOUD_OAUTH_TOKEN is set in manaDJ's environment; it takes precedence"
        )
    token = normalize_token(body.token)
    result = _check(token, fresh=True)
    if isinstance(result, str):
        raise HTTPException(400, result)
    get_token_store().save(token)
    reload_config()
    if on_connected is not None:
        on_connected()
    return _status()


@router.delete("/token", response_model=SoundCloudStatus)
def delete_token() -> SoundCloudStatus:
    get_token_store().clear()
    reload_config()
    return _status()
