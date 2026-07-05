/**
 * Set planner (sets 03) — pure, under vitest. The feature's single new
 * test seam (PRD Testing Decisions).
 *
 * `planSet(input) → deterministic playback plan`: per entry a deck
 * (ping-pong parity), entry/exit in track time, the audible span on the
 * mix axis; per adjacency the executed window. All Set-playback
 * semantics live here — the runtime Conductor only schedules the plan.
 */
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '../capture/events';
import type { Transition } from '../editor/mixModel';
import { jumpCrossed, planSet, planStateAt, type PlanInput } from './planner';

/** Track facts shorthand: id → { durationSec, bpm, mainCueSec }. */
function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    entries: [],
    tracks: {},
    transitionsByUuid: {},
    takesByUuid: {},
    ...over,
  };
}

const facts = (durationSec: number, mainCueSec = 0, bpm: number | null = 120) => ({
  durationSec,
  bpm,
  mainCueSec,
});

const tr = (over: Partial<Transition> = {}): Transition => ({
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: false,
  lanes: {},
  ...over,
});

describe('boundaries', () => {
  it('plans an empty set as an empty plan', () => {
    const plan = planSet(input());
    expect(plan.entries).toEqual([]);
    expect(plan.adjacencies).toEqual([]);
    expect(plan.totalSec).toBe(0);
  });

  it('starts the first track at its BEGINNING (Main cue is not a set boundary) and stops after the last', () => {
    // Review verdict 2026-07-05: even with a Main cue set (30s here), the
    // set opens with the whole first track.
    const plan = planSet(
      input({
        entries: [{ trackId: 1, pin: null }],
        tracks: { 1: facts(200, 30) },
      })
    );
    const [e] = plan.entries;
    expect(e.entrySec).toBe(0);
    expect(e.entryMixSec).toBe(0);
    expect(e.exitSec).toBe(200);
    expect(e.exitMixSec).toBeCloseTo(200);
    expect(plan.totalSec).toBeCloseTo(200);
  });
});

describe('ping-pong parity', () => {
  it('alternates decks A,B,A,B in entry order', () => {
    const plan = planSet(
      input({
        entries: [1, 2, 3, 4].map((trackId) => ({ trackId, pin: null })),
        tracks: { 1: facts(100), 2: facts(100), 3: facts(100), 4: facts(100) },
      })
    );
    expect(plan.entries.map((e) => e.deck)).toEqual(['A', 'B', 'A', 'B']);
  });
});

describe('hard cuts (unresolved adjacencies)', () => {
  it('plays the outgoing to its end and starts the incoming at its Main cue', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: null },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100, 25) },
      })
    );
    const [a, b] = plan.entries;
    const [adj] = plan.adjacencies;
    // Outgoing: whole track (its Main cue at 10 is no boundary) → cut at 90.
    expect(a.entrySec).toBe(0);
    expect(a.exitSec).toBe(90);
    expect(a.exitMixSec).toBeCloseTo(90);
    // Zero-width window at the cut instant.
    expect(adj.kind).toBe('hardcut');
    expect(adj.mixStartSec).toBeCloseTo(90);
    expect(adj.mixEndSec).toBeCloseTo(90);
    // Incoming from its own Main cue at the cut.
    expect(b.entrySec).toBe(25);
    expect(b.entryMixSec).toBeCloseTo(90);
    expect(b.exitSec).toBe(100);
    expect(plan.totalSec).toBeCloseTo(90 + 75);
  });

  it('hard-cuts every unresolved adjacency in a chain without stalling', () => {
    const plan = planSet(
      input({
        entries: [1, 2, 3].map((trackId) => ({ trackId, pin: null })),
        tracks: { 1: facts(90), 2: facts(80), 3: facts(70) },
      })
    );
    expect(plan.adjacencies.map((a) => a.kind)).toEqual(['hardcut', 'hardcut']);
    expect(plan.totalSec).toBeCloseTo(90 + 80 + 70);
  });

  it('degrades a dangling transition pin to a hard cut', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 'gone' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90), 2: facts(100) },
      })
    );
    expect(plan.adjacencies[0].kind).toBe('hardcut');
  });
});

