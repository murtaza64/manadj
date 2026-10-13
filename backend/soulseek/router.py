"""Soulseek guide API (setup-guides #291): /api/soulseek.

GET  /status       mode, binary, process + Soulseek login health, licence
PUT  /credentials  store username/password, (re)generate config, restart
DELETE /credentials  stop the managed slskd and forget credentials
POST /restart      bounce the managed slskd
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import get_config, reload_config
from .managed import (
    SLSKD_LICENSE,
    SLSKD_SOURCE_URL,
    SLSKD_VERSION,
    get_store,
    new_managed,
    resolve_binary,
    slskd_app_dir,
)
from .supervisor import get_supervisor

router = APIRouter()

# Set by main.py: registers Soulseek task handlers on the live worker once
# the managed Supplier becomes configured mid-session.
on_configured: Callable[[], None] | None = None


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class ServerStateOut(BaseModel):
    connected: bool
    logged_in: bool
    connecting: bool
    state: str


class LicenceOut(BaseModel):
    name: str = "slskd"
    version: str = SLSKD_VERSION
    license: str = SLSKD_LICENSE
    source_url: str = SLSKD_SOURCE_URL


class SoulseekStatus(BaseModel):
    # external: user-run slskd ([soulseek] slskd_url + SLSKD_API_KEY)
    # managed: manadj's own slskd; unconfigured: neither
    mode: Literal["external", "managed", "unconfigured"]
    binary_available: bool
    username: str | None
    process: Literal["stopped", "starting", "running", "crashed"] | None
    server: ServerStateOut | None
    # slskd's last warning/error, only while not logged in
    issue: str | None
    web_url: str | None
    licence: LicenceOut = LicenceOut()


def _status() -> SoulseekStatus:
    cfg = get_config().soulseek
    binary = resolve_binary() is not None
    if cfg.configured and not cfg.managed:
        return SoulseekStatus(
            mode="external", binary_available=binary, username=None, process=None,
            server=None, issue=None, web_url=cfg.slskd_url,
        )
    managed = get_store().load()
    if managed is None or not cfg.managed:
        return SoulseekStatus(
            mode="unconfigured", binary_available=binary, username=managed.username if managed else None,
            process=None, server=None, issue=None, web_url=None,
        )
    st = get_supervisor().status()
    server = ServerStateOut(**vars(st.server)) if st.server else None
    return SoulseekStatus(
        mode="managed",
        binary_available=binary,
        username=managed.username,
        process=st.process,
        server=server,
        issue=None if server and server.logged_in else st.last_issue,
        web_url=st.web_url,
    )


@router.get("/status", response_model=SoulseekStatus)
def get_status() -> SoulseekStatus:
    return _status()


@router.put("/credentials", response_model=SoulseekStatus)
def put_credentials(body: Credentials) -> SoulseekStatus:
    cfg = get_config().soulseek
    if cfg.configured and not cfg.managed:
        raise HTTPException(409, "Using an external slskd ([soulseek] slskd_url + SLSKD_API_KEY); nothing to set up")
    if resolve_binary() is None:
        raise HTTPException(503, "slskd is not bundled with this build")
    store = get_store()
    store.save(new_managed(body.username.strip(), body.password, store.load()))
    reload_config()
    get_supervisor().restart()
    if on_configured is not None:
        on_configured()
    return _status()


@router.delete("/credentials", response_model=SoulseekStatus)
def delete_credentials() -> SoulseekStatus:
    if get_config().soulseek.managed:
        get_supervisor().stop()
    get_store().clear()
    # the generated config carries the password too
    (slskd_app_dir() / "slskd.yml").unlink(missing_ok=True)
    reload_config()
    return _status()


@router.post("/restart", response_model=SoulseekStatus)
def restart() -> SoulseekStatus:
    if not get_config().soulseek.managed:
        raise HTTPException(409, "No managed slskd configured")
    get_supervisor().restart()
    return _status()
