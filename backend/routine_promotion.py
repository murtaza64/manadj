"""Mechanical Routine promotion (ADR 0035, routines 158).

Turns a Routine Take (deck-literal span of a Session's event log) into a
saved Routine: **re-address** each event's physical Deck to its cast slot
(entry-ordered positional roles), and **rebase** the clock from capture
seconds to beats via the cast Tracks' Beatgrids. Mechanical, not
idealizing — the output is the raw recording in slot/beat coordinates
(gesture-level lane vectorization waits for the Routine editor).

The beat clock is an anchor chain: the earliest-entered slot still
audible carries the clock; when it exits, the next entered slot takes
over (weaves are beatmatched, so the chain is continuous). Within an
anchor's coverage, beats accumulate as BEATGRID deltas over the deck's
playhead trace (grid-derived, so pitch is accounted for automatically);
playhead discontinuities (seeks, jumps, pauses) are bridged with wall
clock at the last observed beat rate — a jump on the anchor deck must
not jump the Routine clock.

Pure algorithm — no DB access. The router feeds it the Session's events,
the take's cast/window/offsets, and per-track tempo_changes.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from typing import Any, Sequence

from backend.routine_miner import Interval, reconstruct_audibility

# A continuous-playback sample pair must advance the playhead at a rate
# within this band of wall clock (pitch range + slop); anything outside is
# a discontinuity (seek/jump/pause) and is bridged, not integrated.
RATE_MIN = 0.5
RATE_MAX = 2.0
# Fallback beat rate when no continuous stretch was observed yet (2 Hz =
# 120 BPM); replaced by the first grid-derived observation.
DEFAULT_BPS = 2.0


class PromotionError(ValueError):
    """The take's slice cannot be mechanically promoted (missing slot
    audibility, empty window...). The router maps this to a 422."""


@dataclass
class SlotResidency:
    """One slot's physical residency: the deck it played on and the loaded
    stretch (capture-clock seconds) it occupied that deck."""

    slot: int
    track_id: int
    deck: str
    start: float  # residency start (load or window edge)
    end: float
    audible_start: float  # the matched audibility onset (≈ entry)
    audible_end: float


@dataclass
class PromotedRoutine:
    cast: list[int]
    entry_offsets_beats: list[float]
    entry_positions: list[float]  # track-seconds at each slot's entry
    duration_beats: float
    events: list[dict[str, Any]]  # slot-addressed, beat-domain
    residencies: list[SlotResidency] = field(default_factory=list)
    dropped_events: int = 0  # deck activity outside the cast
    # The capture-clock window promoted over — persisted on the Routine
    # so a later retrim measures against the CURRENT bounds (gh#190).
    window_start_s: float = 0.0
    window_end_s: float = 0.0


# ── beatgrid helpers ─────────────────────────────────────────────────────


def grid_beats_at(tempo_changes: Sequence[dict[str, Any]], pos: float) -> float:
    """Continuous beat count at track position `pos` (seconds), walking
    tempo segments (interval = 60/bpm from each start_time)."""
    if not tempo_changes:
        return pos * DEFAULT_BPS
    beats = 0.0
    for i, tc in enumerate(tempo_changes):
        start = tc["start_time"]
        nxt = tempo_changes[i + 1]["start_time"] if i + 1 < len(tempo_changes) else None
        if pos <= start:
            if i == 0:
                # Before the first segment: extrapolate backward.
                return (pos - start) * tc["bpm"] / 60.0
            return beats
        seg_end = nxt if nxt is not None and nxt < pos else pos
        beats += (seg_end - start) * tc["bpm"] / 60.0
        if nxt is None or pos <= nxt:
            return beats
    return beats


# ── playhead traces ──────────────────────────────────────────────────────


def deck_playhead_samples(
    events: Sequence[dict[str, Any]],
) -> dict[str, list[tuple[float, float]]]:
    """Per-deck (t, playhead) samples from every event that carries a
    position: transport, loop, tick, load (position 0). Sorted by t."""
    out: dict[str, list[tuple[float, float]]] = {}
    for e in events:
        t = float(e.get("t", 0))
        kind = e.get("kind")
        if kind in ("transport", "loop") and e.get("channel"):
            ph = e.get("playhead")
            if ph is not None:
                out.setdefault(e["channel"], []).append((t, float(ph)))
        elif kind == "load" and e.get("channel"):
            out.setdefault(e["channel"], []).append((t, 0.0))
        elif kind == "tick":
            for ch, ph in (e.get("playheads") or {}).items():
                out.setdefault(ch, []).append((t, float(ph)))
    for samples in out.values():
        samples.sort(key=lambda s: s[0])
    return out


def playhead_at(samples: Sequence[tuple[float, float]], t: float) -> float:
    """Track position at capture time t, interpolated between surrounding
    samples when the stretch is continuous, else held at the neighbor."""
    if not samples:
        return 0.0
    ts = [s[0] for s in samples]
    i = bisect_right(ts, t)
    if i == 0:
        return samples[0][1]
    if i >= len(samples):
        t0, p0 = samples[-1]
        return p0 + (t - t0)  # assume rolling at ~1× past the last sample
    t0, p0 = samples[i - 1]
    t1, p1 = samples[i]
    if t1 <= t0:
        return p1
    rate = (p1 - p0) / (t1 - t0)
    if RATE_MIN <= rate <= RATE_MAX:
        return p0 + (t - t0) * rate
    return p0  # discontinuity: hold the earlier position


# ── deck → slot mapping ──────────────────────────────────────────────────


def _load_periods(events: Sequence[dict[str, Any]]) -> dict[str, list[tuple[float, float, int]]]:
    """Per-deck loaded periods (start, end, track_id) from load events."""
    out: dict[str, list[tuple[float, float, int]]] = {}
    current: dict[str, tuple[float, int]] = {}
    last_t = 0.0
    for e in events:
        t = float(e.get("t", 0))
        last_t = max(last_t, t)
        if e.get("kind") != "load":
            continue
        ch = e.get("channel")
        if not ch:
            continue
        if ch in current:
            st, tid = current.pop(ch)
            out.setdefault(ch, []).append((st, t, tid))
        if e.get("trackId") is not None:
            current[ch] = (t, int(e["trackId"]))
    for ch, (st, tid) in current.items():
        out.setdefault(ch, []).append((st, last_t + 1.0, tid))
    return out


def map_slots(
    events: Sequence[dict[str, Any]],
    cast: Sequence[int],
    window_start_s: float,
    window_end_s: float,
    entry_offsets: Sequence[float],
) -> list[SlotResidency]:
    """Resolve each cast slot to the physical deck that hosted it.

    Slot i's entry instant is window_start + offset[i]; its deck is the
    audibility interval (miner's reconstruction — the same lens that
    produced the offsets) of track cast[i] whose onset is nearest the
    entry. Residency then widens to the deck's loaded period (fader
    riding before the entry is part of the choreography), clipped to the
    window. Self-doubles resolve naturally: two slots, same track,
    nearest-onset matching separates the decks.
    """
    intervals, _ = reconstruct_audibility(sorted(events, key=lambda e: e.get("t", 0)))
    loads = _load_periods(sorted(events, key=lambda e: e.get("t", 0)))

    residencies: list[SlotResidency] = []
    claimed: set[tuple[str, float]] = set()  # (deck, interval start)
    for slot, tid in enumerate(cast):
        entry_t = window_start_s + entry_offsets[slot]
        options = [
            iv
            for iv in intervals
            if iv.track_id == tid
            and iv.start < window_end_s
            and iv.end > window_start_s
            and (iv.channel, iv.start) not in claimed
        ]
        if not options:
            raise PromotionError(
                f"slot {slot} (track {tid}) has no audibility in the window — "
                "cannot resolve its deck"
            )
        best: Interval = min(options, key=lambda iv: abs(iv.start - entry_t))
        claimed.add((best.channel, best.start))
        # Widen to the loaded period containing the audibility onset.
        res_start, res_end = best.start, best.end
        for st, en, ltid in loads.get(best.channel, []):
            if ltid == tid and st <= best.start < en:
                res_start, res_end = st, en
                break
        residencies.append(
            SlotResidency(
                slot=slot,
                track_id=tid,
                deck=best.channel,
                start=max(res_start, window_start_s),
                end=min(res_end, window_end_s),
                audible_start=max(best.start, window_start_s),
                audible_end=min(best.end, window_end_s),
            )
        )
    return residencies


def _slot_at(residencies: Sequence[SlotResidency], deck: str, t: float) -> int | None:
    """The slot occupying `deck` at capture time t (None = out of cast)."""
    best: SlotResidency | None = None
    for r in residencies:
        if r.deck != deck:
            continue
        if r.start <= t <= r.end:
            # Later-entering slot wins a (rare) overlap on the same deck.
            if best is None or r.start > best.start:
                best = r
    if best is not None:
        return best.slot
    # Slight tolerance: events a hair outside the residency (e.g. the
    # closing fader gesture) still belong to the nearest residency.
    near = [
        (min(abs(t - r.start), abs(t - r.end)), r)
        for r in residencies
        if r.deck == deck
    ]
    if near:
        d, r = min(near, key=lambda x: x[0])
        if d <= 5.0:
            return r.slot
    return None


# ── beat clock ───────────────────────────────────────────────────────────


def build_beat_clock(
    events: Sequence[dict[str, Any]],
    residencies: Sequence[SlotResidency],
    grids: dict[int, list[dict[str, Any]]],
    window_start_s: float,
    window_end_s: float,
):
    """A monotone capture-seconds → Routine-beats mapping over the window.

    Anchor chain: slot 0 carries the clock from window start; when the
    anchor's audibility ends, the next entered slot takes over. Within an
    anchor's stretch, beats accumulate as beatgrid deltas over continuous
    playhead motion; discontinuities bridge at the last observed beat
    rate. Returns beat_at(t).
    """
    samples = deck_playhead_samples(events)

    # Anchor chain over the window.
    chain: list[tuple[float, float, SlotResidency]] = []
    ordered = sorted(residencies, key=lambda r: r.audible_start)
    cursor = window_start_s
    for i, r in enumerate(ordered):
        end = min(r.audible_end, window_end_s)
        if end <= cursor:
            continue
        nxt = ordered[i + 1] if i + 1 < len(ordered) else None
        if nxt is None:
            end = window_end_s  # the exit slot holds the clock to the edge
        if end > cursor:
            chain.append((cursor, end, r))
            cursor = end
        if cursor >= window_end_s:
            break
    if not chain:
        raise PromotionError("empty anchor chain — no cast audibility in the window")
    if cursor < window_end_s:
        last = chain[-1]
        chain[-1] = (last[0], window_end_s, last[2])

    # Accumulate clock points (t, beat).
    pts: list[tuple[float, float]] = [(window_start_s, 0.0)]
    beat = 0.0
    last_bps = DEFAULT_BPS
    for seg_start, seg_end, r in chain:
        grid = grids.get(r.track_id, [])
        deck_samples = samples.get(r.deck, [])
        inner = [s for s in deck_samples if seg_start < s[0] < seg_end]
        walk = (
            [(seg_start, playhead_at(deck_samples, seg_start))]
            + inner
            + [(seg_end, playhead_at(deck_samples, seg_end))]
        )
        for (t0, p0), (t1, p1) in zip(walk, walk[1:]):
            dt = t1 - t0
            if dt <= 0:
                continue
            rate = (p1 - p0) / dt
            if RATE_MIN <= rate <= RATE_MAX:
                db = grid_beats_at(grid, p1) - grid_beats_at(grid, p0)
                if db > 0:
                    last_bps = db / dt
                    beat += db
                else:
                    beat += dt * last_bps
            else:
                beat += dt * last_bps  # bridge the discontinuity
            pts.append((t1, beat))

    ts = [p[0] for p in pts]

    def beat_at(t: float) -> float:
        t = min(max(t, window_start_s), window_end_s)
        i = bisect_right(ts, t)
        if i == 0:
            return 0.0
        if i >= len(pts):
            return pts[-1][1]
        t0, b0 = pts[i - 1]
        t1, b1 = pts[i]
        if t1 <= t0:
            return b1
        return b0 + (t - t0) * (b1 - b0) / (t1 - t0)

    return beat_at


# ── event re-addressing ─────────────────────────────────────────────────


def _readdress_event(
    e: dict[str, Any],
    residencies: Sequence[SlotResidency],
    beat_at,
) -> dict[str, Any] | None:
    """One event, deck → slot and t → beat. None = dropped (out of cast)."""
    t = float(e.get("t", 0))
    out = {k: v for k, v in e.items() if k not in ("t", "channel", "playheads")}
    out["beat"] = round(beat_at(t), 6)
    kind = e.get("kind")
    if kind == "tick":
        mapped: dict[str, float] = {}
        for deck, ph in (e.get("playheads") or {}).items():
            slot = _slot_at(residencies, deck, t)
            if slot is not None:
                mapped[str(slot)] = ph
        if not mapped:
            return None
        out["playheads"] = mapped
        return out
    ch = e.get("channel")
    if ch is None:
        out["slot"] = None  # global control (crossfader, master, ...)
        return out
    slot = _slot_at(residencies, ch, t)
    if slot is None:
        return None
    out["slot"] = slot
    return out


# ── control-state seeding ───────────────────────────────────────────────

_LANE_CONTROLS = ("fader", "trim", "eqLow", "eqMid", "eqHigh", "filter")


def _deck_state_at(
    events: Sequence[dict[str, Any]], deck: str, t_seed: float
) -> dict[str, float]:
    """The deck's mixer-control values at `t_seed` (#221 bug report:
    lanes showed DEFAULTS until the first in-window movement — a bass
    killed since before the window read as flat 0.5 and then "jumped").
    The capture knows the truth: the init event's per-deck snapshot,
    overridden by every control event up to the seed instant."""
    state: dict[str, Any] = {}
    for e in events:  # caller pre-sorts by t
        if float(e.get("t", 0)) > t_seed:
            break
        kind = e.get("kind")
        if kind == "init":
            d = (e.get("decks") or {}).get(deck)
            if d:
                eq = d.get("eq") or {}
                state = {
                    "fader": d.get("fader"),
                    "trim": d.get("trim"),
                    "eqLow": eq.get("low"),
                    "eqMid": eq.get("mid"),
                    "eqHigh": eq.get("high"),
                    "filter": d.get("filter"),
                }
        elif kind == "control" and e.get("channel") == deck:
            c = e.get("control")
            if c in _LANE_CONTROLS:
                state[c] = e.get("value")
    return {
        c: float(v) for c, v in state.items() if isinstance(v, (int, float)) and c in _LANE_CONTROLS
    }


# ── the whole promotion ─────────────────────────────────────────────────


def promote(
    events: Sequence[dict[str, Any]],
    cast: Sequence[int],
    window_start_s: float,
    window_end_s: float,
    entry_offsets: Sequence[float],
    grids: dict[int, list[dict[str, Any]]],
) -> PromotedRoutine:
    """Mechanically promote a Routine Take's slice: deck→slot re-address +
    beat-domain rebase. `grids` maps each cast track id to its Beatgrid's
    tempo_changes (the router falls back to a constant grid from the
    served BPM for gridless tracks)."""
    if len(cast) < 3:
        raise PromotionError("n ≥ 3 — a 2-cast routine is a Transition (ADR 0035)")
    if len(entry_offsets) != len(cast):
        raise PromotionError("entry_offsets must match the cast, slot for slot")
    if window_end_s <= window_start_s:
        raise PromotionError("empty window")
    missing = [tid for tid in cast if tid not in grids]
    if missing:
        raise PromotionError(f"missing beatgrid tempo data for tracks {missing}")

    events = sorted(events, key=lambda e: e.get("t", 0))
    residencies = map_slots(events, cast, window_start_s, window_end_s, entry_offsets)
    beat_at = build_beat_clock(events, residencies, grids, window_start_s, window_end_s)
    samples = deck_playhead_samples(events)

    entry_offsets_beats: list[float] = []
    entry_positions: list[float] = []
    for r in sorted(residencies, key=lambda r: r.slot):
        entry_t = window_start_s + entry_offsets[r.slot]
        entry_offsets_beats.append(round(beat_at(entry_t), 6))
        entry_positions.append(round(playhead_at(samples.get(r.deck, []), entry_t), 6))

    out_events: list[dict[str, Any]] = []
    # Seed each slot's control state at its RESIDENCY START (the values
    # actually set when the track was loaded / at window open for the
    # adopted slot) — pre-window knob positions are choreography, not
    # bookkeeping. Real same-beat events sort after the seed and win.
    for r in residencies:
        t_seed = max(window_start_s, r.start)
        b_seed = round(beat_at(t_seed), 6)
        for control, value in _deck_state_at(events, r.deck, t_seed).items():
            out_events.append(
                {
                    "kind": "control",
                    "slot": r.slot,
                    "control": control,
                    "value": round(value, 6),
                    "beat": b_seed,
                    "seeded": True,
                }
            )
    dropped = 0
    for e in events:
        t = float(e.get("t", 0))
        if t < window_start_s or t > window_end_s:
            continue
        if e.get("kind") in ("tenure", "init"):
            continue  # surface bookkeeping, not choreography
        mapped = _readdress_event(e, residencies, beat_at)
        if mapped is None:
            dropped += 1
            continue
        out_events.append(mapped)
    out_events.sort(key=lambda e: e["beat"])

    return PromotedRoutine(
        cast=list(cast),
        entry_offsets_beats=entry_offsets_beats,
        entry_positions=entry_positions,
        duration_beats=round(beat_at(window_end_s), 6),
        events=out_events,
        residencies=residencies,
        dropped_events=dropped,
        window_start_s=window_start_s,
        window_end_s=window_end_s,
    )


# ── boundary trim + re-promotion (gh#170) ───────────────────────────────


def _invert_beat_clock(beat_at, lo: float, hi: float, target_beat: float) -> float:
    """Capture-seconds instant where the (monotone) beat clock crosses
    `target_beat` — bisection over the window."""
    for _ in range(60):
        mid = (lo + hi) / 2
        if beat_at(mid) < target_beat:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def retrim(
    events: Sequence[dict[str, Any]],
    cast: Sequence[int],
    window_start_s: float,
    window_end_s: float,
    entry_offsets: Sequence[float],
    grids: dict[int, list[dict[str, Any]]],
    trim_start_beats: float,
    trim_end_beats: float,
) -> PromotedRoutine:
    """Boundary trim + mechanical re-promotion (the v1 review affordance,
    ADR 0035 / gh#170): move the given window's boundaries by beat
    amounts — the editor's axis is the Routine clock, so trims arrive in
    beats, relative to the window passed in (the router passes the
    routine's CURRENT window, gh#190). POSITIVE narrows (inverted
    through the same beat
    clock promotion built); NEGATIVE WIDENS outward (gh#170 follow-up:
    the miner under-sizes dwell-shaped windows — #181's WYGFM case),
    converted at the boundary-local beat rate and bounded by the origin
    session slice's own extent (the events carry audibility; there is
    nothing to replay beyond them). Then `promote` re-runs over the new
    window — the raw take is untouched (evidence doctrine). A slot whose
    entry falls past the new end drops from the cast (the confirm flow's
    rule); one entering before the new start rebases (offset 0 at open).
    n ≥ 3 holds.
    """
    events = sorted(events, key=lambda e: e.get("t", 0))
    residencies = map_slots(events, cast, window_start_s, window_end_s, entry_offsets)
    beat_at = build_beat_clock(events, residencies, grids, window_start_s, window_end_s)
    total = beat_at(window_end_s)
    b0 = trim_start_beats
    b1 = total - trim_end_beats
    if b1 - b0 <= 1e-6:
        raise PromotionError("trim collapses the window")

    # Boundary-local beat rates (beats/sec) for the widen conversion.
    def bps_at(t: float) -> float:
        lo = max(window_start_s, t - 1.0)
        hi = min(window_end_s, t + 1.0)
        db = beat_at(hi) - beat_at(lo)
        dt = hi - lo
        return db / dt if dt > 0 and db > 0 else DEFAULT_BPS

    # The session slice's extent — the outer bound for widening.
    times = [float(e.get("t", 0)) for e in events]
    ev_lo = max(0.0, min(times)) if times else window_start_s
    ev_hi = max(times) if times else window_end_s

    if b0 > 0:
        s0 = _invert_beat_clock(beat_at, window_start_s, window_end_s, b0)
    elif b0 < 0:
        s0 = max(ev_lo, window_start_s - (-b0) / bps_at(window_start_s))
    else:
        s0 = window_start_s
    if trim_end_beats > 0:
        s1 = _invert_beat_clock(beat_at, window_start_s, window_end_s, b1)
    elif trim_end_beats < 0:
        s1 = min(ev_hi, window_end_s + (-trim_end_beats) / bps_at(window_end_s))
    else:
        s1 = window_end_s
    if s1 - s0 <= 0:
        raise PromotionError("trim collapses the window")
    new_cast: list[int] = []
    new_offsets: list[float] = []
    for slot, tid in enumerate(cast):
        entry_t = window_start_s + entry_offsets[slot]
        if entry_t >= s1:
            continue  # trimmed off the end — the slot leaves the cast
        new_cast.append(tid)
        new_offsets.append(max(0.0, entry_t - s0))
    if len(new_cast) < 3:
        raise PromotionError(
            "trim leaves fewer than 3 cast slots — a 2-cast routine is a "
            "Transition (ADR 0035)"
        )
    return promote(events, new_cast, s0, s1, new_offsets, grids)
