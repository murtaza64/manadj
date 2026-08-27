"""Picker result shaping: make the right file the obvious pick (issue 04).

Pure functions over Search Supplier results — no I/O, no DB. The search
endpoint shapes results before they reach the picker: non-audio junk dropped,
duration delta against the Source Item computed per candidate, and the list
sorted exact-duration-lossless first (PRD story 4).
"""

from dataclasses import dataclass, fields
from typing import Any

from .supplier import SupplierSearchResult

# Candidate files a picker should ever offer. Peers share whole directories,
# so searches return cover art, playlists, cue sheets and the like.
AUDIO_FORMATS = frozenset(
    {"mp3", "m4a", "aac", "ogg", "opus", "wma", "mp2",
     "flac", "wav", "aiff", "aif", "alac", "ape", "wv"}
)
LOSSLESS_FORMATS = frozenset({"flac", "wav", "aiff", "aif", "alac", "ape", "wv"})

# |delta| within this counts as "exact duration": the same few-seconds line
# the UI uses for loud mismatch rendering (wrong-recording guard).
EXACT_DURATION_TOLERANCE_MS = 3_000


@dataclass(frozen=True)
class ShapedResult:
    """A candidate plus its picker-facing derived facts."""

    result: SupplierSearchResult
    # candidate duration minus the Source Item's; None when the peer
    # reported no duration (treated as risky: sorts last)
    duration_delta_ms: int | None

    @property
    def exact_duration(self) -> bool:
        return (
            self.duration_delta_ms is not None
            and abs(self.duration_delta_ms) <= EXACT_DURATION_TOLERANCE_MS
        )

    @property
    def lossless(self) -> bool:
        return self.result.format in LOSSLESS_FORMATS


def shape_results(
    results: list[SupplierSearchResult], item_duration_ms: int
) -> list[ShapedResult]:
    """Filter to audio, compute duration deltas, sort best-pick-first.

    Order: exact-duration lossless, then exact-duration lossy, then the rest;
    within a tier by |delta| (unknown durations last), then lossless, then
    bitrate (high first), then free slot / shorter peer queue.
    """
    shaped = [
        ShapedResult(
            result=r,
            duration_delta_ms=(
                r.duration_ms - item_duration_ms if r.duration_ms is not None else None
            ),
        )
        for r in results
        if r.format in AUDIO_FORMATS
    ]

    def sort_key(s: ShapedResult) -> tuple:
        tier = 0 if (s.exact_duration and s.lossless) else 1 if s.exact_duration else 2
        return (
            tier,
            abs(s.duration_delta_ms) if s.duration_delta_ms is not None else float("inf"),
            not s.lossless,
            -(s.result.bitrate_kbps or 0),
            not s.result.has_free_slot,
            s.result.queue_length if s.result.queue_length is not None else float("inf"),
        )

    return sorted(shaped, key=sort_key)


# Hands-off downloads (gh#214): what counts as "a reasonable high-quality
# mp3", and how many distinct peers a download will try before failing.
MIN_AUTO_BITRATE_KBPS = 192
MAX_AUTO_SOURCES = 5


def auto_candidates(
    shaped: list[ShapedResult], limit: int = MAX_AUTO_SOURCES
) -> list[ShapedResult]:
    """The hands-off pick list: best-first mp3s worth downloading unseen.

    Eligible: exact duration (the wrong-recording guard is non-negotiable
    without an operator looking), mp3, and a reported bitrate of at least
    MIN_AUTO_BITRATE_KBPS (an unreported bitrate is not worth a blind pick).
    One candidate per peer, so retries actually try *different* sources;
    `shaped` is already best-first, so the list inherits its order.
    """
    seen_peers: set[str] = set()
    out: list[ShapedResult] = []
    for s in shaped:
        r = s.result
        if r.format != "mp3" or not s.exact_duration:
            continue
        if (r.bitrate_kbps or 0) < MIN_AUTO_BITRATE_KBPS:
            continue
        if r.username is not None:
            if r.username in seen_peers:
                continue
            seen_peers.add(r.username)
        out.append(s)
        if len(out) >= limit:
            break
    return out


_RESULT_FIELDS = frozenset(f.name for f in fields(SupplierSearchResult))


def result_from_dict(d: dict[str, Any]) -> SupplierSearchResult:
    """A SupplierSearchResult from a stored/wire candidate dict, ignoring
    picker-facing extras (duration_delta_ms) and tolerating missing fields."""
    return SupplierSearchResult(**{k: v for k, v in d.items() if k in _RESULT_FIELDS})


def dicts_to_shaped(dicts: list[dict[str, Any]]) -> list[ShapedResult]:
    """Rehydrate a remembered search's candidate dicts (gh#216) — the stored
    list is already shaped, so deltas are read back, not recomputed."""
    return [
        ShapedResult(result=result_from_dict(d), duration_delta_ms=d.get("duration_delta_ms"))
        for d in dicts
    ]