describe('pinned Transition windows', () => {
  /** Track 1: dur 90 (its Main cue at 10 is not a boundary — time 0 at
   * mix 0). Transition: window 60..80 in track-1 time (= mix 60..80),
   * B in at 8. */
  const twoTracks = (transition: Transition, dur2 = 100) =>
    input({
      entries: [
        { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
        { trackId: 2, pin: null },
      ],
      tracks: { 1: facts(90, 10), 2: facts(dur2) },
      transitionsByUuid: { t1: transition },
    });

  it('places the window on the mix axis via the outgoing anchor (Sketch origin)', () => {
    const plan = planSet(twoTracks(tr()));
    const [adj] = plan.adjacencies;
    expect(adj.kind).toBe('transition');
    expect(adj.mixStartSec).toBeCloseTo(60);
    expect(adj.mixEndSec).toBeCloseTo(80);
  });

  it('exits the outgoing at the window end and anchors the incoming after it', () => {
    const plan = planSet(twoTracks(tr()));
    const [a, b] = plan.entries;
    expect(a.exitSec).toBeCloseTo(80);
    expect(a.exitMixSec).toBeCloseTo(80);
    // B's track time at the window end is 8 + 20 = 28 → time 0 at mix 52.
    expect(b.mixOffsetSec).toBeCloseTo(52);
    expect(b.entrySec).toBeCloseTo(8);
    expect(b.entryMixSec).toBeCloseTo(60); // audible from the window start
    expect(b.exitSec).toBeCloseTo(100);
    expect(plan.totalSec).toBeCloseTo(152);
  });

  it('clamps the outgoing exit to its own end when the window runs past it', () => {
    // Window 80..100 in track-1 time, but track 1 is 90s long.
    const plan = planSet(twoTracks(tr({ startSec: 80 })));
    expect(plan.entries[0].exitSec).toBeCloseTo(90);
    // The window itself keeps its authored footprint on the mix axis.
    expect(plan.adjacencies[0].mixEndSec).toBeCloseTo(100);
  });

  it('defers the incoming entry past a silent lead gap (bInSec < 0)', () => {
    const plan = planSet(twoTracks(tr({ bInSec: -4 })));
    const b = plan.entries[1];
    expect(b.entrySec).toBeCloseTo(0);
    // B's audio begins 4s into the window: mix 60 + 4.
    expect(b.entryMixSec).toBeCloseTo(64);
  });

  it('tempo-matches the incoming during the window and snaps to native after', () => {
    // returnSecPerPercent 0 = instant snap; Tempo return ramps have their
    // own suite below (sets 06).
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: { ...facts(90, 10), bpm: 100 }, 2: { ...facts(100), bpm: 96 } },
        transitionsByUuid: { t1: tr({ tempoMatch: true }) },
        tempo: { policy: 'riding', returnSecPerPercent: 0 },
      })
    );
    const [adj] = plan.adjacencies;
    const rate = 100 / 96;
    expect(adj.pitchIncomingPercent).toBeCloseTo((rate - 1) * 100);
    expect(adj.rateIncoming).toBeCloseTo(rate);
    // B advances 20s of mix time at the matched rate: 8 + 20·rate.
    const bAtEnd = 8 + 20 * rate;
    // Post-window anchor is native-rate (instant snap): time 0 at 80 − bAtEnd.
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(80 - bAtEnd);
    expect(plan.totalSec).toBeCloseTo(80 - bAtEnd + 100);
  });

  it('folds Jump events into the incoming anchor (deltas land at their instants)', () => {
    // +10s jump halfway through the window: B is 10s further along at the end.
    const plan = planSet(twoTracks(tr({ jumps: [{ x: 0.5, deltaSec: 10 }] })));
    // B at window end: 8 + 20 + 10 = 38 → time 0 at mix 80 − 38 = 42.
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(42);
  });

  it('flags overlapping windows (as a grace fade, sets 14) and windows past the outgoing end', () => {
    const overlapping = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
          { trackId: 3, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100), 3: facts(100) },
        transitionsByUuid: {
          t1: tr(), // window mix 60..80, B anchored at mix 52
          t2: tr({ startSec: 20, bInSec: 0 }), // window mix 72..92 — overlaps
        },
      })
    );
    // The collision surfaces as the grace-fade transform's warning (the
    // raw window-overlap flag is subsumed — one chip per collision).
    const flagged = overlapping.warnings.find(
      (w) => w.kind === 'grace-fade' || w.kind === 'grace-floor'
    );
    expect(flagged?.adjacencyIndex).toBe(1);
    expect(overlapping.warnings.some((w) => w.kind === 'window-overlap')).toBe(false);

    const pastEnd = planSet(twoTracks(tr({ startSec: 95 })));
    expect(pastEnd.warnings.some((w) => w.kind === 'window-past-end' && w.adjacencyIndex === 0)).toBe(
      true
    );
  });
});

