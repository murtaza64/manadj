"""Classification heuristics for Source Items.

A Classification (track / mix / clip / other) is a heuristic-assigned,
user-overridable category — a suggestion for filtering, never an auto-ignore
(see CONTEXT.md: Classification).

Precedence: duration extremes are the strongest signal (a 45-second "mix" is
a clip); then clip keywords; then mix keywords; otherwise track. Keyword
matching is word-boundary and case-insensitive so "remix" never matches "mix".
"other" is never assigned by the heuristic — it exists for manual overrides.
"""

import re
from dataclasses import dataclass, field

CLASSIFICATIONS = ("track", "mix", "clip", "other")


@dataclass(frozen=True)
class ClassificationConfig:
    clip_max_duration_secs: int = 90
    mix_min_duration_secs: int = 1200
    # Bare "mix"/"set" are deliberately absent: "(Original Mix)", "VIP Mix",
    # "Set Me Free" are ordinary tracks. Long DJ mixes are caught by duration.
    mix_keywords: list[str] = field(
        default_factory=lambda: [
            "mixtape", "podcast", "radio show", "b2b", "dj set", "live set",
            "guest mix", "dj mix", "minimix", "mini mix",
        ]
    )
    clip_keywords: list[str] = field(
        default_factory=lambda: ["preview", "snippet", "clip", "teaser"]
    )


def _matches_any(title: str, keywords: list[str]) -> bool:
    return any(
        re.search(rf"\b{re.escape(kw)}\b", title, flags=re.IGNORECASE) for kw in keywords
    )


def classify(title: str, duration_ms: int, config: ClassificationConfig) -> str:
    """Classify a Source Item from its title and duration."""
    duration_secs = duration_ms / 1000
    if duration_secs < config.clip_max_duration_secs:
        return "clip"
    if duration_secs > config.mix_min_duration_secs:
        return "mix"
    if _matches_any(title, config.clip_keywords):
        return "clip"
    if _matches_any(title, config.mix_keywords):
        return "mix"
    return "track"
