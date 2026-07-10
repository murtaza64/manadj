"""Picker result shaping: make the right file the obvious pick (issue 04).

Pure functions over Search Supplier results — no I/O, no DB. The search
endpoint shapes results before they reach the picker: non-audio junk dropped,
duration delta against the Source Item computed per candidate, and the list
sorted exact-duration-lossless first (PRD story 4).
"""

from dataclasses import dataclass

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
