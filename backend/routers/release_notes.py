"""Release routes testable without importing backend.main or the DB."""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from backend.data_root import REPO_ROOT, data_root
from backend.release_notes import ReleaseNotes, load_release


class SeenRequest(BaseModel):
    release_id: str = Field(pattern=r"^[0-9a-f]{64}$")


def make_router(service: ReleaseNotes) -> APIRouter:
    router = APIRouter(prefix="/api/release", tags=["release"])

    @router.get("")
    def current(release_id: str, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return {"release": service.current(release_id)}

    @router.post("/seen")
    def seen(request: SeenRequest):
        try:
            service.acknowledge(request.release_id)
        except ValueError:
            raise HTTPException(409, "Release is not loaded; reopen this app.") from None
        except OSError:
            raise HTTPException(503, "Could not save acknowledgement; try again.") from None
        return {"seen": True}

    return router


# Snapshot once; never replace identity under an already loaded app.
router = make_router(ReleaseNotes(load_release(Path(os.environ.get("MANADJ_RELEASE_DIR", REPO_ROOT))), data_root()))