describe('Take pins (plan-time vectorization)', () => {
  /** Minimal raw slice: init head + one tick, outgoing on channel A at
   * 60s, incoming at 8s, window 100..120 on the capture clock. The
   * vectorizer turns this into startSec 60 / durationSec 20 / bInSec 8. */
  const takeSource = (): { events: CaptureEvent[]; windowStartS: number; windowEndS: number } => ({
    events: [
      {
        t: 100,
        kind: 'init',
        outgoingChannel: 'A',
        decks: {
          A: { trackId: 1, playing: true, fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pitch: 0 },
          B: { trackId: 2, playing: true, fader: 1, trim: 0.5, eq: { low: 0.5, mid: 0.5, high: 0.5 }, filter: 0, pitch: 0 },
        },
        crossfader: 0,
        crossfaderEnabled: true,
      },
      { t: 100, kind: 'tick', playheads: { A: 60, B: 8 } },
    ],
    windowStartS: 100,
    windowEndS: 120,
  });

  it('delegates to the vectorizer: the planned window is the idealized Take', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'take', uuid: 'tk1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100) },
        takesByUuid: { tk1: takeSource() },
      })
    );
    const [adj] = plan.adjacencies;
    expect(adj.kind).toBe('take');
    expect(adj.transition!.startSec).toBeCloseTo(60);
    expect(adj.transition!.durationSec).toBeCloseTo(20);
    expect(adj.transition!.bInSec).toBeCloseTo(8);
    // Same downstream math as a saved Transition.
    expect(adj.mixStartSec).toBeCloseTo(60);
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(52);
  });

  it('degrades a dangling or unvectorizable Take pin to a hard cut', () => {
    const dangling = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'take', uuid: 'gone' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90), 2: facts(100) },
      })
    );
    expect(dangling.adjacencies[0].kind).toBe('hardcut');

    const headless = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'take', uuid: 'tk1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90), 2: facts(100) },
        takesByUuid: { tk1: { events: [], windowStartS: 100, windowEndS: 120 } },
      })
    );
    expect(headless.adjacencies[0].kind).toBe('hardcut');
  });
});

// ── planStateAt (sets 04): plan evaluation at a mix instant ─────────────

