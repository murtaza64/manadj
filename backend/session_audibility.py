"""Session silence evaluation (sessions 11).

Session audibility — running transport or preview (or filtered scratch motion
while touched) AND not EQ-full-killed AND not
filter-killed AND Master-bus gain (trim x channel fader x crossfader) at or
above the audible threshold; PFL-only is invisible; OR a ringing Beat FX
echo/reverb tail (#355) — ported from the frontend seam and replayed over a
persisted Session event stream.

KEPT IN LOCKSTEP with:
  - frontend/src/capture/audibility.ts (the definition)
  - frontend/src/playback/mixerMath.ts (the gain curves)
  - frontend/src/capture/detector.ts   (fresh-deck defaults, event replay)
  - frontend/src/capture/events.ts     (DEFAULT_DETECTOR_PARAMS thresholds)
  - frontend/src/capture/fxTail.ts     (Beat FX tail length)
  - frontend/src/capture/audibilityReducer.ts (Beat FX excitation/tails)

Used by the sessions router to enforce the sessions-11 rule backend-side:
no persisted Session whose event stream was 100% silent survives shutdown,
crash recovery, or an auto-split. New-client rows always contain their
activating Master-audible instant; this evaluator exists to sweep rows a
legacy/intermediate activation path opened on non-audible live events.
"""

from collections.abc import Iterable
from math import exp, expm1, floor, isfinite, log
from typing import Any

# DEFAULT_DETECTOR_PARAMS (events.ts) — the kill/audibility thresholds.
AUDIBLE_GAIN = 0.05
EQ_KILL_BELOW = 0.05
FILTER_KILL_BEYOND = 0.97
# playback/worklet/scratchMotion.ts: analytic two-pole displacement filter.
SCRATCH_RESPONSE_SECONDS = 0.008
SCRATCH_SILENT_RATE = 0.001

# mixerMath.ts trim staging: center = -6 dB, range -18 .. +6 dB.
_TRIM_CENTER_DB = -6.0
_TRIM_RANGE_DB = 12.0

_ALL_DECKS = ("A", "B", "C", "D")

# playback/beatFx.ts + beatFxSettings.ts defaults (Beat FX tails, #355).
_BEAT_SECONDS_DEFAULT = 0.5
_MIN_ECHO_DELAY_S = 0.01
_MAX_ECHO_DELAY_S = 10.0
_DEFAULT_ECHO_FEEDBACK = 0.5
_DEFAULT_REVERB_DECAY = 2.5


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
        "previewing": False,
        "scratch": None,
        "scratch_at": 0.0,
        "position": 0.0,
        "track_duration": float("inf"),
        "loop": None,
        "fader": 1.0,
        "trim": 0.5,
        "eq_low": 0.5,
        "eq_mid": 0.5,
        "eq_high": 0.5,
        "filter": 0.0,
        "pitch": 0.0,
        "bpm": None,
        # Beat FX (#355): the exciting voicing (effect, beats, master) and a
        # ringing tail (until, master).
        "fx_excited": None,
        "fx_tail": None,
    }


def _beat_fx_wet(depth: float) -> float:
    """beatFx.ts beatFxMixGains(...).wet."""
    m = (max(-1.0, min(1.0, depth)) + 1) / 2
    return min(1.0, 2 * m)


def _deck_beat_seconds(bpm: Any, pitch: float) -> float:
    """fxTail.ts deckBeatSeconds."""
    if not isinstance(bpm, (int, float)) or not isfinite(bpm) or bpm <= 0:
        return _BEAT_SECONDS_DEFAULT
    rate = 1 + pitch / 100
    return 60 / bpm / rate if rate > 0 else _BEAT_SECONDS_DEFAULT


def _fx_tail_seconds(effect: str, beats: float, depth: float, settings: dict[str, Any],
                     beat_seconds: float) -> float:
    """fxTail.ts fxTailSeconds: echo = last repeat above the audible gain;
    reverb = wet envelope (-60 dB at reverbDecay) crossing it."""
    wet = _beat_fx_wet(depth)
    if wet < AUDIBLE_GAIN or wet <= 0:
        return 0.0
    if effect == "echo":
        delay = max(_MIN_ECHO_DELAY_S, min(_MAX_ECHO_DELAY_S, beats * beat_seconds))
        fb = float(settings.get("echoFeedback", _DEFAULT_ECHO_FEEDBACK))
        extra = floor(log(AUDIBLE_GAIN / wet) / log(fb)) if 0 < fb < 1 else 0
        return (1 + max(0, extra)) * delay
    decay = float(settings.get("reverbDecay", _DEFAULT_REVERB_DECAY))
    tau = decay / log(1000)
    return min(decay, tau * log(wet / AUDIBLE_GAIN))


def _scratch_loop(deck: dict[str, Any]) -> dict[str, float] | None:
    loop = deck["loop"]
    if not loop:
        return None
    start, end = max(0.0, loop["start"]), min(deck["track_duration"], loop["end"])
    return {"start": start, "end": end} if end > start else None


