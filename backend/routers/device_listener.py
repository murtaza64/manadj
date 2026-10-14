"""Settings → Library → Phone sync (#373): control the LAN device listener.

Served by the loopback app only; the LAN listener itself exposes nothing
but /api/device-sync/* (backend/device_listener.py).
"""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import device_listener

router = APIRouter()


class ListenerUpdate(BaseModel):
    enabled: bool | None = None
    port: int | None = Field(default=None, ge=1024, le=65535)


@router.get("")
def get_status():
    return asdict(device_listener.status())


@router.put("")
def update(changes: ListenerUpdate):
    from ..settings_file import update_settings_file

    edits = {}
    if changes.enabled is not None:
        edits["device_sync_enabled"] = changes.enabled
    if changes.port is not None:
        edits["device_sync_port"] = changes.port
    if edits:
        update_settings_file(edits)
    device_listener.apply_settings()
    return asdict(device_listener.status())


@router.post("/rotate")
def rotate():
    """New pairing code; every paired phone must re-enter it."""
    enabled, _ = device_listener.read_settings()
    if not enabled:
        raise HTTPException(status_code=409, detail="Phone sync is off")
    device_listener.rotate_pair_code()
    return asdict(device_listener.status())
