"""The Source Item lifecycle as one wire-level `stage`.

Since manadj no longer downloads audio (gh#488/#489), the lifecycle is the
persisted `SourceItem.state` itself: new (wanted) → fulfilled (owned — a
Source Correspondence to a Track exists) or ignored. There are no download
tasks to fold in.

Legacy data compatibility: pre-removal databases can hold `queued` items
(items that were waiting on a download task). Those reads as `new` — wanted,
not yet owned — without rewriting the row.
"""

from typing import Literal

Stage = Literal["new", "fulfilled", "ignored"]


def derive_stage(item_state: str) -> Stage:
    """The item's wire stage from its persisted state.

    A legacy `queued` item presents as `new`: with no download path left,
    "queued for download" can only mean "still wanted".
    """
    if item_state in ("fulfilled", "ignored"):
        return item_state  # type: ignore[return-value]
    return "new"