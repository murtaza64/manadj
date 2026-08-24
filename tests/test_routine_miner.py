"""Routine miner algorithm (ADR 0035, routines 157) over real-shape
event fixtures: audibility reconstruction, practice discrimination
(backseeks in the away-gap, pair-isolated fader drills), and candidate
carving (solo-moment boundaries, cast contiguity, boundary coherence,
chaining). Pure module — no DB.

The fixtures speak the capture event vocabulary (load/transport/control
with capture-clock t), shaped like the corpus the thresholds were
validated on: away-and-return weaves, fader chops, rehearsal re-seeks.
"""

from backend.routine_miner import (
    Interval,
    detect_returns,
    detect_triples,
    mine_session,
    reconstruct_audibility,
)


# --- event builders (capture vocabulary shapes) ---


def load(t, ch, tid):
    return {"t": t, "kind": "load", "channel": ch, "trackId": tid, "bpm": 174}


def play(t, ch, playhead=None):
    return {"t": t, "kind": "transport", "channel": ch, "action": "play", "playhead": playhead}


def pause(t, ch, playhead=None):
    return {"t": t, "kind": "transport", "channel": ch, "action": "pause", "playhead": playhead}


def seek(t, ch, playhead):
    return {"t": t, "kind": "transport", "channel": ch, "action": "seek", "playhead": playhead}


def fader(t, ch, value):
    return {"t": t, "kind": "control", "channel": ch, "control": "fader", "value": value}


def replay(events):
    events = sorted(events, key=lambda e: e["t"])
    return reconstruct_audibility(events)


# The validated full-candidate weave (three tracks, one performance
# return, solo moments on both flanks):
#   T1 on A: 5–40, away, back 55–70 (the seed return)
#   T2 on B: 30–80
#   T3 on C: 72–120
def weave_events(t1, t2, t3, offset=0.0):
    o = offset
    return [
        load(5 + o, "A", t1), play(5 + o, "A"), pause(40 + o, "A"),
        load(30 + o, "B", t2), play(30 + o, "B"), pause(80 + o, "B"),
        play(55 + o, "A"), pause(70 + o, "A"),
        load(72 + o, "C", t3), play(72 + o, "C"), pause(120 + o, "C"),
    ]


# --- audibility reconstruction ---


def test_audibility_basic_interval():
    intervals, _ = replay([load(0, "A", 1), play(0, "A"), pause(30, "A")])
    assert intervals == [Interval(0, 30, "A", 1)]


def test_audibility_drops_sub_second_blips():
    intervals, _ = replay([load(0, "A", 1), play(0, "A"), pause(0.5, "A")])
    assert intervals == []


def test_audibility_fader_chop_merges():
    # A 3s full-kill fader chop (< merge gap) reads as one tenure.
    intervals, _ = replay(
        [
            load(0, "A", 1), play(0, "A"),
            fader(10, "A", 0.0), fader(13, "A", 1.0),
            pause(30, "A"),
        ]
    )
    assert intervals == [Interval(0, 30, "A", 1)]


def test_audibility_long_fader_kill_splits():
    intervals, _ = replay(
        [
            load(0, "A", 1), play(0, "A"),
            fader(10, "A", 0.0), fader(20, "A", 1.0),
            pause(30, "A"),
        ]
    )
    assert intervals == [Interval(0, 10, "A", 1), Interval(20, 30, "A", 1)]


def test_audibility_fader_below_threshold_is_silent():
    intervals, _ = replay(
        [load(0, "A", 1), fader(0, "A", 0.05), play(0, "A"), pause(30, "A")]
    )
    assert intervals == []


def test_audibility_track_swap_splits_interval():
    intervals, _ = replay(
        [load(0, "A", 1), play(0, "A"), load(20, "A", 2), pause(50, "A")]
    )
    assert intervals == [Interval(0, 20, "A", 1), Interval(20, 50, "A", 2)]