def _deck_audible(deck: dict[str, Any], crossfader: float, crossfader_enabled: bool,
                  assignment: float) -> bool:
    """audibilityReducer.ts sessionDeckAudible, excluding the tenure gate."""
    motion = deck["scratch"]
    running = deck["playing"] or deck["previewing"]
    if motion is not None:
        drive, rate = motion
        peak_time = max(0.0, 1 - rate / drive) if drive else 0.0
        peak = (rate + drive * peak_time) * exp(-peak_time)
        running = max(abs(peak), abs(rate)) > SCRATCH_SILENT_RATE
    if motion is not None and running:
        position, duration, loop = deck["position"], deck["track_duration"], _scratch_loop(deck)
        if not (loop and loop["start"] <= position < loop["end"]):
            direction = motion[1] if abs(motion[1]) > SCRATCH_SILENT_RATE else motion[0]
            running = duration > 0 and (position > 0 or direction > 0) and (position < duration or direction < 0)
    if not running:
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


def _scratch_travel(drive: float, rate: float, elapsed: float) -> float:
    x = max(0.0, elapsed) / SCRATCH_RESPONSE_SECONDS
    return SCRATCH_RESPONSE_SECONDS * (rate * -expm1(-x) + drive * (1 - (1 + x) * exp(-x)))


def _scratch_position(deck: dict[str, Any], elapsed: float) -> float:
    drive, rate = deck["scratch"]
    start, duration, loop = deck["position"], deck["track_duration"], _scratch_loop(deck)
    position = start + _scratch_travel(drive, rate, elapsed)
    if loop and loop["start"] <= start < loop["end"]:
        position = loop["start"] + (position - loop["start"]) % (loop["end"] - loop["start"])
    elif drive * rate < 0:
        turn = -rate / drive * SCRATCH_RESPONSE_SECONDS
        if turn < elapsed:
            extreme = start + _scratch_travel(drive, rate, turn)
            position += max(0.0, min(duration, extreme)) - extreme
    return max(0.0, min(duration, position))


def _scratch_sounded_between(deck: dict[str, Any], elapsed: float) -> bool:
    """scratchMotion.scratchSoundedBetween: monotone speed/position segments."""
    drive, rate = deck["scratch"]
    end = min(0.25, max(0.0, elapsed))
    if end == 0 or max(abs(drive), abs(rate)) <= SCRATCH_SILENT_RATE:
        return False
    times = [0.0, end]
    if drive:
        turn = -rate / drive * SCRATCH_RESPONSE_SECONDS
        times.extend(t for t in (turn, turn + SCRATCH_RESPONSE_SECONDS) if 0 < t < end)
    times.sort()

    def speed(t: float) -> float:
        x = t / SCRATCH_RESPONSE_SECONDS
        return abs((rate + drive * x) * exp(-x))

    for start, finish in zip(times, times[1:]):
        before, after = speed(start), speed(finish)
        if max(before, after) <= SCRATCH_SILENT_RATE:
            continue
        if min(before, after) <= SCRATCH_SILENT_RATE:
            low, high = start, finish
            for _ in range(40):
                mid = (low + high) / 2
                if (speed(mid) > SCRATCH_SILENT_RATE) == (before > SCRATCH_SILENT_RATE):
                    low = mid
                else:
                    high = mid
            if before <= SCRATCH_SILENT_RATE:
                start = high
            else:
                finish = low
        if finish <= start:
            continue
        loop = _scratch_loop(deck)
        if loop and loop["start"] <= deck["position"] < loop["end"]:
            return True
        if _scratch_position(deck, start) != _scratch_position(deck, finish):
            return True
    return False


