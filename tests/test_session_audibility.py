"""Session silence evaluation (sessions 11): the Python port of the one
audibility definition (frontend/src/capture/audibility.ts) replayed over a
persisted event stream.

These pin the evaluator against the same scenarios that lock the frontend
seam (audibility.test.ts), so the two implementations cannot drift silently:
a Session row survives only if some instant of its stream had at least one
Master-audible Deck.
"""

from backend.session_audibility import events_contain_audible


def control(t, control_id, value, channel=None):
    return {"t": t, "kind": "control", "control": control_id, "channel": channel, "value": value}


def play(t, channel="A"):
    return {"t": t, "kind": "transport", "channel": channel, "action": "play", "playhead": 0.0}


def pause(t, channel="A"):
    return {"t": t, "kind": "transport", "channel": channel, "action": "pause", "playhead": 0.0}


def load(t, channel="A", track_id=1):
    return {"t": t, "kind": "load", "channel": channel, "trackId": track_id, "bpm": 174}


def tick(t, playheads=None):
    return {"t": t, "kind": "tick", "playheads": playheads or {}}


def test_empty_stream_is_silent():
    assert events_contain_audible([]) is False


def test_setup_only_stream_is_silent():
    """Loads, cue prep, control setup, tenure markers, ticks: no row-worthy
    instant (the sessions-11 activation rule, checked backend-side)."""
    events = [
        load(1.0),
        control(2.0, "fader", 0.8, "A"),
        control(2.5, "trim", 0.6, "A"),
        {"t": 3.0, "kind": "transport", "channel": "A", "action": "seek", "playhead": 30.0},
        {"t": 4.0, "kind": "tenure", "edge": "start", "holder": "editor"},
        {"t": 9.0, "kind": "tenure", "edge": "end", "holder": "shared"},
        tick(10.0),
    ]
    assert events_contain_audible(events) is False


def test_playing_flat_deck_is_audible():
    # Mixer defaults: fader 1, trim 0.5, EQ flat, crossfader center.
    assert events_contain_audible([load(1.0), play(2.0)]) is True


def test_playing_into_closed_fader_is_silent_until_it_opens():
    silent = [load(1.0), control(1.5, "fader", 0.0, "A"), play(2.0), tick(3.0)]
    assert events_contain_audible(silent) is False
    assert events_contain_audible(silent + [control(4.0, "fader", 1.0, "A")]) is True


def test_pause_after_audible_still_counts():
    """One audible instant anywhere keeps the Session (100%-silent is the
    deletion bar, not mostly-silent)."""
    assert events_contain_audible([load(1.0), play(2.0), pause(3.0), tick(600.0)]) is True


def test_eq_full_kill_is_silent_but_single_band_is_not():
    killed = [
        load(1.0),
        control(1.1, "eqLow", 0.0, "A"),
        control(1.2, "eqMid", 0.0, "A"),
        control(1.3, "eqHigh", 0.0, "A"),
        play(2.0),
    ]
    assert events_contain_audible(killed) is False
    one_band_up = killed + [control(3.0, "eqHigh", 0.5, "A")]
    assert events_contain_audible(one_band_up) is True


def test_filter_kill_is_silent():
    events = [load(1.0), control(1.5, "filter", 1.0, "A"), play(2.0)]
    assert events_contain_audible(events) is False
    assert events_contain_audible(events + [control(3.0, "filter", 0.0, "A")]) is True


def test_crossfader_silences_the_far_side():
    # A defaults to the left side; crossfader hard right kills it.
    events = [load(1.0), control(1.5, "crossfader", 1.0), play(2.0)]
    assert events_contain_audible(events) is False
    # B (right side) under the same crossfader is audible.
    assert events_contain_audible([load(1.0, "B"), control(1.5, "crossfader", 1.0), play(2.0, "B")]) is True


def test_thru_assignment_bypasses_the_crossfader():
    events = [
        load(1.0),
        control(1.2, "crossfaderAssignment", 0, "A"),  # thru
        control(1.5, "crossfader", 1.0),
        play(2.0),
    ]
    assert events_contain_audible(events) is True


def test_crossfader_disabled_reads_as_center():
    events = [
        load(1.0),
        control(1.2, "crossfaderEnabled", 0),
        control(1.5, "crossfader", 1.0),  # hard right, but disabled
        play(2.0),
    ]
    assert events_contain_audible(events) is True


def test_cue_stab_preview_is_invisible():
    """The audibility definition ignores preview (phase-1 boundary) — a
    stab-only stream is silent, exactly as the frontend detector sees it."""
    events = [
        load(1.0),
        {"t": 2.0, "kind": "transport", "channel": "A", "action": "previewStart", "playhead": 30.0},
        tick(3.0, {"A": 31.0}),
        {"t": 4.0, "kind": "transport", "channel": "A", "action": "previewEnd", "playhead": 32.0},
    ]
    assert events_contain_audible(events) is False


def test_pfl_is_invisible():
    events = [load(1.0), control(1.5, "pfl", 1, "A"), control(1.6, "fader", 0.0, "A"), play(2.0)]
    assert events_contain_audible(events) is False


def test_any_of_the_four_decks_counts():
    # D defaults to the right side; crossfader center leaves it at unity.
    assert events_contain_audible([load(1.0, "D", 7), play(2.0, "D")]) is True