describe('planStateAt', () => {
  /** Two tracks, transition window at track-1 time 60..80 (= mix 60..80),
   * B in at 8 — the same fixture as the window suite, with drawn lanes:
   * outgoing fader ramps 1→0, incoming eqLow parked at 0.2. */
  const lanes: Transition['lanes'] = {
    faderA: [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ],
    eqLowB: [{ x: 0, y: 0.2 }],
  };
  const twoTrackPlan = () =>
    planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100) },
        transitionsByUuid: { t1: tr({ lanes }) },
      })
    );

  it('solo stretch: only the active deck plays, at full fader, native pitch', () => {
    const s = planStateAt(twoTrackPlan(), 20); // track-1 time 20
    expect(s.decks.A.playing).toBe(true);
    expect(s.decks.A.trackTime).toBeCloseTo(20);
    expect(s.decks.A.pitchPercent).toBe(0);
    expect(s.decks.B.playing).toBe(false);
    expect(s.lanes.A.fader).toBe(1);
    expect(s.lanes.B.fader).toBe(0);
    expect(s.activeEntryIndex).toBe(0);
    expect(s.done).toBe(false);
  });

  it('inside the window: both decks play, role lanes mapped onto physical decks', () => {
    const s = planStateAt(twoTrackPlan(), 70); // window midpoint (x = 0.5)
    expect(s.decks.A.playing).toBe(true);
    expect(s.decks.A.trackTime).toBeCloseTo(70);
    expect(s.decks.B.playing).toBe(true);
    expect(s.decks.B.trackTime).toBeCloseTo(18); // 8 + 10s at rate 1
    // Outgoing-role fader (drawn 1→0) reads 0.5 at the midpoint, on deck A.
    expect(s.lanes.A.fader).toBeCloseTo(0.5);
    expect(s.lanes.B.eq.low).toBeCloseTo(0.2);
    expect(s.activeEntryIndex).toBe(1); // the incoming has entered
  });

  it('after the window: incoming solo at native pitch, outgoing deck stopped', () => {
    const s = planStateAt(twoTrackPlan(), 90);
    expect(s.decks.A.playing).toBe(false);
    expect(s.decks.B.playing).toBe(true);
    expect(s.decks.B.trackTime).toBeCloseTo(38); // native anchor: 90 − 52
    expect(s.decks.B.pitchPercent).toBe(0);
    expect(s.lanes.B.fader).toBe(1);
    expect(s.lanes.A.fader).toBe(0);
  });

  it('swaps role→deck mapping on odd adjacencies (outgoing on deck B)', () => {
    // Three tracks: adjacency 1's outgoing (entry 1) sits on deck B.
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: null }, // hard cut into track 2
          { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
          { trackId: 3, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100), 3: facts(100) },
        transitionsByUuid: { t2: tr({ startSec: 40, lanes }) },
      })
    );
    // Track 1 ends at mix 90 (cut); track 2 time 0 at mix 90; window mix 130..150.
    const s = planStateAt(plan, 140);
    expect(s.decks.B.playing).toBe(true); // outgoing (entry 1)
    expect(s.decks.A.playing).toBe(true); // incoming (entry 2)
    // Outgoing-role fader lane lands on physical deck B this time.
    expect(s.lanes.B.fader).toBeCloseTo(0.5);
    expect(s.lanes.A.eq.low).toBeCloseTo(0.2);
  });

  it('tempo-matches the incoming inside the window only', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: { ...facts(90, 10), bpm: 100 }, 2: { ...facts(100), bpm: 96 } },
        transitionsByUuid: { t1: tr({ tempoMatch: true }) },
      })
    );
    const rate = 100 / 96;
    const inWindow = planStateAt(plan, 70);
    expect(inWindow.decks.B.pitchPercent).toBeCloseTo((rate - 1) * 100);
    expect(inWindow.decks.B.trackTime).toBeCloseTo(8 + 10 * rate);
    const after = planStateAt(plan, 90);
    expect(after.decks.B.pitchPercent).toBe(0);
  });

  it('holds the incoming silent through a lead gap (bInSec < 0)', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100) },
        transitionsByUuid: { t1: tr({ bInSec: -4 }) },
      })
    );
    const early = planStateAt(plan, 62); // gap: B audio starts at mix 64
    expect(early.decks.B.playing).toBe(false);
    const later = planStateAt(plan, 66);
    expect(later.decks.B.playing).toBe(true);
    expect(later.decks.B.trackTime).toBeCloseTo(2);
  });

  it('hard-cuts: outgoing solo to the cut, incoming solo from its Main cue after', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: null },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100, 25) },
      })
    );
    const before = planStateAt(plan, 89.5);
    expect(before.decks.A.playing).toBe(true);
    expect(before.decks.B.playing).toBe(false);
    const after = planStateAt(plan, 90.5);
    expect(after.decks.A.playing).toBe(false);
    expect(after.decks.B.playing).toBe(true);
    expect(after.decks.B.trackTime).toBeCloseTo(25.5);
    expect(after.lanes.B.fader).toBe(1);
  });

  it('parks the upcoming deck at its planned entry before it plays', () => {
    const s = planStateAt(twoTrackPlan(), 20);
    expect(s.decks.B.entryIndex).toBe(1);
    expect(s.decks.B.trackId).toBe(2);
    expect(s.decks.B.trackTime).toBeCloseTo(8); // parked at planned entry
    expect(s.decks.B.playing).toBe(false);
  });

  it('reports jump-instant crossings on the global mix axis', () => {
    // Jump at window x=0.5 → track-1 time 70 → mix 70.
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: facts(90, 10), 2: facts(100) },
        transitionsByUuid: { t1: tr({ jumps: [{ x: 0.5, deltaSec: 10 }] }) },
      })
    );
    expect(jumpCrossed(plan, 69.9, 70.1)).toBe(true);
    expect(jumpCrossed(plan, 70.1, 70.3)).toBe(false);
  });

  it('is done past the last exit: both decks stopped', () => {
    const plan = twoTrackPlan();
    const s = planStateAt(plan, plan.totalSec + 1);
    expect(s.done).toBe(true);
    expect(s.decks.A.playing).toBe(false);
    expect(s.decks.B.playing).toBe(false);
  });
});