def test_audibility_open_interval_closes_at_last_event():
    intervals, _ = replay([load(0, "A", 1), play(0, "A"), fader(25, "B", 1.0)])
    assert intervals == [Interval(0, 25, "A", 1)]


def test_backseek_detected_from_playhead_regression():
    _, backseeks = replay(
        [
            load(0, "A", 1),
            play(0, "A", playhead=0.0),
            pause(40, "A", playhead=40.0),
            seek(45, "A", playhead=10.0),  # rewound 30s while paused
        ]
    )
    assert backseeks == {"A": [45]}


# --- practice discrimination ---


def performance_return_events(t1=1, t2=2, t3=3):
    return weave_events(t1, t2, t3)


def test_performance_return_detected():
    intervals, backseeks = replay(performance_return_events())
    returns = detect_returns(intervals, backseeks)
    assert len(returns) == 1
    r = returns[0]
    assert (r.track_id, r.t, r.gap_start) == (1, 55, 40)
    assert not r.practice


def test_backseek_in_away_gap_flags_practice():
    events = performance_return_events() + [seek(45, "A", playhead=10.0)]
    # give the estimate something to regress from
    events = [
        e if e["t"] != 40 or e.get("action") != "pause" else pause(40, "A", playhead=40.0)
        for e in events
    ]
    intervals, backseeks = replay(events)
    returns = detect_returns(intervals, backseeks)
    assert len(returns) == 1
    assert returns[0].backseeks == 1
    assert returns[0].practice


def test_pair_isolated_alternation_flags_practice():
    # Fader-drill reps: only two tracks trading, both re-entering.
    events = [
        load(0, "A", 1), play(0, "A"), pause(40, "A"),
        load(30, "B", 2), play(30, "B"), pause(52, "B"),
        play(55, "A"), pause(70, "A"),
        play(65, "B"), pause(90, "B"),
    ]
    intervals, backseeks = replay(events)
    returns = detect_returns(intervals, backseeks)
    flagged = [r for r in returns if r.track_id == 1]
    assert len(flagged) == 1
    assert flagged[0].pair_rep
    assert flagged[0].practice


def test_return_needs_company_in_the_gap():
    # Solo away-and-return (nobody else audible) is not a return event.
    events = [
        load(0, "A", 1), play(0, "A"), pause(40, "A"),
        play(55, "A"), pause(70, "A"),
    ]
    intervals, backseeks = replay(events)
    assert detect_returns(intervals, backseeks) == []


def test_long_gap_is_not_a_return():
    events = [
        load(0, "A", 1), play(0, "A"), pause(40, "A"),
        load(30, "B", 2), play(30, "B"), pause(300, "B"),
        play(200, "A"), pause(250, "A"),  # 160s away: a re-play, not a return
    ]
    intervals, backseeks = replay(events)
    assert detect_returns(intervals, backseeks) == []


def test_triples_detected():
    events = [
        load(0, "A", 1), play(0, "A"), pause(60, "A"),
        load(20, "B", 2), play(20, "B"), pause(70, "B"),
        load(40, "C", 3), play(40, "C"), pause(80, "C"),
    ]
    intervals, _ = replay(events)
    triples = detect_triples(intervals)
    assert [(tr.t, tr.end) for tr in triples] == [(40, 60)]


# --- candidate carving ---

ORDERING = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4}


def test_full_candidate_carved():
    result = mine_session(performance_return_events(), [ORDERING])
    assert result.n_returns == 1
    assert result.n_practice_returns == 0
    assert len(result.candidates) == 1
    c = result.candidates[0]
    assert c.cast == [1, 2, 3]  # entry order
    # Window expands into the entry track's tenure, clamped into the
    # bounding solos (5–30 before, 80–120 after, ±3s pad).
    assert (c.window_start_s, c.window_end_s) == (27, 83)
    assert c.entry_offsets == [0, 3, 45]
    assert (c.n_returns, c.n_triples) == (1, 0)


