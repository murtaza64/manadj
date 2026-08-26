"""Mechanical Routine promotion (ADR 0035, routines 158): deck→slot
re-addressing and the beat-domain clock rebase, over synthetic capture
events. Pure module — no DB.

The canonical fixture: a 3-track weave at constant 120 BPM (2 beats/s),
window 0..60 —
  slot 0 = track 1 on deck A, playing 0..30 (entry offset 0)
  slot 1 = track 2 on deck B, playing 10..45 (entry offset 10)
  slot 2 = track 3 on deck C, playing 30..60 (entry offset 30)
so the anchor chain is A(0..30) → B(30..45) → C(45..60) and the Routine
clock runs at exactly 2 beats/s throughout: entry offsets [0, 20, 60]
beats, duration 120 beats.
"""

import pytest

from backend.beatgrid_utils import constant_tempo_changes
from backend.routine_promotion import (
    PromotionError,
    build_beat_clock,
    grid_beats_at,
    map_slots,
    promote,
)

CAST = [1, 2, 3]
WINDOW = (0.0, 60.0)
OFFSETS = [0.0, 10.0, 30.0]
GRIDS = {tid: constant_tempo_changes(120.0) for tid in CAST}


def load(t, ch, tid):
    return {"t": t, "kind": "load", "channel": ch, "trackId": tid, "bpm": 120}


def play(t, ch, playhead=0.0):
    return {"t": t, "kind": "transport", "channel": ch, "action": "play", "playhead": playhead}


def pause(t, ch, playhead=None):
    return {"t": t, "kind": "transport", "channel": ch, "action": "pause", "playhead": playhead}


def fader(t, ch, value):
    return {"t": t, "kind": "control", "channel": ch, "control": "fader", "value": value}


def tick(t, playheads):
    return {"t": t, "kind": "tick", "playheads": playheads}


def ticks(t0, t1, deck, pos0, rate=1.0, step=5.0):
    out = []
    t = t0
    while t <= t1:
        out.append(tick(t, {deck: pos0 + (t - t0) * rate}))
        t += step
    return out


def weave_events():
    return sorted(
        [
            load(0, "A", 1),
            play(0, "A"),
            pause(30, "A", playhead=30.0),
            load(5, "B", 2),
            play(10, "B"),
            pause(45, "B", playhead=35.0),
            load(25, "C", 3),
            play(30, "C"),
            pause(60, "C", playhead=30.0),
            *ticks(0, 29, "A", 0.0),
            *ticks(10, 44, "B", 0.0),
            *ticks(30, 59, "C", 0.0),
        ],
        key=lambda e: e["t"],
    )


def test_grid_beats_constant():
    grid = constant_tempo_changes(120.0)
    assert grid_beats_at(grid, 0.0) == 0.0
    assert grid_beats_at(grid, 30.0) == pytest.approx(60.0)


def test_grid_beats_variable():
    grid = [
        {"start_time": 0.0, "bpm": 120.0, "time_signature_num": 4, "time_signature_den": 4, "bar_position": 1},
        {"start_time": 10.0, "bpm": 60.0, "time_signature_num": 4, "time_signature_den": 4, "bar_position": 1},
    ]
    assert grid_beats_at(grid, 10.0) == pytest.approx(20.0)
    assert grid_beats_at(grid, 20.0) == pytest.approx(30.0)


def test_map_slots_resolves_decks():
    res = map_slots(weave_events(), CAST, *WINDOW, OFFSETS)
    assert [(r.slot, r.track_id, r.deck) for r in res] == [(0, 1, "A"), (1, 2, "B"), (2, 3, "C")]
    # Residency widens to the load (deck C loads at 25, enters at 30).
    assert res[2].start == pytest.approx(25.0)


def test_map_slots_missing_track_raises():
    events = [e for e in weave_events() if not (e.get("channel") == "C" or "C" in (e.get("playheads") or {}))]
    with pytest.raises(PromotionError, match="slot 2"):
        map_slots(events, CAST, *WINDOW, OFFSETS)