// ── Tempo policies (sets 06): Riding ramps + Fixed set tempo ────────────

describe('Riding tempo policy (Tempo return ramps)', () => {
  /** Tempo-matched window: outgoing 100 BPM, incoming 96 BPM → the
   * incoming rides ~+4.17% during the window (rate 100/96) and eases back
   * to native afterwards. Window at outgoing time 60..80, B in at 8. */
  const pitch = (100 / 96 - 1) * 100;
  const rate = 100 / 96;
  const bAtEnd = 8 + 20 * rate;
  const riding = (over: Partial<PlanInput> = {}) =>
    planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: { ...facts(300), bpm: 100 }, 2: { ...facts(300), bpm: 96 } },
        transitionsByUuid: { t1: tr({ tempoMatch: true }) },
        tempo: { policy: 'riding', returnSecPerPercent: 2 },
        ...over,
      })
    );

  it('appends a Tempo return ramp after the window (duration = pitch · secPerPercent)', () => {
    const plan = riding();
    const [adj] = plan.adjacencies;
    const d = pitch * 2;
    expect(adj.tempoReturnEndSec).toBeCloseTo(80 + d);
    // Post-ramp native anchor: the ramp covers d·(r+1)/2 of B's track time.
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(80 + d - (bAtEnd + (d * (rate + 1)) / 2));
    expect(plan.warnings).toEqual([]);
  });

  it('planStateAt eases pitch and position through the ramp, native after', () => {
    const plan = riding();
    const d = pitch * 2;
    const mid = 80 + d / 2;
    const s = planStateAt(plan, mid);
    expect(s.decks.B.pitchPercent).toBeCloseTo(pitch / 2);
    // trackTime = b + r·τ + (1−r)·τ²/(2d) at τ = d/2.
    const tau = d / 2;
    expect(s.decks.B.trackTime).toBeCloseTo(bAtEnd + rate * tau + ((1 - rate) * tau * tau) / (2 * d));
    const after = planStateAt(plan, 80 + d + 5);
    expect(after.decks.B.pitchPercent).toBe(0);
    expect(after.decks.B.trackTime).toBeCloseTo(80 + d + 5 - plan.entries[1].mixOffsetSec);
  });

  it('clamps the ramp faster when the runway to the next window is short, and flags it', () => {
    // Next window opens at incoming time 30 — only ~1.17s of B's track
    // time after the window end (b = 28.83): the return can't complete at
    // the tuned speed, so it clamps to end exactly at the next window.
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
          { trackId: 3, pin: null },
        ],
        tracks: {
          1: { ...facts(300), bpm: 100 },
          2: { ...facts(300), bpm: 96 },
          3: { ...facts(300), bpm: 96 },
        },
        transitionsByUuid: {
          t1: tr({ tempoMatch: true }),
          t2: tr({ startSec: 30, tempoMatch: true }),
        },
        tempo: { policy: 'riding', returnSecPerPercent: 2 },
      })
    );
    const [adj, next] = plan.adjacencies;
    expect(adj.tempoReturnEndSec).toBeCloseTo(next.mixStartSec);
    expect(adj.tempoReturnEndSec - adj.mixEndSec).toBeLessThan(pitch * 2);
    expect(
      plan.warnings.some((w) => w.kind === 'insufficient-runway' && w.adjacencyIndex === 0)
    ).toBe(true);
  });

  it('rides native windows (no tempo match) without a ramp', () => {
    const plan = riding({ transitionsByUuid: { t1: tr({ tempoMatch: false }) } });
    const [adj] = plan.adjacencies;
    expect(adj.tempoReturnEndSec).toBeCloseTo(adj.mixEndSec);
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(80 - 28); // b at rate 1
  });
});

