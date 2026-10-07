"""The Source Item lifecycle as one wire-level `stage` (gh#342).

The persisted `SourceItem.state` (new / queued / fulfilled / ignored) and the
latest download task's state together describe where an item is; the UI
should not have to reconcile the pair. This module derives:

- `stage`: new | queued | downloading | failed | fulfilled | ignored
- `error_kind`: a coarse classification of a failed download's error text,
  so the UI can pick the right next step (DRM: never retry SoundCloud;
  ratelimit: it will retry itself; gone/peer/other: offer alternatives).

Pure functions — no I/O, no DB.
"""

import re
from typing import Literal

Stage = Literal["new", "queued", "downloading", "failed", "fulfilled", "ignored"]
ErrorKind = Literal["drm", "gone", "ratelimit", "peer", "other"]

_DRM = re.compile(r"drm", re.I)
_RATELIMIT = re.compile(r"\b429\b|rate[ -]?limit|too many requests", re.I)
_GONE = re.compile(
    r"\b404\b|\b403\b|not found|removed|unavailable|unable to download json metadata|"
    r"private|geo.?block",
    re.I,
)
_PEER = re.compile(
    r"not completed within|transfer failed|peer|offline|rejected|timed? ?out|queue",
    re.I,
)


def derive_stage(item_state: str, task_state: str | None) -> Stage:
    """Where an item is in its lifecycle, from its state + latest task state.

    A `queued` item without a task (the task row was cancelled or lost) is
    still `queued` from the persisted state's point of view — the queue
    endpoint is idempotent, so the UI's "get" simply re-creates the task.
    """
    if item_state in ("fulfilled", "ignored"):
        return item_state  # type: ignore[return-value]
    if item_state == "new":
        return "new"
    # queued: the task decides
    if task_state == "running":
        return "downloading"
    if task_state == "failed":
        return "failed"
    return "queued"


def classify_error(error: str | None, via: str) -> ErrorKind | None:
    """Coarse kind of a download failure; None when there is no error."""
    if not error:
        return None
    if _DRM.search(error):
        return "drm"
    if _RATELIMIT.search(error):
        return "ratelimit"
    if via == "soulseek" and _PEER.search(error):
        return "peer"
    if _GONE.search(error):
        return "gone"
    return "other"
