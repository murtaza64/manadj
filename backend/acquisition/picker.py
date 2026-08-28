"""Picker result shaping: make the right file the obvious pick (issue 04).

Pure functions over Search Supplier results — no I/O, no DB. The search
endpoint shapes results before they reach the picker: non-audio junk dropped,
duration delta against the Source Item computed per candidate, and the list
sorted best-pick-first (PRD story 4; since gh#214 feedback, exact-duration
high-quality mp3s outrank lossless).
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

# A "high-quality mp3": what this library actually wants — ranked above
# lossless (bigger files, no audible win for DJ use).
HQ_MP3_BITRATE_KBPS = 256


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

    @property
    def hq_mp3(self) -> bool:
        return (
            self.result.format == "mp3"
            and (self.result.bitrate_kbps or 0) >= HQ_MP3_BITRATE_KBPS
        )


def shape_results(
    results: list[SupplierSearchResult], item_duration_ms: int | None
) -> list[ShapedResult]:
    """Filter to audio, compute duration deltas, sort best-pick-first.

    Order: exact-duration candidates first — high-quality mp3s, then
    lossless, then the rest — followed by the inexact by |delta| (unknown
    durations last), then quality; ties broken by bitrate (high first), then
    free slot / shorter peer queue.

    `item_duration_ms=None` (standalone search, gh#217: nothing to compare
    against) leaves every delta None — ordering degrades to quality only,
    bitrate (high first), then free slot / shorter peer queue.
    """
    shaped = [
        ShapedResult(
            result=r,
            duration_delta_ms=(
                r.duration_ms - item_duration_ms
                if r.duration_ms is not None and item_duration_ms is not None
                else None
            ),
        )
        for r in results
        if r.format in AUDIO_FORMATS
    ]

    def sort_key(s: ShapedResult) -> tuple:
        # quality: hq mp3s outrank lossless (this library wants mp3s; flacs
        # are bigger files with no audible win for DJ use), lossless outranks
        # the low-bitrate rest
        quality = 0 if s.hq_mp3 else 1 if s.lossless else 2
        delta = abs(s.duration_delta_ms) if s.duration_delta_ms is not None else float("inf")
        # exact-duration candidates are all the right recording: quality
        # decides. Among the rest, closeness to the right recording matters
        # more than format. (Positions 1/2 only ever compare within a group.)
        first, second = (quality, delta) if s.exact_duration else (delta, quality)
        return (
            not s.exact_duration,
            first,
            second,
            -(s.result.bitrate_kbps or 0),
            not s.result.has_free_slot,
            s.result.queue_length if s.result.queue_length is not None else float("inf"),
        )

    return sorted(shaped, key=sort_key)


# Hands-off downloads (gh#214): what counts as "a reasonable high-quality
# mp3", how far off its duration may be, and how many distinct peers a
# download will try before failing.
MIN_AUTO_BITRATE_KBPS = 192
AUTO_DURATION_TOLERANCE_MS = 5_000
MAX_AUTO_SOURCES = 5


def auto_candidates(
    shaped: list[ShapedResult], limit: int = MAX_AUTO_SOURCES
) -> list[ShapedResult]:
    """The hands-off pick list: best-first mp3s worth downloading unseen.

    Eligible: duration within AUTO_DURATION_TOLERANCE_MS (the wrong-recording
    guard is non-negotiable without an operator looking — ± a few seconds is
    fine, an unknown duration is not), mp3, and a reported bitrate of at
    least MIN_AUTO_BITRATE_KBPS (an unreported bitrate is not worth a blind
    pick). One candidate per peer, so retries actually try *different*
    sources; `shaped` is already best-first, so the list inherits its order.
    """
    seen_peers: set[str] = set()
    out: list[ShapedResult] = []
    for s in shaped:
        r = s.result
        if r.format != "mp3":
            continue
        if s.duration_delta_ms is None or abs(s.duration_delta_ms) > AUTO_DURATION_TOLERANCE_MS:
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