describe('Fixed tempo policy (global rate scaling)', () => {
  /** Set tempo 90: outgoing (100 BPM) plays at rate 0.9, incoming
   * (80 BPM) at 1.125. Window authored at outgoing time 60..80 stretches
   * to mix 66.67..88.89. */
  const fixed = (over: Partial<PlanInput> = {}) =>
    planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: { ...facts(100), bpm: 100 }, 2: { ...facts(100), bpm: 80 } },
        transitionsByUuid: { t1: tr({ tempoMatch: false }) },
        tempo: { policy: 'fixed', setTempoBpm: 90 },
        ...over,
      })
    );

  it('pitches every entry to the Set tempo', () => {
    const plan = fixed();
    expect(plan.entries[0].rate).toBeCloseTo(0.9);
    expect(plan.entries[1].rate).toBeCloseTo(1.125);
  });

  it('stretches the authored window on the mix axis by the outgoing rate', () => {
    const plan = fixed();
    const [adj] = plan.adjacencies;
    expect(adj.mixStartSec).toBeCloseTo(60 / 0.9);
    expect(adj.mixEndSec).toBeCloseTo(80 / 0.9);
    expect(adj.rateOutgoing).toBeCloseTo(0.9);
    // The tempo-match flag is moot: B advances at bpmOut/bpmIn per
    // authored window second (both decks locked to the Set tempo).
    expect(adj.rateIncoming).toBeCloseTo(100 / 80);
    expect(adj.pitchIncomingPercent).toBeCloseTo(12.5);
    // No Tempo return under Fixed.
    expect(adj.tempoReturnEndSec).toBeCloseTo(adj.mixEndSec);
  });

  it('anchors the incoming at its own fixed rate after the window', () => {
    const plan = fixed();
    const b = 8 + 20 * (100 / 80); // 33, in B's track time
    const mixEnd = 80 / 0.9;
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(mixEnd - b / 1.125);
    expect(plan.totalSec).toBeCloseTo(mixEnd - b / 1.125 + 100 / 1.125);
  });

  it('planStateAt: constant per-deck pitch, window lanes on the authored axis', () => {
    const lanes = { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] };
    const plan = fixed({
      transitionsByUuid: { t1: tr({ tempoMatch: false, lanes }) },
    });
    const solo = planStateAt(plan, 30);
    expect(solo.decks.A.trackTime).toBeCloseTo(27); // 30 · 0.9
    expect(solo.decks.A.pitchPercent).toBeCloseTo(-10);
    // Authored window midpoint (outgoing time 70) at mix 70/0.9.
    const mid = planStateAt(plan, 70 / 0.9);
    expect(mid.decks.A.trackTime).toBeCloseTo(70);
    expect(mid.decks.B.trackTime).toBeCloseTo(8 + 10 * (100 / 80));
    expect(mid.decks.B.pitchPercent).toBeCloseTo(12.5);
    expect(mid.lanes.A.fader).toBeCloseTo(0.5); // authored x = 0.5
    const after = planStateAt(plan, 80 / 0.9 + 10);
    expect(after.decks.B.pitchPercent).toBeCloseTo(12.5); // holds the Set tempo
    expect(after.decks.B.trackTime).toBeCloseTo(
      (80 / 0.9 + 10 - plan.entries[1].mixOffsetSec) * 1.125
    );
  });

  it('hard-cuts scale too: cut at the outgoing end ÷ rate, incoming from its Main cue', () => {
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: null },
          { trackId: 2, pin: null },
        ],
        tracks: { 1: { ...facts(100), bpm: 100 }, 2: { ...facts(100, 20), bpm: 80 } },
        tempo: { policy: 'fixed', setTempoBpm: 90 },
      })
    );
    const cut = 100 / 0.9;
    expect(plan.adjacencies[0].mixStartSec).toBeCloseTo(cut);
    expect(plan.entries[1].entrySec).toBe(20);
    expect(plan.entries[1].entryMixSec).toBeCloseTo(cut);
    expect(plan.totalSec).toBeCloseTo(cut + 80 / 1.125);
  });

  it('defaults the Set tempo to the first track’s native BPM', () => {
    const plan = fixed({ tempo: { policy: 'fixed', setTempoBpm: null } });
    expect(plan.entries[0].rate).toBeCloseTo(1); // 100/100
    expect(plan.entries[1].rate).toBeCloseTo(1.25); // 100/80
  });

  it('plays BPM-less tracks at native rate and flags them', () => {
    const plan = fixed({
      tracks: { 1: { ...facts(100), bpm: 100 }, 2: { ...facts(100), bpm: null } },
    });
    expect(plan.entries[1].rate).toBe(1);
    expect(plan.warnings.some((w) => w.kind === 'no-bpm' && w.entryIndex === 1)).toBe(true);
  });

  it('clamps rates past the deck varispeed range and flags the entry', () => {
    const plan = fixed({
      tracks: { 1: { ...facts(100), bpm: 100 }, 2: { ...facts(100), bpm: 60 } },
    });
    // 90/60 → +50%, clamped to the decks' ±25%.
    expect(plan.entries[1].rate).toBeCloseTo(1.25);
    expect(plan.warnings.some((w) => w.kind === 'pitch-clamped' && w.entryIndex === 1)).toBe(true);
  });
});