def test_beat_clock_constant_rate():
    events = weave_events()
    res = map_slots(events, CAST, *WINDOW, OFFSETS)
    beat_at = build_beat_clock(events, res, GRIDS, *WINDOW)
    assert beat_at(0.0) == pytest.approx(0.0)
    assert beat_at(10.0) == pytest.approx(20.0, abs=0.5)
    assert beat_at(30.0) == pytest.approx(60.0, abs=1.0)
    assert beat_at(45.0) == pytest.approx(90.0, abs=1.5)
    assert beat_at(60.0) == pytest.approx(120.0, abs=2.0)


def test_beat_clock_bridges_anchor_seek():
    # A jump on the anchor deck (A: playhead 15 → 45 at t=15) must NOT jump
    # the Routine clock — the discontinuity bridges at the last beat rate.
    events = [e for e in weave_events() if not (e["kind"] == "tick" and "A" in e["playheads"])]
    events += ticks(0, 14, "A", 0.0)
    events += ticks(15, 29, "A", 45.0)
    events.sort(key=lambda e: e["t"])
    res = map_slots(events, CAST, *WINDOW, OFFSETS)
    beat_at = build_beat_clock(events, res, GRIDS, *WINDOW)
    assert beat_at(30.0) == pytest.approx(60.0, abs=1.5)


def test_beat_clock_respects_pitch():
    # Anchor rolling at 1.25× track rate → 2.5 Routine beats per wall second.
    events = [e for e in weave_events() if not (e["kind"] == "tick" and "A" in e["playheads"])]
    events += ticks(0, 29, "A", 0.0, rate=1.25)
    events.sort(key=lambda e: e["t"])
    res = map_slots(events, CAST, *WINDOW, OFFSETS)
    beat_at = build_beat_clock(events, res, GRIDS, *WINDOW)
    assert beat_at(20.0) == pytest.approx(50.0, abs=1.0)


def test_promote_slot_addresses_and_rebases():
    result = promote(weave_events(), CAST, *WINDOW, OFFSETS, GRIDS)
    assert result.cast == CAST
    assert result.entry_offsets_beats[0] == pytest.approx(0.0)
    assert result.entry_offsets_beats[1] == pytest.approx(20.0, abs=0.5)
    assert result.entry_offsets_beats[2] == pytest.approx(60.0, abs=1.0)
    assert result.duration_beats == pytest.approx(120.0, abs=2.0)
    # Slot 0 entered at track position 0; others at 0 too (played from 0).
    assert result.entry_positions == pytest.approx([0.0, 0.0, 0.0], abs=0.5)
    # Every event is beat-stamped and slot-addressed; no deck letters remain.
    assert all("beat" in e and "t" not in e and "channel" not in e for e in result.events)
    plays = [e for e in result.events if e["kind"] == "transport" and e["action"] == "play"]
    assert [e["slot"] for e in plays] == [0, 1, 2]
    assert plays[1]["beat"] == pytest.approx(20.0, abs=0.5)
    # Ticks remap their playhead keys to slot strings.
    some_tick = next(e for e in result.events if e["kind"] == "tick")
    assert set(some_tick["playheads"]) <= {"0", "1", "2"}


def test_promote_drops_out_of_cast_deck():
    events = weave_events() + [load(2, "D", 99), play(3, "D"), fader(4, "D", 0.5)]
    result = promote(sorted(events, key=lambda e: e["t"]), CAST, *WINDOW, OFFSETS, GRIDS)
    assert result.dropped_events >= 3
    assert all(e.get("slot") in (0, 1, 2, None) for e in result.events)


def test_promote_keeps_global_controls():
    events = weave_events() + [
        {"t": 20.0, "kind": "control", "control": "crossfader", "channel": None, "value": 0.5}
    ]
    result = promote(sorted(events, key=lambda e: e["t"]), CAST, *WINDOW, OFFSETS, GRIDS)
    xf = next(e for e in result.events if e.get("control") == "crossfader")
    assert xf["slot"] is None
    assert xf["beat"] == pytest.approx(40.0, abs=1.0)


def test_promote_rejects_two_cast():
    with pytest.raises(PromotionError, match="n ≥ 3"):
        promote(weave_events(), [1, 2], *WINDOW, [0.0, 10.0], GRIDS)


def test_promote_requires_grids():
    with pytest.raises(PromotionError, match="missing beatgrid"):
        promote(weave_events(), CAST, *WINDOW, OFFSETS, {1: GRIDS[1]})
