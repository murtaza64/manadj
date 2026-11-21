"""Remote mirror preview: a read-only plan of what a cloud copy would send.

First rung of the remote-library build plan (docs/research/remote-mirror-prototype.md).
There is no remote, no uploader and no endpoint that accepts uploads - this
router only ANSWERS the question "what would mirroring my library involve?"
against the live desktop library.

GET /preview walks the library's Track rows, rewrites each desktop path to a
root-relative remote key under the configured tracks root, hashes each audio
file (sha256) and returns the plan: what would upload, total bytes, and the
tracks that are missing files, sit outside the root, or collide on a
case-insensitive remote. Hashing a large library takes a while; the UI runs
this on demand, never automatically.

Read-only by construction: it SELECTs tracks and READs audio bytes. Nothing
is uploaded, written, or mutated. Planned remote keys are root-relative; the
missing-file reasons can quote the local path, which is fine - this panel
runs on the desktop itself, and nothing here is served to a network.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, UTC
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Config, get_config
from ..database import get_db
from ..mirror.plan import build_plan
from ..models import Track

router = APIRouter(tags=["remote-mirror"])

# Long reports are useless in a settings panel; counts stay exact, examples
# are capped.
EXAMPLE_LIMIT = 25

# Single-flight: the scan hashes every audio file, so a second concurrent run
# (double-click, two tabs) would double the disk load for nothing. FastAPI
# runs this sync endpoint on its worker-thread pool, so one scan does not
# block the rest of the API; the lock only stops scans piling onto each other.
_scan_lock = threading.Lock()


class MirrorProblem(BaseModel):
    track_id: int
    reason: str


class MirrorPreview(BaseModel):
    status: str  # "ok" | "no_tracks_root"
    computed_at: str
    duration_ms: int
    roots: list[str] = []
    tracks: int = 0
    files: int = 0  # distinct files that would upload (deduped by key)
    upload_bytes: int = 0
    unchanged: int = 0  # always 0 today: no remote index exists yet
    changed: int = 0
    missing: list[MirrorProblem] = []
    missing_total: int = 0
    collisions: list[str] = []
    collision_total: int = 0


@router.get("/preview", response_model=MirrorPreview)
def preview(db: Session = Depends(get_db), config: Config = Depends(get_config)) -> MirrorPreview:
    if not _scan_lock.acquire(blocking=False):
        raise HTTPException(409, "A mirror scan is already running")
    try:
        return _scan(db, config)
    finally:
        _scan_lock.release()


def _scan(db: Session, config: Config) -> MirrorPreview:
    started = time.monotonic()
    now = datetime.now(UTC).isoformat()

    root = config.library.tracks_directory
    if not root:
        return MirrorPreview(status="no_tracks_root", computed_at=now, duration_ms=0)

    # Copy out the two columns the plan needs, then end the read transaction:
    # the session must not stay open (and hold its snapshot/locks) across the
    # whole-library hash below.
    rows = db.execute(select(Track.id, Track.filename).order_by(Track.id)).all()
    db.rollback()
    snapshot: dict[str, Any] = {"tracks": [{"id": tid, "filename": fn} for tid, fn in rows]}

    plan = build_plan(snapshot, [root])

    return MirrorPreview(
        status="ok",
        computed_at=now,
        duration_ms=int((time.monotonic() - started) * 1000),
        roots=[root],
        tracks=len(rows),
        files=len(plan.uploads) + len(plan.unchanged),
        upload_bytes=plan.upload_bytes,
        unchanged=len(plan.unchanged),
        changed=len(plan.changed),
        missing=[MirrorProblem(**m) for m in plan.missing[:EXAMPLE_LIMIT]],
        missing_total=len(plan.missing),
        collisions=plan.collisions[:EXAMPLE_LIMIT],
        collision_total=len(plan.collisions),
    )
