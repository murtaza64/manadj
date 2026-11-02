"""Bounded existing capture-event objects; rewrite only declared Track reference sites."""
import copy
import math

FIELDS = {
    "load": {"t", "kind", "channel", "trackId", "bpm"},
    "control": {"t", "kind", "channel", "control", "value"},
    "transport": {"t", "kind", "channel", "action", "playhead", "detail", "deltaSeconds",
                  "durationSeconds", "filter", "trackDuration", "audioTime"},
    "pitch": {"t", "kind", "channel", "value"},
    "bend": {"t", "kind", "channel", "value"},
    "loop": {"t", "kind", "channel", "playhead", "region", "slip"},
    "tick": {"t", "kind", "playheads"},
    "tenure": {"t", "kind", "edge", "holder"},
    "beatFx": {"t", "kind", "selected", "target", "on", "depth", "beats", "held"},
    "beatFxSettings": {"t", "kind", "settings"},
    "init": {"t", "kind", "outgoingChannel", "decks", "crossfader", "crossfaderEnabled", "physicalDecks", "beatFx"},
}
DECKS = {"A", "B", "C", "D"}
CONTROLS = {"trim", "eqLow", "eqMid", "eqHigh", "filter", "fader", "pfl", "slipMode", "vinylMode",
            "crossfaderAssignment", "crossfader", "crossfaderEnabled", "master",
            "stemVocals", "stemDrums", "stemBass", "stemOther"}
ACTIONS = {"play", "pause", "seek", "jumpBeats", "hotCue", "cue", "previewStart", "previewEnd",
           "scratchBegin", "scratchMove", "scratchEnd"}
FX = {"echo", "lowCutEcho", "reverb", "flanger", "trans", "roll", None}
FX_SETTINGS = {"echoFeedback", "echoSaturation", "reverbDecay", "reverbDampingHz", "reverbStereoWidth",
               "flangerDelayMs", "flangerWidthMs", "flangerFeedback", "lowCutEchoHz", "transDuty", "transSlopeMs", "rollFadeMs"}


def number(value):
    return type(value) in (int, float) and abs(value) <= 1e12 and math.isfinite(value)


def fx_shape(value):
    return (isinstance(value, dict) and set(value) <= FIELDS["beatFx"] and {"selected", "target", "on", "depth", "beats"} <= value.keys()
            and value["selected"] in FX and value["target"] in DECKS | {"master", "sampler"}
            and type(value["on"]) is bool and number(value["depth"]) and number(value["beats"])
            and ("held" not in value or isinstance(value["held"], list) and all(deck in DECKS for deck in value["held"])))


def _bounded(value, path=(), depth=0):
    if depth > 12:
        raise ValueError("Event nesting too deep")
    if isinstance(value, dict):
        if len(value) > 64:
            raise ValueError("Event object too large")
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > 64:
                raise ValueError("Invalid event field")
            if key == "trackId":
                yield path + (key,)
            yield from _bounded(child, path + (key,), depth + 1)
    elif isinstance(value, list):
        if len(value) > 128:
            raise ValueError("Nested event array too large")
        for index, child in enumerate(value):
            yield from _bounded(child, path + (index,), depth + 1)
    elif isinstance(value, str):
        if len(value) > 2048:
            raise ValueError("Event text too large")
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        if abs(value) > 9007199254740991 or not math.isfinite(value):
            raise ValueError("Finite event numbers required")
    elif value is not None and not isinstance(value, bool):
        raise ValueError("JSON event values required")


def track_sites(event):
    kind = event.get("kind")
    allowed = {("trackId",)} if kind == "load" else {
        ("decks", "A", "trackId"), ("decks", "B", "trackId")
    } if kind == "init" else set()
    found = set(_bounded(event))
    if found != allowed:
        raise ValueError("Unknown or missing Track reference site")
    return sorted(found)


def at(event, path):
    value = event
    for key in path:
        value = value[key]
    return value


