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
    item_variants = [normalize(item_title), normalize(f"{item_uploader} {item_title}")]
    track_variants = [
        normalize(f"{track_artist or ''} {track_title or ''}"),
        normalize(track_title or ""),
        normalize(Path(track_filename).stem),
    ]
    return max(
        _similarity(iv, tv) for iv in item_variants for tv in track_variants
    )


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