def test_practice_returns_never_seed():
    events = performance_return_events()
    events = [
        e if e["t"] != 40 or e.get("action") != "pause" else pause(40, "A", playhead=40.0)
        for e in events
    ] + [seek(45, "A", playhead=10.0)]
    result = mine_session(events, [ORDERING])
    assert result.n_returns == 1
    assert result.n_practice_returns == 1
    assert result.candidates == []


def test_triples_alone_never_seed():
    # A 20s three-deck stretch with no performance return: decomposable as
    # overlapping windows, not a Routine candidate.
    events = [
        load(0, "A", 1), play(0, "A"), pause(60, "A"),
        load(20, "B", 2), play(20, "B"), pause(70, "B"),
        load(40, "C", 3), play(40, "C"), pause(80, "C"),
    ]
    result = mine_session(events, [ORDERING])
    assert result.candidates == []


def test_cast_must_be_contiguous_in_an_ordering():
    # Ordering has a track between T2 and T3 that never played: the cast
    # skips an entry, so the run is broken.
    gapped = {1: 0, 2: 1, 99: 2, 3: 3}
    result = mine_session(performance_return_events(), [gapped])
    assert result.candidates == []


def test_cast_outside_every_ordering_is_rejected():
    result = mine_session(performance_return_events(), [{7: 0, 8: 1, 9: 2}])
    assert result.candidates == []


def test_second_ordering_can_validate_the_cast():
    gapped = {1: 0, 2: 1, 99: 2, 3: 3}
    result = mine_session(performance_return_events(), [gapped, ORDERING])
    assert len(result.candidates) == 1


def test_boundary_coherence_exit_with_last():
    # T2 (interior position) holds the window's close instead of T3:
    # the span doesn't exit with its last cast track — rejected.
    events = [
        load(5, "A", 1), play(5, "A"), pause(40, "A"),
        load(30, "B", 2), play(30, "B"), pause(130, "B"),
        play(55, "A"), pause(70, "A"),
        load(72, "C", 3), play(72, "C"), pause(90, "C"),
    ]
    result = mine_session(events, [ORDERING])
    assert result.candidates == []


def test_solo_boundary_splits_into_chained_candidates():
    # Two weaves chained through T3: a 40s solo moment (80–120, T3 alone)
    # splits the clusters; T4's away-gap (160–175, also a T3 solo) is
    # interior and must NOT split. Both candidates share boundary track 3.
    events = [
        # weave 1: T1 returns over T2 while T3 enters and holds
        load(5, "A", 1), play(5, "A"), pause(40, "A"),
        load(30, "B", 2), play(30, "B"), pause(80, "B"),
        play(55, "A"), pause(70, "A"),
        load(72, "C", 3), play(72, "C"), pause(205, "C"),
        # weave 2: T4 returns over T3 while T5 enters and holds
        load(120, "D", 4), play(120, "D"), pause(160, "D"),
        play(175, "D"), pause(190, "D"),
        load(180, "B", 5), play(180, "B"), pause(210, "B"),
    ]
    result = mine_session(events, [ORDERING])
    assert len(result.candidates) == 2
    a, b = result.candidates
    assert a.cast == [1, 2, 3]
    assert b.cast == [3, 4, 5]
    assert a.exit_track_id == b.entry_track_id == 3


def test_overlapping_candidates_dedupe_keeps_one():
    # The same trio weaved twice in one Session: overlapping casts
    # conflict (not a boundary chain), so only one suggestion survives.
    events = weave_events(1, 2, 3) + weave_events(1, 2, 3, offset=500.0)
    result = mine_session(events, [ORDERING])
    assert len(result.candidates) == 1


def test_empty_session_mines_nothing():
    result = mine_session([], [ORDERING])
    assert result.candidates == []
    assert result.n_returns == 0
