"""Serve the built frontend from the backend (packaged-app #279, ADR 0043).

In the packaged app the backend is the only server: FastAPI serves
frontend/dist on the same origin as the API, so the frontend needs no baked
VITE_API_URL. Dev is unchanged — Vite serves the frontend and this module
stays dormant (no dist, nothing mounted).
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def frontend_dist() -> Path | None:
    """The built frontend to serve, or None when there isn't one.

    MANADJ_FRONTEND_DIST overrides the location (the packaged bundle sets
    it); the default is the repo's frontend/dist. Only a dist with an
    index.html counts — a missing or half-built dist serves nothing rather
    than a broken shell.
    """
    override = os.getenv("MANADJ_FRONTEND_DIST")
    dist = Path(override) if override else Path(__file__).parent.parent / "frontend" / "dist"
    dist = dist.resolve()
    return dist if (dist / "index.html").is_file() else None


def mount_spa(app: FastAPI, dist: Path) -> None:
    """Serve `dist` with SPA fallback.

    Call AFTER every API router is included: the catch-all route must lose
    to every /api path. Real files under dist are served as-is; anything
    else (SPA client routes like /midi-inspect, /visualizer) falls back to
    index.html so a hard reload or deep link works.
    """
    assets = dist / "assets"
    if assets.is_dir():
        # Hashed build artifacts: StaticFiles gives real 404s for missing
        # chunks instead of an index.html fallback masquerading as JS.
        app.mount("/assets", StaticFiles(directory=assets), name="spa-assets")

    index = dist / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        candidate = (dist / path).resolve()
        if path and candidate.is_relative_to(dist) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)
