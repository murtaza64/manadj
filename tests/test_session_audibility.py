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


def test_transport_without_position_still_sets_audibility():
    event = {**play(2.0), "playhead": None}
    assert events_contain_audible([load(1.0), event]) is True


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


def test_audible_cue_stab_preview_keeps_the_session():
    events = [
        load(1.0),
        {"t": 2.0, "kind": "transport", "channel": "A", "action": "previewStart", "playhead": 30.0},
        tick(3.0, {"A": 31.0}),
        {"t": 4.0, "kind": "transport", "channel": "A", "action": "previewEnd", "playhead": 32.0},
    ]
    assert events_contain_audible(events) is True


def test_preview_respects_mixer_gates_and_ends_on_release_or_load():
    preview = {"t": 2.0, "kind": "transport", "channel": "A", "action": "previewStart", "playhead": 30.0}
    for gate in (control(1.5, "fader", 0, "A"), control(1.5, "filter", 1, "A"),
                 control(1.5, "crossfader", 1),
                 {"t": 1.5, "kind": "tenure", "edge": "start", "holder": "editor"}):
        assert not events_contain_audible([load(1), gate, preview, tick(3)])
    muted = [load(1), control(1.5, "fader", 0, "A"), preview]
    assert events_contain_audible(muted + [control(3, "fader", 1, "A")])
    for end in ({**preview, "t": 2.5, "action": "previewEnd"}, load(2.5)):
        assert not events_contain_audible(muted + [end, control(3, "fader", 1, "A")])


def test_pfl_is_invisible():
    events = [load(1.0), control(1.5, "pfl", 1, "A"), control(1.6, "fader", 0.0, "A"), play(2.0)]
    assert events_contain_audible(events) is False


def test_any_of_the_four_decks_counts():
    # D defaults to the right side; crossfader center leaves it at unity.
    assert events_contain_audible([load(1.0, "D", 7), play(2.0, "D")]) is True


def scratch(t, action, drive=0, rate=0):
    return {"t": t, "kind": "transport", "channel": "A", "action": action,
            "playhead": 20, "filter": {"drive": drive, "rate": rate}}


def test_paused_reverse_scratch_is_audible_but_touch_alone_is_not():
    held = [load(0), scratch(1, "scratchBegin")]
    assert not events_contain_audible(held + [tick(2)])
    assert events_contain_audible(held + [scratch(2, "scratchMove", -8, -2)])


def test_scratch_hold_silences_playing_deck_and_filter_settles_before_fader_opens():
    events = [load(0), control(0, "fader", 0, "A"), play(0),
              scratch(1, "scratchBegin"), scratch(1, "scratchMove", -8, -2)]
    assert not events_contain_audible(events + [control(2, "fader", 1, "A")])
    assert events_contain_audible(events + [control(1.02, "fader", 1, "A")])
    assert events_contain_audible(events + [control(2, "fader", 1, "A"), scratch(3, "scratchEnd")])


def test_new_scratch_move_adopts_complete_filter_state():
    events = [load(0), control(0, "fader", 0, "A"), scratch(1, "scratchBegin"),
              scratch(1, "scratchMove", -8, -2), scratch(2, "scratchMove", 0, 0)]
    assert not events_contain_audible(events + [control(2, "fader", 1, "A")])


def test_saturated_scratch_has_no_unbounded_motion_debt():
    events = [load(0), control(0, "fader", 0, "A"), scratch(1, "scratchBegin"),
              scratch(1, "scratchMove", -16, -16)]
    assert events_contain_audible(events + [control(1.02, "fader", 1, "A")])
    assert not events_contain_audible(events + [control(1.1, "fader", 1, "A")])


def test_reversal_seed_retains_velocity_even_when_drive_is_zero():
    held = [load(0), scratch(1, "scratchBegin")]
    assert events_contain_audible(held + [scratch(1.01, "scratchMove", 0, -2)])


