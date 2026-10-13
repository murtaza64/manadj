"""Matching: proposing Source Correspondences between Source Items and Tracks.

Pure logic. Three tiers (see PRD / issue 04):
1. exact normalized match + duration agreement -> auto-confirm
2. above-threshold fuzzy similarity          -> proposal for user review
3. otherwise                                  -> unmatched

Duration is the strongest negative signal: a large mismatch blocks even an
exact title match (the clip-vs-full-track case).
"""

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

JUNK_PATTERNS = [
    r"\bfree\s+(download|dl)\b",
    r"\bout\s+now\b",
    r"\bcoming\s+soon\b",
]


@dataclass(frozen=True)
class MatchingConfig:
    auto_accept_score: float = 0.97
    proposal_score: float = 0.72
    duration_exact_secs: float = 2.0
    duration_mismatch_fraction: float = 0.15


def normalize(text: str) -> str:
    """Lowercase, strip junk tokens and punctuation, collapse whitespace."""
    text = text.lower()
    for pattern in JUNK_PATTERNS:
        text = re.sub(pattern, " ", text)
    return " ".join(re.findall(r"[a-z0-9]+", text))


def _similarity(a: str, b: str) -> float:
    """Max of sequence similarity and token-set Jaccard (handles reordering)."""
    if not a or not b:
        return 0.0
    seq = SequenceMatcher(None, a, b).ratio()
    ta, tb = set(a.split()), set(b.split())
    jaccard = len(ta & tb) / len(ta | tb)
    return max(seq, jaccard)


def score_pair(
    item_title: str,
    item_uploader: str,
    track_title: str | None,
    track_artist: str | None,
    track_filename: str,
) -> float:
    """Best similarity between a Source Item's and a Track's naming variants."""
    return _best_similarity(
        item_variants(item_title, item_uploader),
        track_variants(track_title, track_artist, track_filename),
    )


def item_variants(title: str, uploader: str) -> list[str]:
    return [normalize(title), normalize(f"{uploader} {title}")]


def track_variants(title: str | None, artist: str | None, filename: str) -> list[str]:
    return [
        normalize(f"{artist or ''} {title or ''}"),
        normalize(title or ""),
        normalize(Path(filename).stem),
    ]


def _best_similarity(ivs: list[str], tvs: list[str]) -> float:
    return max(_similarity(iv, tv) for iv in ivs for tv in tvs)


@dataclass(frozen=True)
class LibraryTrack:
    """The matcher's view of a Track."""

    track_id: int
    title: str | None
    artist: str | None
    filename: str
    duration_secs: float | None


@dataclass(frozen=True)
class LibraryMatch:
    track: LibraryTrack
    score: float
    duration: str  # duration_status
    # 'match' = would auto-confirm; 'probable' = would be proposed
    confidence: str


class LibraryIndex:
    """Many-lookup matcher over a library snapshot (Feed rows, #347).

    Same scoring as the matching pass (score_pair + duration_status), with
    Track variants normalized once and candidates narrowed to Tracks sharing
    at least one normalized token with the item — a pair with no shared token
    can't plausibly clear the proposal threshold, and scoring every Track per
    row is too slow for interactive feed browsing.
    """

    def __init__(self, tracks: list[LibraryTrack], config: MatchingConfig | None = None) -> None:
        self.config = config or MatchingConfig()
        self._tracks = tracks
        self._variants = [track_variants(t.title, t.artist, t.filename) for t in tracks]
        self._by_token: dict[str, list[int]] = {}
        for i, variants in enumerate(self._variants):
            for token in {tok for v in variants for tok in v.split()}:
                self._by_token.setdefault(token, []).append(i)

    def best(self, title: str, uploaders: list[str], duration_ms: int) -> LibraryMatch | None:
        """The best above-proposal-threshold Track for an item, or None.

        `uploaders`: alternative artist credits to try (e.g. all credited
        artists joined, and the primary artist alone).
        """
        ivs = list(dict.fromkeys(v for u in uploaders or [""] for v in item_variants(title, u)))
        candidates: set[int] = set()
        for token in {tok for v in ivs for tok in v.split()}:
            candidates.update(self._by_token.get(token, ()))
        best: LibraryMatch | None = None
        for i in sorted(candidates):
            track = self._tracks[i]
            dur = duration_status(duration_ms, track.duration_secs, self.config)
            if dur == "mismatch":
                continue
            score = _best_similarity(ivs, self._variants[i])
            if best is None or score > best.score:
                best = LibraryMatch(track, score, dur, "")
        if best is None:
            return None
        if best.score >= self.config.auto_accept_score and best.duration == "exact":
            return LibraryMatch(best.track, best.score, best.duration, "match")
        if best.score >= self.config.proposal_score:
            return LibraryMatch(best.track, best.score, best.duration, "probable")
        return None


def duration_status(
    item_duration_ms: int, track_duration_secs: float | None, config: MatchingConfig
) -> str:
    """'exact' | 'plausible' | 'mismatch' | 'unknown'."""
    if track_duration_secs is None:
        return "unknown"
    item_secs = item_duration_ms / 1000
    delta = abs(item_secs - track_duration_secs)
    if delta <= config.duration_exact_secs:
        return "exact"
    longer = max(item_secs, track_duration_secs)
    if longer > 0 and delta / longer > config.duration_mismatch_fraction:
        return "mismatch"
    return "plausible"