def validate_events(events):
    previous = -1
    for event in events:
        if not isinstance(event, dict) or event.get("kind") not in FIELDS or not set(event) <= FIELDS[event["kind"]]:
            raise ValueError("Unsupported capture event grammar")
        t = event.get("t")
        if type(t) not in (int, float) or not 0 <= t <= 1e9 or not math.isfinite(t) or t < previous:
            raise ValueError("Ordered finite capture times required")
        previous = t
        kind = event["kind"]
        if kind in {"load", "transport", "pitch", "bend", "loop"} and event.get("channel") not in DECKS:
            raise ValueError("Invalid capture Deck")
        if kind == "control" and event.get("channel") not in DECKS | {None}:
            raise ValueError("Invalid control Deck")
        valid = True
        if kind == "load":
            valid = "bpm" in event and (event["bpm"] is None or number(event["bpm"]))
        elif kind == "control":
            valid = event.get("control") in CONTROLS and "channel" in event and number(event.get("value"))
        elif kind in {"pitch", "bend"}:
            valid = number(event.get("value"))
        elif kind == "transport":
            valid = event.get("action") in ACTIONS and number(event.get("playhead"))
            valid &= all(number(event[key]) for key in ("detail", "deltaSeconds", "durationSeconds", "trackDuration", "audioTime") if key in event)
            if "filter" in event:
                valid &= (isinstance(event["filter"], dict) and set(event["filter"]) == {"drive", "rate"}
                          and all(number(value) for value in event["filter"].values()))
        elif kind == "loop":
            valid = number(event.get("playhead")) and "region" in event
            region = event.get("region")
            if region is not None:
                valid &= (isinstance(region, dict) and set(region) == {"start", "end"}
                          and all(number(value) for value in region.values()) and region["start"] < region["end"])
            valid &= "slip" not in event or type(event["slip"]) is bool
        elif kind == "tick":
            valid = isinstance(event.get("playheads"), dict) and set(event["playheads"]) <= DECKS and all(number(v) for v in event["playheads"].values())
        elif kind == "tenure":
            valid = event.get("edge") in {"start", "end"} and isinstance(event.get("holder"), str)
        elif kind == "beatFx":
            valid = fx_shape(event)
        elif kind == "beatFxSettings":
            settings = event.get("settings")
            valid = (isinstance(settings, dict) and set(settings) <= FX_SETTINGS | {"flangerLengthUnit"}
                     and all(number(value) for key, value in settings.items() if key != "flangerLengthUnit")
                     and ("flangerLengthUnit" not in settings or settings["flangerLengthUnit"] in {"bars", "beats"}))
        elif kind == "init":
            decks = event.get("decks")
            valid = (isinstance(decks, dict) and set(decks) == {"A", "B"} and event.get("outgoingChannel") in {"A", "B"}
                     and number(event.get("crossfader")) and type(event.get("crossfaderEnabled")) is bool)
            valid &= "beatFx" not in event or fx_shape(event["beatFx"])
            if valid:
                for deck in decks.values():
                    valid &= (isinstance(deck, dict) and type(deck.get("playing")) is bool
                              and set(deck) <= {"trackId", "playing", "scratching", "slipLoopActive", "fader", "trim", "eq", "filter", "pitch", "assignment", "stems"}
                              and all(number(deck.get(key)) for key in ("fader", "trim", "filter", "pitch"))
                              and isinstance(deck.get("eq"), dict) and set(deck["eq"]) == {"low", "mid", "high"}
                              and all(number(value) for value in deck["eq"].values()))
                    if isinstance(deck, dict):
                        valid &= all(type(deck[key]) is bool for key in ("scratching", "slipLoopActive") if key in deck)
                        valid &= "assignment" not in deck or deck["assignment"] in {"left", "thru", "right"}
                        if "stems" in deck:
                            valid &= (isinstance(deck["stems"], dict) and set(deck["stems"]) == {"vocals", "drums", "bass", "other"}
                                      and all(type(value) is bool for value in deck["stems"].values()))
            if "physicalDecks" in event:
                physical = event["physicalDecks"]
                valid &= (isinstance(physical, dict) and set(physical) == {"outgoing", "incoming"}
                          and all(value in DECKS for value in physical.values()))
        if not valid:
            raise ValueError("Malformed capture event")
        for path in track_sites(event):
            value = at(event, path)
            if value is not None and (type(value) is not int or not 0 < value <= 9007199254740991):
                raise ValueError("Integer source-local Track reference required")
    return events


def reference_ids(events):
    return {at(event, path) for event in events for path in track_sites(event) if at(event, path) is not None}


def remap(events, mapping):
    result = copy.deepcopy(events)
    for event in result:
        for path in track_sites(event):
            parent = event
            for key in path[:-1]:
                parent = parent[key]
            if parent[path[-1]] is not None:
                parent[path[-1]] = mapping[parent[path[-1]]]
    return result
