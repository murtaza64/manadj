"""Session silence evaluation (sessions 11).

The one audibility definition — playing AND not EQ-full-killed AND not
filter-killed AND Master-bus gain (trim x channel fader x crossfader) at or
above the audible threshold; PFL and CUE-stab preview invisible — ported
from the frontend seam and replayed over a persisted Session event stream.

KEPT IN LOCKSTEP with:
  - frontend/src/capture/audibility.ts (the definition)
  - frontend/src/playback/mixerMath.ts (the gain curves)
  - frontend/src/capture/detector.ts   (fresh-deck defaults, event replay)
  - frontend/src/capture/events.ts     (DEFAULT_DETECTOR_PARAMS thresholds)

Used by the sessions router to enforce the sessions-11 rule backend-side:
no persisted Session whose event stream was 100% silent survives shutdown,
crash recovery, or an auto-split. New-client rows always contain their
activating Master-audible instant; this evaluator exists to sweep rows a
legacy/intermediate activation path opened on non-audible live events.
"""

from collections.abc import Iterable
from typing import Any

# DEFAULT_DETECTOR_PARAMS (events.ts) — the kill/audibility thresholds.
AUDIBLE_GAIN = 0.05
EQ_KILL_BELOW = 0.05
FILTER_KILL_BEYOND = 0.97

# mixerMath.ts trim staging: center = -6 dB, range -18 .. +6 dB.
_TRIM_CENTER_DB = -6.0
_TRIM_RANGE_DB = 12.0

_ALL_DECKS = ("A", "B", "C", "D")


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _channel_fader_to_gain(value: float) -> float:
    """Audio taper (quadratic), mixerMath.channelFaderToGain."""
    v = _clamp01(value)
    return v * v


def _trim_to_gain(value: float) -> float:
    """mixerMath.trimToGain: center -6 dB, -18 .. +6 dB throw."""
    v = _clamp01(value)
    return 10.0 ** ((_TRIM_CENTER_DB + (v - 0.5) * 2.0 * _TRIM_RANGE_DB) / 20.0)


def _channel_crossfader_gain(assignment: float, position: float) -> float:
    """mixerMath.channelCrossfaderGain over the encoded assignment
    (left=-1, thru=0, right=1; events.ts crossfaderAssignment). Dipless
    curve: unity across the deck's own half, linear kill to the far end."""
    if assignment == 0:  # thru bypasses the crossfader
        return 1.0
    x = max(-1.0, min(1.0, position))
    return _clamp01(1.0 - x) if assignment < 0 else _clamp01(1.0 + x)


def _fresh_deck() -> dict[str, Any]:
    """detector.ts freshDeck: channel-strip defaults — fader up, trim/EQ
    centered, filter off, stopped."""
    return {
        "playing": False,
        "fader": 1.0,
        "trim": 0.5,
        "eq_low": 0.5,
        "eq_mid": 0.5,
        "eq_high": 0.5,
        "filter": 0.0,
    }


def _deck_audible(deck: dict[str, Any], crossfader: float, crossfader_enabled: bool,
                  assignment: float) -> bool:
    """audibility.ts isDeckAudible, verbatim semantics."""
    if not deck["playing"]:
        return False
    if (
        deck["eq_low"] <= EQ_KILL_BELOW
        and deck["eq_mid"] <= EQ_KILL_BELOW
        and deck["eq_high"] <= EQ_KILL_BELOW
    ):
        return False
    if abs(deck["filter"]) >= FILTER_KILL_BEYOND:
        return False
    xf_gain = _channel_crossfader_gain(
        assignment, crossfader if crossfader_enabled else 0.0
    )
    gain = _trim_to_gain(deck["trim"]) * _channel_fader_to_gain(deck["fader"]) * xf_gain
    return gain >= AUDIBLE_GAIN


_CONTROL_FIELDS = {
    "fader": "fader",
    "trim": "trim",
    "eqLow": "eq_low",
    "eqMid": "eq_mid",
    "eqHigh": "eq_high",
    "filter": "filter",
}


def events_contain_audible(events: Iterable[dict[str, Any]]) -> bool:
    """Did any instant of this event stream have at least one Master-audible
    Deck? Replays the audibility inputs (controls, transport, crossfader
    routing) and tests all four Decks after every event. PFL and CUE-stab
    preview are invisible; tenure/tick/load/pitch/bend/loop/init never
    change audibility. Short-circuits on the first audible instant."""
    decks = {ch: _fresh_deck() for ch in _ALL_DECKS}
    # Default crossfader sides mirror the mixer (A/C left, B/D right) —
    # the recorder seeds the real assignments via crossfaderAssignment.
    assignments = {"A": -1.0, "B": 1.0, "C": -1.0, "D": 1.0}
    crossfader = 0.0
    crossfader_enabled = True

    for e in events:
        kind = e.get("kind")
        if kind == "control":
            control = e.get("control")
            channel = e.get("channel")
            value = float(e.get("value", 0))
            field = _CONTROL_FIELDS.get(control)
            if field is not None and channel in decks:
                decks[channel][field] = value
            elif control == "crossfaderAssignment" and channel in decks:
                assignments[channel] = value
            elif control == "crossfader":
                crossfader = value
            elif control == "crossfaderEnabled":
                crossfader_enabled = value != 0
            # pfl / master: invisible to Deck Master-audibility (the
            # detector never reads them either).
        elif kind == "transport":
            action = e.get("action")
            channel = e.get("channel")
            if channel in decks:
                if action == "play":
                    decks[channel]["playing"] = True
                elif action in ("pause", "cue"):
                    decks[channel]["playing"] = False
                # previewStart/previewEnd: preview never flips `playing`
                # (phase-1 boundary, detector.ts); seek/jumpBeats/hotCue
                # don't touch audibility inputs.
        # tenure / tick / load / pitch / bend / loop / init: no audibility
        # inputs change.

        if any(
            _deck_audible(decks[ch], crossfader, crossfader_enabled, assignments[ch])
            for ch in _ALL_DECKS
        ):
            return True
    return False
