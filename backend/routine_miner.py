"""Routine miner: candidate n-track choreography spans from a Session's
event log (ADR 0035, routines 157).

Suggestion-first provenance: this module only MARKS candidate spans — a
human confirms one into a Routine Take (no liberal auto-minting: on the
2026-08-24 corpus 128 of 144 detected weave returns were Practice reps).
The pipeline, per Session, over the concatenated `session_chunks` events:

1. **Audibility reconstruction** — per-deck intervals where a track is
   loaded ∧ playing ∧ channel fader above threshold, with fader-wiggle
   fragments merged. Deliberately simpler than the Master-audibility
   definition in `session_audibility.py` (crossfader/EQ-kill awareness is
   an optional v2): the miner wants "the performer had this track up",
   not "the master bus carried it".
2. **Practice discrimination** — a return (a track re-audible after an
   away-gap with someone else audible) is a Practice rep if the returning
   deck saw backward transport motion during the gap (re-seeking to replay
   a junction) or the return is a pair-isolated alternation (fader-drill
   reps). See CONTEXT.md "Practice rep": a read-time verdict with tunable
   thresholds; the log itself stays impartial.
3. **Sectioning** — complexity events (performance/practice returns,
   3-track-concurrency stretches, self-doubles) clustered in time, plus
   the audibility intervals around them.
4. **Candidate carving** — seeds are performance returns; clusters split
   at boundary solo moments (concurrency ≤ 1 for ≥ 8s — but a seed's own
   away-gap is interior, never a boundary); triples extend a seeded
   cluster but never seed one; the cast must be a contiguous run of some
   ordered track list (a playlist), enter with its first member and exit
   with its last (the Routine boundary contract); windows expand into the
   bounding solos. Chained candidates may share exactly one boundary
   track (one's exit is the other's entry).

Pure algorithm — no DB access; the task layer (`routine_miner_tasks`)
feeds it events + playlist orderings and persists the suggestion rows
keyed by MINER_VERSION. All thresholds are tunable heuristics validated
against the real corpus (sessions 4–49, relentless groove), not part of
the Routine definition.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

# Bump to invalidate persisted suggestion rows: the sweep re-mines every
# Session whose marker differs (routine_miner_tasks.enqueue_stale_routine_mining).
MINER_VERSION = 1

# --- audibility reconstruction ---
FADER_ON = 0.10           # channel fader above this = contributing
MIN_AUDIBLE_S = 1.0       # drop blips shorter than this
MERGE_GAP_S = 4.0         # merge same-track/deck fragments this close

# --- events / practice discrimination ---
RETURN_GAP_S = 8.0        # away-gap must exceed this to be a return
RETURN_MAX_S = 120.0      # ... and not exceed this (else it's a re-play)
BACKSEEK_S = 8.0          # playhead this far behind the estimate = backseek
BACKSEEK_PAD_BEFORE_S = 5.0   # backseek counting window around the away-gap
BACKSEEK_PAD_AFTER_S = 1.0
PAIR_WINDOW_BEFORE_S = 10.0   # pair-isolation context window around the gap
PAIR_WINDOW_AFTER_S = 20.0
MIN_TRIPLE_S = 2.0        # 3-concurrency stretches shorter than this ignored
EVENT_CLUSTER_S = 90.0    # events this close belong to one section

# --- candidate carving ---
TRIPLE_SEED_MIN_S = 15.0  # triples shorter than this don't even extend
SOLO_MIN_S = 8.0          # concurrency ≤ 1 at least this long = solo moment
CLUSTER_MAX_GAP_S = 160.0  # max seed-to-seed gap within one cluster
TRIPLE_ATTACH_PAD_S = 75.0  # triples within this of a cluster extend it
EVENT_PAD_S = 12.0        # initial window pad around the cluster's events
CAST_MIN_AUDIBLE_S = 8.0  # min audibility inside the window to make the cast
EXPAND_MAX_S = 180.0      # how far the window may expand into boundary tenures
SOLO_CLAMP_PAD_S = 3.0    # keep this much of the bounding solo in the window
MIN_CAST = 3              # n ≥ 3 — a 2-cast routine IS a Transition (ADR 0035)


@dataclass(frozen=True)
class Interval:
    """One merged audibility stretch of a track on a deck (capture-clock s)."""

    start: float
    end: float
    channel: str
    track_id: int


@dataclass
class ReturnEvent:
    """A track re-audible after an away-gap while someone else played."""

    t: float            # re-entry instant (the returning interval's start)
    end: float          # the returning interval's end
    track_id: int
    channel: str        # deck the track returned on
    gap_start: float    # when the track went silent (away-gap = gap_start..t)
    backseeks: int      # backward transport motions on `channel` in the gap
    pair_rep: bool      # pair-isolated alternation (fader-drill reps)

    @property
    def practice(self) -> bool:
        return self.backseeks > 0 or self.pair_rep


@dataclass
class TripleEvent:
    """A maximal stretch with 3+ distinct tracks concurrently audible."""

    t: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.t


@dataclass
class Section:
    """A time-clustered patch of complexity: its events + every audibility
    interval overlapping it (context included, intervals unclipped)."""

    start: float
    end: float
    returns: list[ReturnEvent]
    triples: list[TripleEvent]
    intervals: list[Interval]


@dataclass
class Candidate:
    """A carved Routine candidate span (entry-ordered cast, abs window)."""

    cast: list[int]               # track ids, entry order (slot order)
    window_start_s: float         # capture-clock seconds
    window_end_s: float
    entry_offsets: list[float]    # per slot, seconds from window start
    n_returns: int                # performance-return seeds in the cluster
    n_triples: int                # attached triple events

    @property
    def entry_track_id(self) -> int:
        return self.cast[0]

    @property
    def exit_track_id(self) -> int:
        return self.cast[-1]

    @property
    def n_events(self) -> int:
        return self.n_returns + self.n_triples


@dataclass
class MinerResult:
    candidates: list[Candidate]
    n_returns: int = 0
    n_practice_returns: int = 0


# ---------------------------------------------------------------------------
# 1. Audibility reconstruction
# ---------------------------------------------------------------------------


def reconstruct_audibility(
    events: Sequence[dict[str, Any]],
) -> tuple[list[Interval], dict[str, list[float]]]:
    """Replay the event stream into merged per-deck audibility intervals,
    plus per-deck backseek instants (backward transport motion).

    Audible = loaded ∧ playing ∧ fader > FADER_ON. The playhead estimate
    advances with wall time while a deck plays; any transport event whose
    playhead lands BACKSEEK_S behind the estimate is a backseek. Every
    transport event carrying a playhead feeds the estimate — including
    previews, hot cues and beat jumps: re-stabbing a junction is exactly
    the rehearsal motion practice discrimination wants to see.

    `events` must be sorted by t (mine_session sorts).
    """
    loaded: dict[str, int | None] = {}
    playing: dict[str, bool] = defaultdict(bool)
    fader: dict[str, float] = defaultdict(lambda: 1.0)
    audible_since: dict[str, float] = {}
    raw: list[tuple[float, float, str, int]] = []
    est_pos: dict[str, float] = {}
    est_t: dict[str, float] = {}
    backseeks: dict[str, list[float]] = defaultdict(list)

    def audible(ch: str) -> bool:
        return playing[ch] and fader[ch] > FADER_ON and loaded.get(ch) is not None

    def transition(ch: str, t: float, mutate) -> None:
        was, tid_was = audible(ch), loaded.get(ch)
        mutate()
        now = audible(ch)
        if was and (not now or loaded.get(ch) != tid_was):
            st = audible_since.pop(ch, None)
            if st is not None and t - st >= MIN_AUDIBLE_S and tid_was is not None:
                raw.append((st, t, ch, tid_was))
        if now and (not was or loaded.get(ch) != tid_was):
            audible_since[ch] = t

    def note_playhead(ch: str, t: float, playhead: float) -> None:
        if ch in est_pos and playing[ch]:
            est = est_pos[ch] + (t - est_t[ch])
            if playhead < est - BACKSEEK_S:
                backseeks[ch].append(t)
        elif ch in est_pos and playhead < est_pos[ch] - BACKSEEK_S:
            backseeks[ch].append(t)
        est_pos[ch], est_t[ch] = playhead, t

    last_t = 0.0
    for e in events:
        t = float(e.get("t", 0))
        last_t = max(last_t, t)
        kind, ch = e.get("kind"), e.get("channel")
        if kind == "load" and ch:
            transition(ch, t, lambda: loaded.__setitem__(ch, e.get("trackId")))
            est_pos[ch], est_t[ch] = 0.0, t
        elif kind == "transport" and ch:
            if e.get("playhead") is not None:
                note_playhead(ch, t, float(e["playhead"]))
            action = e.get("action")
            if action == "play":
                transition(ch, t, lambda: playing.__setitem__(ch, True))
            elif action in ("pause", "cue", "stop"):
                transition(ch, t, lambda: playing.__setitem__(ch, False))
        elif kind == "control" and e.get("control") == "fader" and ch:
            transition(ch, t, lambda: fader.__setitem__(ch, float(e.get("value", 1))))

    for ch, st in list(audible_since.items()):
        tid = loaded.get(ch)
        if last_t - st >= MIN_AUDIBLE_S and tid is not None:
            raw.append((st, last_t, ch, tid))

    # Merge fader-wiggle fragments per (track, deck).
    merged: list[Interval] = []
    by_key: dict[tuple[int, str], list[list[float]]] = defaultdict(list)
    for st, en, ch, tid in sorted(raw):
        by_key[(tid, ch)].append([st, en])
    for (tid, ch), ivs in by_key.items():
        cur = ivs[0]
        for iv in ivs[1:]:
            if iv[0] - cur[1] <= MERGE_GAP_S:
                cur[1] = max(cur[1], iv[1])
            else:
                merged.append(Interval(cur[0], cur[1], ch, tid))
                cur = iv
        merged.append(Interval(cur[0], cur[1], ch, tid))
    merged.sort(key=lambda iv: (iv.start, iv.end))
    return merged, dict(backseeks)


# ---------------------------------------------------------------------------
# 2. Events + practice discrimination
# ---------------------------------------------------------------------------


def detect_returns(
    intervals: Sequence[Interval], backseeks: dict[str, list[float]]
) -> list[ReturnEvent]:
    """Returns with the practice verdict attached (CONTEXT.md "Practice rep")."""
    by_tid: dict[int, list[Interval]] = defaultdict(list)
    for iv in intervals:
        by_tid[iv.track_id].append(iv)
    out: list[ReturnEvent] = []
    for tid, ivs in by_tid.items():
        ivs.sort(key=lambda iv: iv.start)
        for i1, i2 in zip(ivs, ivs[1:]):
            gap0, gap1 = i1.end, i2.start
            if not (RETURN_GAP_S < gap1 - gap0 <= RETURN_MAX_S):
                continue
            others_audible = any(
                iv.start < gap1 and iv.end > gap0 and iv.track_id != tid
                for iv in intervals
            )
            if not others_audible:
                continue
            n_backseeks = sum(
                1
                for bt in backseeks.get(i2.channel, [])
                if gap0 - BACKSEEK_PAD_BEFORE_S <= bt <= gap1 + BACKSEEK_PAD_AFTER_S
            )
            # Pair-isolated alternation: only one other track around the
            # gap, and both tracks re-enter repeatedly — fader-drill reps.
            w0 = gap0 - PAIR_WINDOW_BEFORE_S
            w1 = gap1 + PAIR_WINDOW_AFTER_S
            around = {
                iv.track_id
                for iv in intervals
                if iv.start < w1 and iv.end > w0 and iv.track_id != tid
            }
            pair_rep = (
                len(around) == 1
                and len(by_tid[tid]) >= 2
                and len(by_tid[next(iter(around))]) >= 2
            )
            out.append(
                ReturnEvent(
                    t=gap1,
                    end=i2.end,
                    track_id=tid,
                    channel=i2.channel,
                    gap_start=gap0,
                    backseeks=n_backseeks,
                    pair_rep=pair_rep,
                )
            )
    out.sort(key=lambda r: r.t)
    return out


def detect_triples(intervals: Sequence[Interval]) -> list[TripleEvent]:
    """Maximal stretches with 3+ distinct tracks concurrently audible."""
    pts: list[tuple[float, int, int]] = []
    for i, iv in enumerate(intervals):
        pts.append((iv.start, 1, i))
        pts.append((iv.end, -1, i))
    pts.sort()
    active: set[int] = set()
    start3: float | None = None
    out: list[TripleEvent] = []
    for t, d, i in pts:
        if d == 1:
            active.add(i)
        else:
            active.discard(i)
        n_tracks = len({intervals[j].track_id for j in active})
        if n_tracks >= 3 and start3 is None:
            start3 = t
        elif n_tracks < 3 and start3 is not None:
            if t - start3 >= MIN_TRIPLE_S:
                out.append(TripleEvent(start3, t))
            start3 = None
    return out


def _self_double_instants(intervals: Sequence[Interval]) -> list[float]:
    """Same track audible on two decks at once (sectioning signal only)."""
    by_tid: dict[int, list[Interval]] = defaultdict(list)
    for iv in intervals:
        by_tid[iv.track_id].append(iv)
    out = []
    for ivs in by_tid.values():
        for a in ivs:
            for b in ivs:
                if (
                    a.start < b.start
                    and a.channel != b.channel
                    and b.start < a.end
                ):
                    out.append(b.start)
    return out


# ---------------------------------------------------------------------------
# 3. Sectioning
# ---------------------------------------------------------------------------


def build_sections(
    intervals: Sequence[Interval],
    returns: Sequence[ReturnEvent],
    triples: Sequence[TripleEvent],
) -> list[Section]:
    """Cluster complexity events within EVENT_CLUSTER_S into sections and
    attach every interval overlapping the section span (unclipped)."""
    events: list[tuple[float, float, object]] = []  # (t, end, obj|None)
    for r in returns:
        events.append((r.t, r.end, r))
    for tr in triples:
        events.append((tr.t, tr.end, tr))
    for t in _self_double_instants(intervals):
        events.append((t, t, None))
    if not events:
        return []
    events.sort(key=lambda e: e[0])

    groups: list[list[tuple[float, float, object]]] = []
    cur = [events[0]]
    for e in events[1:]:
        if e[0] - cur[-1][0] <= EVENT_CLUSTER_S:
            cur.append(e)
        else:
            groups.append(cur)
            cur = [e]
    groups.append(cur)

    # Span per group: the events' involved stretch plus overlapping context.
    spans: list[list[float]] = []
    for g in groups:
        t0 = min(e[0] for e in g) - 5.0
        t1 = max(e[1] for e in g) + 5.0
        ctx = [iv for iv in intervals if iv.start < t1 and iv.end > t0]
        if ctx:
            t0 = min(iv.start for iv in ctx)
            t1 = max(iv.end for iv in ctx)
        spans.append([t0, t1])

    # Fuse overlapping sections (groups merge, spans union).
    fused: list[tuple[list[float], list[tuple[float, float, object]]]] = []
    for span, g in sorted(zip(spans, groups), key=lambda x: x[0][0]):
        if fused and span[0] < fused[-1][0][1]:
            prev_span, prev_g = fused[-1]
            prev_span[0] = min(prev_span[0], span[0])
            prev_span[1] = max(prev_span[1], span[1])
            prev_g.extend(g)
        else:
            fused.append((span, list(g)))

    sections = []
    for (t0, t1), g in fused:
        sections.append(
            Section(
                start=t0,
                end=t1,
                returns=sorted(
                    (e[2] for e in g if isinstance(e[2], ReturnEvent)),
                    key=lambda r: r.t,
                ),
                triples=sorted(
                    (e[2] for e in g if isinstance(e[2], TripleEvent)),
                    key=lambda tr: tr.t,
                ),
                intervals=[
                    iv for iv in intervals if iv.start < t1 and iv.end > t0
                ],
            )
        )
    return sections


# ---------------------------------------------------------------------------
# 4. Candidate carving
# ---------------------------------------------------------------------------


def _solo_moments(intervals: Sequence[Interval]) -> list[tuple[float, float]]:
    """Stretches ≥ SOLO_MIN_S with at most one track audible."""
    edges: list[tuple[float, int]] = []
    for iv in intervals:
        edges.append((iv.start, 1))
        edges.append((iv.end, -1))
    edges.sort()
    solos: list[tuple[float, float]] = []
    n = 0
    prev_t = 0.0
    for t, d in edges:
        if n <= 1 and t - prev_t >= SOLO_MIN_S and prev_t > 0:
            solos.append((prev_t, t))
        prev_t = t
        n += d
    return solos


def _carve_section(
    section: Section, orderings: Sequence[dict[int, int]]
) -> list[Candidate]:
    seeds = [r for r in section.returns if not r.practice]
    if not seeds:
        # Triples alone are decomposable as overlapping adjacency windows —
        # they extend a seeded cluster but never seed one.
        return []

    # Boundary solos: a seed's away-gap is interior to a Routine, never a
    # boundary — drop solos overlapping any seed's gap.
    gaps = [(r.gap_start, r.t) for r in seeds]
    bsolos = [
        s
        for s in _solo_moments(section.intervals)
        if not any(min(s[1], g1) - max(s[0], g0) > 0 for g0, g1 in gaps)
    ]

    def solo_between(t_a: float, t_b: float) -> bool:
        return any(a >= t_a and b <= t_b for a, b in bsolos)

    # Cluster seeds: close in time, no boundary solo between them.
    clusters: list[list[Any]] = []
    cur: list[Any] = [seeds[0]]
    for r in seeds[1:]:
        if r.t - cur[-1].end <= CLUSTER_MAX_GAP_S and not solo_between(
            cur[-1].end, r.t
        ):
            cur.append(r)
        else:
            clusters.append(cur)
            cur = [r]
    clusters.append(cur)

    # Long triples extend a seeded cluster (chaining off already-attached
    # members) but never seed one.
    long_triples = [tr for tr in section.triples if tr.duration >= TRIPLE_SEED_MIN_S]
    for cl in clusters:
        for tr in long_triples:
            if tr.t <= max(ev.end for ev in cl) + TRIPLE_ATTACH_PAD_S and tr.end >= min(
                ev.t for ev in cl
            ) - TRIPLE_ATTACH_PAD_S:
                cl.append(tr)

    by_tid: dict[int, list[Interval]] = defaultdict(list)
    for iv in section.intervals:
        by_tid[iv.track_id].append(iv)

    out: list[Candidate] = []
    for cl in clusters:
        lo_t = min(ev.t for ev in cl) - EVENT_PAD_S
        hi_t = max(ev.end for ev in cl) + EVENT_PAD_S

        def clipped(tid: int, a: float, b: float) -> list[tuple[float, float]]:
            return [
                (max(iv.start, a), min(iv.end, b))
                for iv in by_tid[tid]
                if iv.start < b and iv.end > a
            ]

        cast = {
            tid
            for tid in by_tid
            if sum(b - a for a, b in clipped(tid, lo_t, hi_t)) >= CAST_MIN_AUDIBLE_S
        }
        if len(cast) < MIN_CAST:
            continue

        n_returns = sum(1 for ev in cl if isinstance(ev, ReturnEvent))
        n_triples = len(cl) - n_returns
        first_ev_t = min(ev.t for ev in cl)
        last_ev_end = max(ev.end for ev in cl)

        for ordering in orderings:
            if not cast <= ordering.keys():
                continue
            pos = {tid: ordering[tid] for tid in cast}
            lo_tid = min(cast, key=lambda tid: pos[tid])
            hi_tid = max(cast, key=lambda tid: pos[tid])

            # Expand into the boundary tracks' tenures: start inside the
            # entry track's, end inside the exit track's...
            w0, w1 = lo_t, hi_t
            lo_starts = [
                iv.start for iv in by_tid[lo_tid] if iv.start >= lo_t - EXPAND_MAX_S
            ]
            if lo_starts:
                w0 = min(w0, min(lo_starts))
            hi_ends = [iv.end for iv in by_tid[hi_tid] if iv.end <= hi_t + EXPAND_MAX_S]
            if hi_ends:
                w1 = max(w1, max(hi_ends))
            # ... clamped into the bounding solo moments (a Routine boundary
            # is a solo moment).
            prev_solos = [b for a, b in bsolos if b <= first_ev_t]
            if prev_solos:
                w0 = max(w0, prev_solos[-1] - SOLO_CLAMP_PAD_S)
            next_solos = [a for a, b in bsolos if a >= last_ev_end]
            if next_solos:
                w1 = min(w1, next_solos[0] + SOLO_CLAMP_PAD_S)

            involved = {tid: clipped(tid, w0, w1) for tid in cast}
            involved = {tid: ivs for tid, ivs in involved.items() if ivs}
            if len(involved) < MIN_CAST:
                continue

            # Cast contiguity: must cover every ordering position lo..hi —
            # a skipped entry breaks the run.
            ps = sorted(pos[tid] for tid in involved)
            if set(range(ps[0], ps[-1] + 1)) - set(ps):
                continue

            entry_order = sorted(
                involved, key=lambda tid: min(a for a, b in involved[tid])
            )
            entry_tid = entry_order[0]
            # First maximal in entry order: window clamping can tie several
            # casts' clipped ends, and the earliest-entering of the tied
            # tracks is the one still "holding" the window's close.
            exit_tid = max(entry_order, key=lambda tid: max(b for a, b in involved[tid]))
            # Boundary contract: enter with the first cast track, exit with
            # the last (ADR 0035).
            if pos[entry_tid] != ps[0] or pos[exit_tid] != ps[-1]:
                continue

            t0 = min(a for ivs in involved.values() for a, b in ivs)
            t1 = max(b for ivs in involved.values() for a, b in ivs)
            out.append(
                Candidate(
                    cast=entry_order,
                    window_start_s=t0,
                    window_end_s=t1,
                    entry_offsets=[
                        min(a for a, b in involved[tid]) - t0 for tid in entry_order
                    ],
                    n_returns=n_returns,
                    n_triples=n_triples,
                )
            )
            break  # first ordering that validates the cast wins
    return out


def _conflicts(a: Candidate, b: Candidate) -> bool:
    """Overlapping casts conflict — except a single shared boundary track
    (one's exit is the other's entry): chained Routines are legal."""
    shared = set(a.cast) & set(b.cast)
    if not shared:
        return False
    if len(shared) == 1:
        s = next(iter(shared))
        if (s == a.entry_track_id and s == b.exit_track_id) or (
            s == a.exit_track_id and s == b.entry_track_id
        ):
            return False
    return True


def mine_session(
    events: Iterable[dict[str, Any]],
    orderings: Sequence[dict[int, int]],
) -> MinerResult:
    """Run the full pipeline over one Session's concatenated events.

    `orderings` are the ordered track lists (playlists) the cast
    contiguity check runs against: a candidate's cast must be a
    contiguous run of at least one of them. Within the Session,
    overlapping candidates are deduped best-first (most evidence, then
    earliest); chained candidates sharing one boundary track survive.
    """
    events = sorted(events, key=lambda e: e.get("t", 0))
    intervals, backseeks = reconstruct_audibility(events)
    returns = detect_returns(intervals, backseeks)
    triples = detect_triples(intervals)
    sections = build_sections(intervals, returns, triples)

    candidates: list[Candidate] = []
    for section in sections:
        candidates.extend(_carve_section(section, orderings))

    candidates.sort(key=lambda c: (-c.n_events, c.window_start_s))
    kept: list[Candidate] = []
    for c in candidates:
        if not any(_conflicts(c, k) for k in kept):
            kept.append(c)
    kept.sort(key=lambda c: c.window_start_s)

    return MinerResult(
        candidates=kept,
        n_returns=len(returns),
        n_practice_returns=sum(1 for r in returns if r.practice),
    )