def test_outward_edge_scratch_is_silent_but_inward_impulse_activates():
    for position, outward in [(0, -8), (100, 8)]:
        held = [load(0), {**scratch(1, "scratchBegin"), "playhead": position, "trackDuration": 100}]
        move = {**scratch(1, "scratchMove", outward, 0), "playhead": position, "trackDuration": 100}
        assert not events_contain_audible(held + [move, tick(2)])
        inward = {**move, "t": 1.02, "filter": {"drive": -outward, "rate": 0}}
        assert events_contain_audible(held + [move, inward])


def test_reverse_loop_start_is_not_a_track_edge_hold():
    events = [load(0), {"t": 0, "kind": "loop", "channel": "A", "playhead": 0,
                        "region": {"start": 0, "end": 1}},
              {**scratch(1, "scratchBegin"), "playhead": 0, "trackDuration": 100},
              {**scratch(1, "scratchMove", -8, 0), "playhead": 0, "trackDuration": 100}]
    assert events_contain_audible(events)


def test_edge_turning_point_reconstruction_can_sound_after_reversal():
    events = [load(0), control(0, "fader", 0, "A"),
              {**scratch(1, "scratchBegin"), "playhead": 100, "trackDuration": 100},
              {**scratch(1, "scratchMove", -8, 8), "playhead": 100, "trackDuration": 100}]
    assert not events_contain_audible(events + [control(1.004, "fader", 1, "A")])
    assert events_contain_audible(events + [control(1.012, "fader", 1, "A")])


def test_short_edge_return_between_move_and_release_is_audible():
    events = [load(0), {**scratch(1, "scratchBegin"), "playhead": 100, "trackDuration": 100},
              {**scratch(1, "scratchMove", -8, 8), "playhead": 100, "trackDuration": 100}]
    assert not events_contain_audible(events + [scratch(1.004, "scratchEnd")])
    assert events_contain_audible(events + [scratch(1.012, "scratchEnd")])


def test_eof_straddling_loop_does_not_make_an_outward_eof_hold_audible():
    events = [load(0), {"t": 0, "kind": "loop", "channel": "A", "playhead": 100,
                        "region": {"start": 99, "end": 101}},
              {**scratch(1, "scratchBegin"), "playhead": 100, "trackDuration": 100},
              {**scratch(1, "scratchMove", 8, 0), "playhead": 100, "trackDuration": 100}]
    assert not events_contain_audible(events + [tick(2)])


def beat_fx(t, target="A", on=True, selected="echo", depth=0.0, beats=1.0):
    return {"t": t, "kind": "beatFx", "selected": selected, "target": target,
            "on": on, "depth": depth, "beats": beats}


def _crossfaded_out_echo(extra):
    """A plays crossfaded out (never Master-audible) into its channel echo;
    the fader closes, then the crossfader returns at t=2.5."""
    return [
        load(0.0),
        control(0.0, "crossfader", 1.0),
        *extra,
        play(1.0),
        control(2.0, "fader", 0.0, "A"),
        control(2.5, "crossfader", 0.0),
        tick(3.0),
    ]


def test_beat_fx_tail_counts_as_audible():
    """#355: the channel echo is pre-crossfader, so it is fed while A is
    crossfaded out; its tail (5 repeats of a 1-beat echo at 174 BPM, ~1.7 s)
    is still ringing when the crossfader returns."""
    assert events_contain_audible(_crossfaded_out_echo([])) is False
    assert events_contain_audible(_crossfaded_out_echo([beat_fx(0.5)])) is True


def test_beat_fx_tail_expires_and_dry_depth_has_no_tail():
    late = [load(0.0), control(0.0, "crossfader", 1.0), beat_fx(0.5), play(1.0),
            control(2.0, "fader", 0.0, "A"), control(9.0, "crossfader", 0.0), tick(10.0)]
    assert events_contain_audible(late) is False
    assert events_contain_audible(_crossfaded_out_echo([beat_fx(0.5, depth=-1.0)])) is False
    assert events_contain_audible(_crossfaded_out_echo([beat_fx(0.5, selected="flanger")])) is False
