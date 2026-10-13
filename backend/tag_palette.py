"""Saturated Tag palette (onboarding #326) — mirror of TAG_COLORS in
frontend/src/theme/tokens.ts (tests/test_design_token_mirrors.py)."""

import random

TAG_COLORS: list[str] = [
    "#ff1744",
    "#ff8800",
    "#ffd400",
    "#76ff03",
    "#2ed573",
    "#00cec9",
    "#00b0ff",
    "#1e90ff",
    "#651fff",
    "#a855f7",
    "#d500f9",
    "#ff5cc8",
]


class TagColorPicker:
    """Random palette picks that cycle through every color before any
    repeats (a shuffled deck, reshuffled when empty), so siblings in a
    category rarely share a color. `rng` is injectable for tests."""

    def __init__(self, rng: random.Random | None = None) -> None:
        self._rng = rng or random.Random()
        self._deck: list[str] = []

    def next(self) -> str:
        if not self._deck:
            self._deck = list(TAG_COLORS)
            self._rng.shuffle(self._deck)
        return self._deck.pop()
