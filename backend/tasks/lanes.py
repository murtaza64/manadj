"""Concurrency lanes for the task system (gh#224).

One worker thread per lane; each lane serializes its own task types and owns
its own pacing/backoff state. This keeps the constraint that a given task
type never runs twice concurrently — `(state=running, type, ref)` stays a
unique address — while letting a slow librosa analysis proceed alongside
other work.

Every registered task type MUST appear in exactly one lane: `split_handlers`
raises on an unknown type so a new task type fails loudly at startup instead
of silently ending up unscheduled.
"""

from .manager import Handler

# Lane -> task types. Type strings are the DB values (stable), not imports of
# the *_TASK_TYPE constants — those modules pull heavy deps (librosa etc.)
# and are imported lazily by main.py.
LANES: dict[str, tuple[str, ...]] = {
    # CPU-bound local work, plus the onboarding imports (#274/#276): imports
    # share the lane with the waveform/analysis tasks they enqueue, matching
    # the pre-lane serialized ordering.
    "compute": (
        "waveform",
        "analysis",
        "stem-split",
        "harmony",
        "routine-mine",
        "rekordbox-onboarding-import",
        "tracks-directory-import",
    ),
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