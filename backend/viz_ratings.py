"""Visualizer preset ratings (#401): one store for every rating surface.

A rating is a GA solo verdict (docs/visualizer-ga.md): an append-only
`type: "solo"` line in the genepool event log, so the orchestrator folds
ratings from the phone, the clip editor and the video reviewer exactly like
verdicts from the main viz window. This module adds:

- `source`: viz | clip-editor | reviewer | phone (absent on legacy lines = viz)
- `uuid`: client id of one verdict. Lines sharing a uuid are ONE verdict;
  the latest line wins (a re-sent identical verdict is not appended, so
  device pushes are idempotent; a changed outcome replaces).
- `ratedAt`: when the human rated (epoch s). `at` stays the receive time so
  an offline-queued phone rating still lands after the manifest's
  `foldedThrough` mark.
- `context`: where it was rated (track_id, routine/clip source, video, t).
- `device`: the phone that pushed it.

Curated preset ids map to their `g00-<id>` GA seed when one exists.
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Iterable, Literal

from pydantic import BaseModel, Field

Outcome = Literal["like", "dislike", "neutral"]
Source = Literal["viz", "clip-editor", "reviewer", "phone"]

_lock = threading.Lock()
_GEN_ID = re.compile(r"^g\d+-")


class RatingIn(BaseModel):
    preset: str = Field(min_length=1)
    outcome: Outcome
    uuid: str | None = None
    rated_at_ms: int | None = None
    context: dict[str, Any] | None = None
    params: dict[str, float] | None = None


def canonical_preset_id(preset: str, gen_dir: Path) -> str:
    """Curated `voyage` → `g00-voyage` when that seed exists; else as-is."""
    if _GEN_ID.match(preset):
        return preset
    return f"g00-{preset}" if (gen_dir / f"g00-{preset}.candidate.ts").exists() else preset


def read_events(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _latest_by_uuid(events: Iterable[dict]) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for e in events:
        if e.get("type") == "solo" and e.get("uuid"):
            latest[e["uuid"]] = e
    return latest


def record(
    ratings: list[RatingIn],
    source: Source,
    events_path: Path,
    gen_dir: Path,
    device: dict[str, str | None] | None = None,
) -> dict[str, int]:
    """Append ratings as solo events. Returns {accepted, unchanged}."""
    now = time.time()
    accepted = unchanged = 0
    with _lock:
        latest = _latest_by_uuid(read_events(events_path))
        lines: list[str] = []
        for r in ratings:
            target = canonical_preset_id(r.preset, gen_dir)
            prev = latest.get(r.uuid) if r.uuid else None
            if prev is not None and prev.get("target") == target and prev.get("outcome") == r.outcome:
                unchanged += 1
                continue
            event: dict[str, Any] = {"at": now, "type": "solo", "target": target, "outcome": r.outcome, "source": source}
            if r.uuid:
                event["uuid"] = r.uuid
            event["ratedAt"] = r.rated_at_ms / 1000 if r.rated_at_ms is not None else now
            if r.params:
                event["paramsA"] = r.params
            if r.context:
                event["context"] = r.context
            if device:
                event["device"] = {k: v for k, v in device.items() if v is not None}
            lines.append(json.dumps(event))
            if r.uuid:
                latest[r.uuid] = event
            accepted += 1
        if lines:
            events_path.parent.mkdir(parents=True, exist_ok=True)
            with events_path.open("a", encoding="utf-8") as handle:
                handle.write("".join(line + "\n" for line in lines))
    return {"accepted": accepted, "unchanged": unchanged}


def aggregate(events: list[dict]) -> dict[str, dict]:
    """Per preset: likes / dislikes / neutral / score / last verdict.

    Solo lines sharing a uuid collapse to the latest; uuid-less (legacy viz)
    lines each count once.
    """
    verdicts: list[dict] = []
    latest = _latest_by_uuid(events)
    for e in events:
        if e.get("type") != "solo" or not e.get("target") or e.get("outcome") not in ("like", "dislike", "neutral"):
            continue
        if e.get("uuid") and latest.get(e["uuid"]) is not e:
            continue
        verdicts.append(e)
    out: dict[str, dict] = {}
    for e in verdicts:
        row = out.setdefault(e["target"], {"likes": 0, "dislikes": 0, "neutral": 0, "score": 0, "last": None})
        key = {"like": "likes", "dislike": "dislikes", "neutral": "neutral"}[e["outcome"]]
        row[key] += 1
        row["score"] = row["likes"] - row["dislikes"]
        at = e.get("ratedAt", e.get("at", 0))
        if row["last"] is None or at >= row["last"]["at"]:
            row["last"] = {"outcome": e["outcome"], "at": at, "source": e.get("source", "viz")}
    return out
