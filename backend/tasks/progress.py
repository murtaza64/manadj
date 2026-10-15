"""Progress reporters for task handlers (gh#342).

Thin adapters from a work source's own progress signal (a yt-dlp hook, an
slskd transfer record) to `manager.report_progress`, which writes the
current task's `progress` / `progress_label`. Throttled: a hook can fire
hundreds of times a second; one write per ~2% or ~1s is plenty for a UI
polling every few seconds.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

MIN_STEP = 0.02
MIN_INTERVAL_SECS = 1.0


def format_bytes(done: int | None, total: int | None) -> str | None:
    if total:
        return f"{(done or 0) / 1e6:.1f} / {total / 1e6:.1f} MB"
    if done:
        return f"{done / 1e6:.1f} MB"
    return None


class Throttled:
    """Call-through that drops reports closer than MIN_STEP / MIN_INTERVAL."""

    def __init__(self, report: Callable[[float | None, str | None], None]) -> None:
        self._report = report
        self._last_fraction = -1.0
        self._last_at = 0.0

    def __call__(self, fraction: float | None, label: str | None, force: bool = False) -> None:
        now = time.monotonic()
        if not force and fraction is not None:
            if fraction - self._last_fraction < MIN_STEP and now - self._last_at < MIN_INTERVAL_SECS:
                return
        self._last_fraction = fraction if fraction is not None else self._last_fraction
        self._last_at = now
        self._report(fraction, label)


def _default_report(fraction: float | None, label: str | None) -> None:
    from .manager import report_progress

    report_progress(fraction, label)


def ytdlp_progress_hook(report: Callable[[float | None, str | None], None] | None = None) -> Callable[[dict[str, Any]], None]:
    """A yt-dlp `progress_hooks` entry writing task progress."""
    emit = Throttled(report or _default_report)

    def hook(d: dict[str, Any]) -> None:
        status = d.get("status")
        if status == "downloading":
            done = d.get("downloaded_bytes")
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            fraction = (done / total) if done is not None and total else None
            emit(fraction, format_bytes(done, total))
        elif status == "finished":
            total = d.get("total_bytes") or d.get("downloaded_bytes")
            emit(1.0, format_bytes(total, total), force=True)

    return hook


def transfer_progress(done: int | None, total: int | None, report: Callable[[float | None, str | None], None] | None = None) -> None:
    """Report an slskd transfer's bytes (one poll = one write; the poller is
    already paced by the worker tick, so no throttle)."""
    fraction = (done / total) if done is not None and total else None
    (report or _default_report)(fraction, format_bytes(done, total))