def events_contain_audible(events: Iterable[dict[str, Any]]) -> bool:
    """Did any instant of this event stream have at least one Master-audible
    Deck? Replays the audibility inputs (controls, transport, crossfader
    routing) and tests all four Decks after every event. Audible cue stabs
    count; PFL-only does not. Filtered scratch motion sounds even while paused;
    a touched hold is silent. Short-circuits on the first audible instant."""
    decks = {ch: _fresh_deck() for ch in _ALL_DECKS}
    # Default crossfader sides mirror the mixer (A/C left, B/D right) —
    # the recorder seeds the real assignments via crossfaderAssignment.
    assignments = {"A": -1.0, "B": 1.0, "C": -1.0, "D": 1.0}
    crossfader = 0.0
    crossfader_enabled = True
    tenure_held = False
    beat_fx: dict[str, Any] | None = None
    beat_fx_settings: dict[str, Any] = {}

    def fx_excitation(ch: str) -> tuple[str, float, bool] | None:
        """audibilityReducer.ts fxExcitation (transport-gated, no previews)."""
        fx = beat_fx
        if not fx or not fx.get("on") or fx.get("selected") not in ("echo", "reverb"):
            return None
        master = fx.get("target") == "master"
        if not master and fx.get("target") != ch:
            return None
        if _beat_fx_wet(float(fx.get("depth", 0))) < AUDIBLE_GAIN:
            return None
        deck = {**decks[ch], "previewing": False}
        feeding = _deck_audible(deck, crossfader, crossfader_enabled,
                                assignments[ch] if master else 0.0)
        return (fx["selected"], float(fx.get("beats", 0.5)), master) if feeding else None

    def update_fx_tails(t: float) -> None:
        """audibilityReducer.ts updateFxTails."""
        live = beat_fx is not None and bool(beat_fx.get("on"))
        wet_dead = beat_fx is not None and _beat_fx_wet(float(beat_fx.get("depth", 0))) < AUDIBLE_GAIN
        for ch, deck in decks.items():
            excited = fx_excitation(ch) if live else None
            if excited:
                deck["fx_tail"] = None
            elif deck["fx_excited"]:
                effect, beats, master = deck["fx_excited"]
                depth = float(beat_fx.get("depth", -1)) if beat_fx else -1.0
                seconds = _fx_tail_seconds(effect, beats, depth, beat_fx_settings,
                                           _deck_beat_seconds(deck["bpm"], deck["pitch"]))
                deck["fx_tail"] = (t + seconds, master) if seconds > 0 else None
            elif deck["fx_tail"] and wet_dead:
                deck["fx_tail"] = None
            deck["fx_excited"] = excited

    def tail_audible(ch: str, t: float) -> bool:
        """audibilityReducer.ts fxTailAudible."""
        tail = decks[ch]["fx_tail"]
        if tail is None or t >= tail[0]:
            return False
        if tail[1]:
            return True
        xf = _channel_crossfader_gain(assignments[ch], crossfader if crossfader_enabled else 0.0)
        return xf >= AUDIBLE_GAIN

    for e in events:
        t = float(e.get("t", 0))
        if not tenure_held and any(
            deck["scratch"] is not None
            and _deck_audible({**deck, "scratch": None, "playing": True}, crossfader, crossfader_enabled, assignments[ch])
            and _scratch_sounded_between(deck, t - deck["scratch_at"])
            for ch, deck in decks.items()
        ):
            return True
        for deck in decks.values():
            motion = deck["scratch"]
            if motion is not None:
                drive, rate = motion
                elapsed = max(0.0, t - deck["scratch_at"])
                deck["position"] = _scratch_position(deck, elapsed)
                x = elapsed / SCRATCH_RESPONSE_SECONDS
                decay = exp(-x)
                deck["scratch"] = (drive * decay, (rate + drive * x) * decay)
                deck["scratch_at"] = t
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
                if e.get("playhead") is not None:
                    decks[channel]["position"] = float(e["playhead"])
                if "trackDuration" in e:
                    decks[channel]["track_duration"] = float(e["trackDuration"])
                if action == "play":
                    decks[channel]["playing"] = True
                elif action in ("pause", "cue"):
                    decks[channel]["playing"] = False
                elif action == "previewStart":
                    decks[channel]["previewing"] = True
                elif action == "previewEnd":
                    decks[channel]["previewing"] = False
                elif action == "scratchBegin":
                    decks[channel]["scratch"] = (0.0, 0.0)
                    decks[channel]["scratch_at"] = t
                elif action == "scratchMove":
                    state = e.get("filter") or {}
                    drive = float(state.get("drive", 0))
                    rate = float(state.get("rate", 0))
                    if isfinite(drive) and isfinite(rate):
                        decks[channel]["scratch"] = (drive, rate)
                        decks[channel]["scratch_at"] = t
                elif action == "scratchEnd":
                    decks[channel]["scratch"] = None
                # seek/jumpBeats/hotCue don't touch audibility inputs.
        elif kind == "load" and e.get("channel") in decks:
            decks[e["channel"]]["bpm"] = e.get("bpm")
            decks[e["channel"]]["fx_tail"] = None
            decks[e["channel"]]["previewing"] = False
            decks[e["channel"]]["scratch"] = None
            decks[e["channel"]]["track_duration"] = float("inf")
            decks[e["channel"]]["loop"] = None
            decks[e["channel"]]["position"] = 0.0
        elif kind == "loop" and e.get("channel") in decks:
            decks[e["channel"]]["loop"] = e.get("region")
            decks[e["channel"]]["position"] = float(e.get("playhead", 0))
        elif kind == "tick":
            for channel, position in e.get("playheads", {}).items():
                if channel in decks and decks[channel]["scratch"] is None:
                    decks[channel]["position"] = float(position)
        elif kind == "pitch" and e.get("channel") in decks:
            decks[e["channel"]]["pitch"] = float(e.get("value", 0))
        elif kind == "tenure":
            tenure_held = e.get("edge") == "start" and e.get("holder") != "shared"
        elif kind == "beatFx":
            beat_fx = e
        elif kind == "beatFxSettings":
            beat_fx_settings = e.get("settings") or {}
        update_fx_tails(t)

        if not tenure_held and any(
            _deck_audible(decks[ch], crossfader, crossfader_enabled, assignments[ch])
            or tail_audible(ch, t)
            for ch in _ALL_DECKS
        ):
            return True
    return False
