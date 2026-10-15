"""Settings → Library → Phone sync (#373): control the LAN device listener.

Served by the loopback app only; the LAN listener itself exposes nothing
but /api/device-sync/* (backend/device_listener.py).
"""

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
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
    if changes.enabled is not None or changes.port is not None:
        device_listener.write_settings(enabled=changes.enabled, port=changes.port)
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


# ── Device change log (ADR 0045, #375) ──


@router.get("/changes")
def changes(limit: int = 300, device: str | None = None, db: Session = Depends(get_db)):
    from ..device_edits import list_changes

    return list_changes(db, min(limit, 2000), device)


@router.post("/changes/{change_id}/revert")
def revert_change(change_id: int, db: Session = Depends(get_db)):
    from ..device_edits import change_row, revert

    made = revert(db, [change_id])
    if not made:
        raise HTTPException(status_code=409, detail="Not revertable (already reverted, or not applied)")
    return [change_row(r) for r in made]


@router.post("/batches/{batch_id}/revert")
def revert_batch_route(batch_id: str, db: Session = Depends(get_db)):
    from ..device_edits import change_row, revert_batch

    return [change_row(r) for r in revert_batch(db, batch_id)]


# ── Zero-typing pairing (#374): the desktop side of approve-on-desktop ──


@router.get("/pair-requests")
def pair_requests():
    """Pending phone pairing requests (the app-wide approve prompt polls this)."""
    return [r.public() for r in device_listener.pairing.pending()]


@router.post("/pair-requests/{request_id}/{decision}")
def decide(request_id: str, decision: str):
    if decision not in ("approve", "deny"):
        raise HTTPException(status_code=404, detail="Unknown decision")
    req = device_listener.pairing.decide(request_id, decision == "approve")
    if req is None:
        raise HTTPException(status_code=404, detail="No such pending request")
    return req.public()


@router.get("/devices")
def devices():
    return [d.public() for d in device_listener.registry.list()]


@router.delete("/devices/{device_id}")
def revoke(device_id: str):
    if not device_listener.registry.revoke(device_id):
        raise HTTPException(status_code=404, detail="No such device")
    return {"revoked": device_id}
