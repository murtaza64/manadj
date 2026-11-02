"""Explicit local-only read/compare operations; never installed on Device sync listener."""
import ipaddress
import json
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request

from ..database import get_db
from .contracts import MAX_WIRE, CompareRequest, ExportRequest
from .service import TooLarge, compare_inventory, export_inventory


def local_control(request: Request):
    host = request.client.host if request.client else ""
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host == "testclient"
    origin = request.headers.get("origin")
    if origin:
        try:
            parsed = urlsplit(origin)
            local = local and parsed.scheme in {"http", "https"} and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        except ValueError:
            local = False
    if not local or request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "local_inventory_control_only")


router = APIRouter(dependencies=[Depends(local_control)])


async def parse(request, model):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_WIRE:
            raise HTTPException(413, "inventory_request_too_large")
        raw.extend(chunk)

    def unique(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("Duplicate JSON key")
            value[key] = item
        return value

    json.loads(raw, object_pairs_hook=unique)
    return model.model_validate_json(bytes(raw))


async def handle(request, db, model, operation):
    try:
        value = await parse(request, model)
        return operation(db, value)
    except TooLarge as error:
        raise HTTPException(413, str(error)) from None
    except (ValueError, TypeError, RecursionError):
        raise HTTPException(422, "invalid_peer_inventory") from None


@router.post("/export")
async def export(request: Request, db=Depends(get_db)):
    return await handle(request, db, ExportRequest, export_inventory)


@router.post("/compare")
async def compare(request: Request, db=Depends(get_db)):
    return await handle(request, db, CompareRequest, compare_inventory)
