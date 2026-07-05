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
import { planSet, type PlanInput } from './planner';

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
    const [adj] = plan.adjacencies;
    const rate = 100 / 96;
    expect(adj.pitchIncomingPercent).toBeCloseTo((rate - 1) * 100);
    expect(adj.rateIncoming).toBeCloseTo(rate);
    // B advances 20s of mix time at the matched rate: 8 + 20·rate.
    const bAtEnd = 8 + 20 * rate;
    // Post-window anchor is native-rate (Tempo v1 snap): time 0 at 80 − bAtEnd.
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(80 - bAtEnd);
    expect(plan.totalSec).toBeCloseTo(80 - bAtEnd + 100);
  });

  it('folds Jump events into the incoming anchor (deltas land at their instants)', () => {
    // +10s jump halfway through the window: B is 10s further along at the end.
    const plan = planSet(twoTracks(tr({ jumps: [{ x: 0.5, deltaSec: 10 }] })));
    // B at window end: 8 + 20 + 10 = 38 → time 0 at mix 80 − 38 = 42.
    expect(plan.entries[1].mixOffsetSec).toBeCloseTo(42);
  });

  it('warns when consecutive windows overlap and when a window starts past the outgoing end', () => {
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
    expect(overlapping.warnings.some((w) => w.includes('overlaps'))).toBe(true);

    const pastEnd = planSet(twoTracks(tr({ startSec: 95 })));
    expect(pastEnd.warnings.some((w) => w.includes('past the outgoing'))).toBe(true);
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
