"""MIREX-weighted key scoring (ADR 0020).

Pure functions over the canonical Key type. Error classes reflect DJ
reality: a fifth or relative is still mixable; a parallel is a common
detector confusion; everything else burns the mix. Headline metric is the
mixable rate (exact + fifth + relative).

Engine key ID layout (backend.key): even = major, odd = minor;
`id // 2` is the position on the circle of fifths, so relatives share a
number and fifths are adjacent numbers in the same mode.
"""

from __future__ import annotations

from typing import Literal

from backend.key import Key

KeyClass = Literal["exact", "fifth", "relative", "parallel", "other"]

MIREX_WEIGHTS: dict[KeyClass, float] = {
    "exact": 1.0,
    "fifth": 0.5,
    "relative": 0.3,
    "parallel": 0.2,
    "other": 0.0,
}

MIXABLE: tuple[KeyClass, ...] = ("exact", "fifth", "relative")


def _circle_position(key: Key) -> int:
    assert key.engine_id is not None
    return key.engine_id // 2


def _is_minor(key: Key) -> bool:
    return key.engine_id % 2 == 1


def _tonic_pitch_class(key: Key) -> int:
    """Pitch class of the tonic (C=0), derived from the circle position."""
    n = _circle_position(key)
    if _is_minor(key):
        return (9 + n * 7) % 12  # Am is at position 0
    return (n * 7) % 12  # C is at position 0


def classify(estimate: Key, truth: Key) -> KeyClass:
    if estimate == truth:
        return "exact"
    same_mode = _is_minor(estimate) == _is_minor(truth)
    dn = (_circle_position(estimate) - _circle_position(truth)) % 12
    if same_mode and dn in (1, 11):
        return "fifth"
    if not same_mode and dn == 0:
        return "relative"
    if not same_mode and _tonic_pitch_class(estimate) == _tonic_pitch_class(truth):
        return "parallel"
    return "other"


def summarize_key_scores(classes: list[str]) -> dict:
    """Accepts KeyClass values plus runner-level outcomes ("undetected",
    "error"), which score 0 and count against the denominator."""
    counts: dict[str, int] = {}
    for c in classes:
        counts[c] = counts.get(c, 0) + 1
    n = len(classes)
    return {
        "n": n,
        "classes": counts,
        "mixable_rate": sum(counts.get(c, 0) for c in MIXABLE) / n if n else None,
        "weighted_score": (
            sum(MIREX_WEIGHTS.get(c, 0.0) for c in classes) / n if n else None
        ),
    }
