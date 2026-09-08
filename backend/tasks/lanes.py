"""Concurrency lanes for the task system (gh#224).

One worker thread per lane; each lane serializes its own task types and owns
its own pacing/backoff state. This keeps the constraint that a given task
type never runs twice concurrently — `(state=running, type, ref)` stays a
unique address (backend/acquisition/download.py) — while letting a slow
librosa analysis proceed during a SoundCloud download, and letting soulseek
transfers proceed while the SoundCloud lane sits in its pacing sleep or
rate-limit cool-down.

Every registered task type MUST appear in exactly one lane: `split_handlers`
raises on an unknown type so a new task type fails loudly at startup instead
of silently ending up unscheduled.
"""

from .manager import Handler

# Lane -> task types. Type strings are the DB values (stable), not imports of
# the *_TASK_TYPE constants — those modules pull heavy deps (librosa etc.)
# and are imported lazily by main.py.
LANES: dict[str, tuple[str, ...]] = {
    # SoundCloud downloads: paced (download_delay_secs) and 429-backed-off;
    # isolated so the budget sleep stalls nothing else.
    "soundcloud": ("download",),
    # Soulseek traffic polls slskd — no SoundCloud budget applies to it.
    "soulseek": ("soulseek-download", "soulseek-search"),
    # CPU-bound local work.
    "compute": ("waveform", "analysis", "stem-split", "routine-mine"),
}

_TYPE_TO_LANE: dict[str, str] = {
    type_: lane for lane, types in LANES.items() for type_ in types
}


def split_handlers(handlers: dict[str, Handler]) -> dict[str, dict[str, Handler]]:
    """Group `handlers` by lane; only lanes with at least one handler appear.

    Raises KeyError for a task type not assigned to any lane.
    """
    by_lane: dict[str, dict[str, Handler]] = {}
    for type_, handler in handlers.items():
        try:
            lane = _TYPE_TO_LANE[type_]
        except KeyError:
            raise KeyError(
                f"task type {type_!r} is not assigned to a concurrency lane; "
                "add it to backend.tasks.lanes.LANES"
            ) from None
        by_lane.setdefault(lane, {})[type_] = handler
    return by_lane