// ── Grace fade (sets 14): overlapping windows and load latency ──────────

describe('grace fade (planner transform)', () => {
  /** Three tracks, rates 1 (Riding, no tempo match). Window 0 at mix
   * 60..80 (B in at 0 → track 2 anchored at 60). Window 1 authored at
   * track-2 time `start2`: its mix start is 60 + start2, and it needs
   * deck A — still occupied by track 1 until mix 80. grace 5s, fade 2s. */
  const threeTracks = (start2: number, over: Partial<PlanInput> = {}) =>
    planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
          { trackId: 3, pin: null },
        ],
        tracks: { 1: facts(100), 2: facts(200), 3: facts(100) },
        transitionsByUuid: {
          t1: tr({ startSec: 60, bInSec: 0, tempoMatch: false }),
          t2: tr({ startSec: start2, bInSec: 0, tempoMatch: false }),
        },
        grace: { headroomSec: 5, fadeSec: 2 },
        ...over,
      })
    );

  it('truncates the occupant grace seconds before the colliding window, with a synthesized fade', () => {
    // Window 1 opens at mix 82; deck A must be free by 77 (grace 5).
    const plan = threeTracks(22);
    const [e0] = plan.entries;
    expect(e0.exitMixSec).toBeCloseTo(77);
    expect(e0.exitSec).toBeCloseTo(77);
    expect(e0.graceFade).toBeDefined();
    expect(e0.graceFade!.fadeStartMixSec).toBeCloseTo(75);
    expect(e0.graceFade!.authoredExitSec).toBeCloseTo(80);
    expect(e0.graceFade!.authoredExitMixSec).toBeCloseTo(80);
    // Authored windows never shift.
    expect(plan.adjacencies[0].mixStartSec).toBeCloseTo(60);
    expect(plan.adjacencies[0].mixEndSec).toBeCloseTo(80);
    expect(plan.adjacencies[1].mixStartSec).toBeCloseTo(82);
    expect(plan.entries[1].entryMixSec).toBeCloseTo(60);
    expect(
      plan.warnings.some((w) => w.kind === 'grace-fade' && w.adjacencyIndex === 1)
    ).toBe(true);
  });

  it('planStateAt: the fade replaces the authored tail; the deck frees for the next entry', () => {
    const plan = threeTracks(22);
    // Mid-fade (75..77): the outgoing role-fader ramps from its authored
    // value (default faderA = 1) to 0.
    const midFade = planStateAt(plan, 76);
    expect(midFade.decks.A.playing).toBe(true);
    expect(midFade.lanes.A.fader).toBeCloseTo(0.5);
    // Past the truncated exit but inside the authored window: entry 0 is
    // done — deck A parks on entry 2 (the Conductor's load target) and
    // the dropped tail reads silent, not the authored faderA.
    const afterExit = planStateAt(plan, 78);
    expect(afterExit.decks.A.playing).toBe(false);
    expect(afterExit.decks.A.trackId).toBe(3);
    expect(afterExit.lanes.A.fader).toBe(0);
  });

  it('applies the same grace to a hard-cut outgoing (the cut instant never moves)', () => {
    // Track 1 plays out to a hard cut at mix 100; track 2's window opens
    // at track-2 time 2 → mix 102, needing deck A free by 97.
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: null },
          { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
          { trackId: 3, pin: null },
        ],
        tracks: { 1: facts(100), 2: facts(200), 3: facts(100) },
        transitionsByUuid: { t2: tr({ startSec: 2, bInSec: 0, tempoMatch: false }) },
        grace: { headroomSec: 5, fadeSec: 2 },
      })
    );
    const [e0, e1] = plan.entries;
    expect(e0.exitMixSec).toBeCloseTo(97);
    expect(e0.graceFade!.fadeStartMixSec).toBeCloseTo(95);
    // The cut instant is derived from the AUTHORED end — never shifted.
    expect(plan.adjacencies[0].mixStartSec).toBeCloseTo(100);
    expect(e1.entryMixSec).toBeCloseTo(100);
    // Solo fade: mid-fade the solo fader ramps 1 → 0.
    const midFade = planStateAt(plan, 96);
    expect(midFade.lanes.A.fader).toBeCloseTo(0.5);
    // The grace gap is silent (planned silence, not a stall).
    const gap = planStateAt(plan, 98.5);
    expect(gap.decks.A.playing).toBe(false);
    expect(gap.decks.B.playing).toBe(false);
  });

  it('floors at the entry window: degenerate pileups plan as-authored with an error flag', () => {
    // Four tracks; window 2 (needing deck B, entry 1's) opens at mix 83 —
    // freeing deck B by 78 would cut into entry 1's own entry window
    // (60..80): no heroics, plan as authored, flag an error.
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
          { trackId: 3, pin: { kind: 'transition', uuid: 't3' } },
          { trackId: 4, pin: null },
        ],
        tracks: { 1: facts(100), 2: facts(200), 3: facts(100), 4: facts(100) },
        transitionsByUuid: {
          t1: tr({ startSec: 60, bInSec: 0, tempoMatch: false }),
          t2: tr({ startSec: 22, bInSec: 0, tempoMatch: false }), // window mix 82..102
          t3: tr({ startSec: 1, bInSec: 0, tempoMatch: false }), // window mix 83..103
        },
        grace: { headroomSec: 5, fadeSec: 2 },
      })
    );
    const e1 = plan.entries[1];
    expect(e1.graceFade).toBeUndefined();
    expect(e1.exitMixSec).toBeCloseTo(102); // as authored
    expect(
      plan.warnings.some((w) => w.kind === 'grace-floor' && w.severity === 'error' && w.adjacencyIndex === 2)
    ).toBe(true);
  });

  it('replaces the window-overlap warning when the fade handles the collision', () => {
    // Window 2 at mix 92..112 overlaps window 1 (82..102): entry 1 is
    // truncated at 87 (grace) — the fade chip subsumes the overlap chip.
    const plan = planSet(
      input({
        entries: [
          { trackId: 1, pin: { kind: 'transition', uuid: 't1' } },
          { trackId: 2, pin: { kind: 'transition', uuid: 't2' } },
          { trackId: 3, pin: { kind: 'transition', uuid: 't3' } },
          { trackId: 4, pin: null },
        ],
        tracks: { 1: facts(100), 2: facts(200), 3: facts(100), 4: facts(100) },
        transitionsByUuid: {
          t1: tr({ startSec: 60, bInSec: 0, tempoMatch: false }),
          t2: tr({ startSec: 22, bInSec: 0, tempoMatch: false }), // window mix 82..102
          t3: tr({ startSec: 10, bInSec: 0, tempoMatch: false }), // window mix 92..112
        },
        grace: { headroomSec: 5, fadeSec: 2 },
      })
    );
    const e1 = plan.entries[1];
    expect(e1.exitMixSec).toBeCloseTo(87);
    expect(e1.exitSec).toBeCloseTo(27); // (87 − 60) at rate 1
    expect(e1.graceFade!.authoredExitSec).toBeCloseTo(42);
    expect(plan.warnings.some((w) => w.kind === 'grace-fade' && w.adjacencyIndex === 2)).toBe(true);
    expect(plan.warnings.some((w) => w.kind === 'window-overlap' && w.adjacencyIndex === 2)).toBe(
      false
    );
  });

  it('leaves non-colliding plans untouched', () => {
    // Window 1 opens at mix 150 — 70s of runway past track 1's exit.
    const plan = threeTracks(90);
    expect(plan.entries[0].graceFade).toBeUndefined();
    expect(plan.entries[0].exitMixSec).toBeCloseTo(80);
    expect(plan.warnings.some((w) => w.kind === 'grace-fade' || w.kind === 'grace-floor')).toBe(
      false
    );
  });
});
