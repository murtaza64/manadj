"""Managed-shell-only cloud preparation boundary. No network or browser access."""
from __future__ import annotations
import hmac
from ipaddress import ip_address
from pathlib import Path
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from .cloud_snapshot import PreparationError, prepare_snapshot

PATH = "/api/_shell/cloud/prepare"

def install_cloud_snapshot_route(app, token: str, database_path: Path | None):
    if not token:
        return
    async def prepare(request: Request):
        try:
            peer = ip_address(request.client.host) if request.client else None
        except ValueError:
            peer = None
        if (peer is None or not peer.is_loopback or request.headers.get("origin") is not None
            or any(h in request.headers for h in ("forwarded", "x-forwarded-for", "x-real-ip"))
            or not hmac.compare_digest(request.headers.get("x-manadj-shell-token", ""), token)):
            raise HTTPException(403, "Managed shell authorization required")
        # No renderer-provided paths, tables, settings, payload or arbitrary options.
        if request.headers.get("content-length") not in (None, "0") or request.headers.get("transfer-encoding"):
            raise HTTPException(400, "Preparation takes no body")
        async for chunk in request.stream():
            if chunk:
                raise HTTPException(400, "Preparation takes no body")
        if database_path is None:
            raise HTTPException(409, "Personal SQLite source required")
        try:
            value = await run_in_threadpool(prepare_snapshot, database_path)
        except PreparationError as error:
            # Codes only, no raw labels, paths, SQLite errors or data values.
            return JSONResponse({"error": str(error)}, status_code=409,
                headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        return JSONResponse(value, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
    app.add_api_route(PATH, prepare, methods=["POST"], include_in_schema=False)
