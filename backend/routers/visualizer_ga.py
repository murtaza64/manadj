"""Visualizer genetic-arena persistence (realtime-visualization 06).

The arena (viz window, ?arena=1) records human judgments — votes, notes,
promotions — as APPEND-ONLY events; the orchestrating agent owns the
genepool manifest (lineage, ratings, briefs) and folds events in when it
breeds the next generation. This router is deliberately dumb storage:
no Elo math, no selection logic — those live with the orchestrator
(docs/visualizer-ga.md).

Files live next to the candidates in the repo working copy
(frontend/src/visualizer/presets/gen/): the genepool is part of the lane's
source tree, versioned with the candidates it describes.
"""

import json
import time
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

REPO_ROOT = Path(__file__).resolve().parents[2]
GEN_DIR = REPO_ROOT / "frontend" / "src" / "visualizer" / "presets" / "gen"
MANIFEST_PATH = GEN_DIR / "genepool.json"
EVENTS_PATH = GEN_DIR / "events.jsonl"


class ArenaEvent(BaseModel):
    """One arena judgment. type: vote | note | promote | error.

    vote:    a/b = candidate ids, outcome = a|b|both_bad|both_good
    note:    target = candidate id (or "pair:a|b"), text = free feedback
    promote: target = candidate id
    error:   target = candidate id, text = the thrown error
    """

    type: str
    a: str | None = None
    b: str | None = None
    outcome: str | None = None
    target: str | None = None
    text: str | None = None
    # Param slider positions at vote time (breeding signal: the human's
    # preferred tuning of each candidate).
    paramsA: dict[str, float] | None = None
    paramsB: dict[str, float] | None = None
    # skip events (type "skip"): seconds the preset was watched before the
    # human manually advanced — watch time is quality evidence.
    watchedS: float | None = None


@router.get("/state")
def state() -> dict:
    manifest: dict = {"generation": 0, "candidates": {}}
    if MANIFEST_PATH.exists():
        try:
            manifest = json.loads(MANIFEST_PATH.read_text())
        except json.JSONDecodeError:
            pass  # orchestrator's problem; serve the default
    events: list[dict] = []
    if EVENTS_PATH.exists():
        for line in EVENTS_PATH.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return {"manifest": manifest, "events": events}


@router.post("/events")
def append_event(event: ArenaEvent) -> dict:
    GEN_DIR.mkdir(parents=True, exist_ok=True)
    record = {"at": time.time(), **event.model_dump(exclude_none=True)}
    with EVENTS_PATH.open("a") as handle:
        handle.write(json.dumps(record) + "\n")
    return {"ok": True}
