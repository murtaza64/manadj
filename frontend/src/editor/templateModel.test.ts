/**
 * Transition-template model tests (mix-editor issue 03; anchor model
 * reworked in issue 28 — align-and-window).
 *
 * Pure seams: grid-origin backward extrapolation, anchor resolution
 * (cue → relative ladder → absolute convention → untouched), alignment +
 * window apply math (incl. negative/zero windows and the lead-in-
 * shrinking clamp), proportional scaling, save-time derivation order,
 * lane stripping, apply-target session logic.
 */
import { describe, expect, it } from 'vitest';
import type { BeatgridData } from '../types';
import { defaultMix } from './mixModel';
import type { Transition } from './mixModel';
import type { SavedTransition } from './pairStore';
import {
  applyTemplate,
  beatPeriodSec,
  defaultAnchorBase,
  defaultAnchorBaseB,
  deriveAlignment,
  gridOriginSec,
  resolveAnchorBase,
  scaleWindow,
  stampIntoSession,
  stripTemplateLanes,
} from './templateModel';
import type { TrackSideInfo, TransitionTemplate } from './templateModel';

function makeGrid(
  bpm = 120,
  startTime = 0,
  barPosition = 1,
  sig = 4
): BeatgridData {
  return {
    tempo_changes: [
      {
        start_time: startTime,
        bpm,
        time_signature_num: sig,
        time_signature_den: 4,
        bar_position: barPosition,
      },
    ],
    beat_times: [],
    downbeat_times: [],
  };
}

function side(
  grid: BeatgridData | null,
  cues: Record<number, number> = {}
): TrackSideInfo {
  return {
    beatgrid: grid,
    hotCues: Object.entries(cues).map(([slot, timeSec]) => ({
      slot: Number(slot),
      timeSec,
    })),
  };
}

function makeTemplate(overrides: Partial<TransitionTemplate> = {}): TransitionTemplate {
  return {
    uuid: 'tpl-1',
    name: 'bass swap',
    alignABase: 'cue_4',
    deltaBeats: 0,
    alignBBase: 'cue_4',
    beforeBeats: 32,
    afterBeats: 32,
    scalable: true,
    lanes: { eqLowA: [{ x: 0, y: 0.5 }, { x: 0.5, y: 0 }] },
    ...overrides,
  };
}

// Standard pair: A 120 BPM (period 0.5), B 126 BPM (period 60/126).
const PERIOD_A = 0.5;
const PERIOD_B = 60 / 126;
/** B's rate under tempo-match: plays at A's tempo. */
const RATE_B = 120 / 126;

// ── Grid origin ─────────────────────────────────────────────────────────

describe('gridOriginSec', () => {
  it('is the first mark when it is a downbeat at track start', () => {
    expect(gridOriginSec(makeGrid(120, 0, 1))).toBe(0);
  });

  it('extends backward when the true downbeat sits at track start (off-by-one trap)', () => {
    // period 0.5s; first mark at 0.5 labeled beat 2 → beat 1 extrapolates to 0.
    expect(gridOriginSec(makeGrid(120, 0.5, 2))).toBeCloseTo(0);
  });

  it('does not shift the origin when backward beats are non-downbeats', () => {
    // First mark at 0.5 labeled beat 1: the beat at 0 is beat 4 of the
    // previous bar — the origin stays at 0.5.
    expect(gridOriginSec(makeGrid(120, 0.5, 1))).toBeCloseTo(0.5);
  });

  it('walks a whole real bar back to the track start', () => {
    // First mark at 2.0 labeled downbeat; a full bar of audio precedes it.
    expect(gridOriginSec(makeGrid(120, 2.0, 1))).toBeCloseTo(0);
  });

  it('tolerates jitter within epsilon', () => {
    // 0.48 - 0.5 = -0.02 ≥ -0.05 → the extrapolated beat is real.
    expect(gridOriginSec(makeGrid(120, 0.48, 2))).toBeCloseTo(-0.02);
  });

  it('rejects extrapolated beats beyond epsilon', () => {
    // 0.4 - 0.5 = -0.1 < -0.05 → no backward beat; origin is the mark.
    expect(gridOriginSec(makeGrid(120, 0.4, 1))).toBeCloseTo(0.4);
  });
});

// ── Anchor base resolution ──────────────────────────────────────────────

describe('resolveAnchorBase', () => {
  it('uses the set cue directly', () => {
    const r = resolveAnchorBase('cue_4', side(makeGrid(), { 4: 64 }), 'B');
    expect(r).toEqual({ sec: 64 });
  });

  it('resolves grid_origin from the grid with no notice', () => {
    const r = resolveAnchorBase('grid_origin', side(makeGrid(120, 0.5, 2)), 'A');
    expect(r?.sec).toBeCloseTo(0);
    expect(r?.notice).toBeUndefined();
  });

  it('derives a missing ladder slot from the nearest set one (relative)', () => {
    // cue 3 = cue 4 − 8 bars.
    const r = resolveAnchorBase('cue_3', side(makeGrid(), { 4: 64 }), 'B');
    expect(r?.sec).toBeCloseTo(64 - 32 * PERIOD_A);
    expect(r?.notice).toMatch(/cue 3 missing on B/);
  });

  it('derives upward too (missing 4 from set 2)', () => {
    const r = resolveAnchorBase('cue_4', side(makeGrid(), { 2: 10 }), 'A');
    expect(r?.sec).toBeCloseTo(10 + 64 * PERIOD_A);
    expect(r?.notice).toMatch(/derived from cue 2/);
  });

  it('breaks nearest-slot ties toward the firmer (higher) rung', () => {
    // cue 3 is 32 beats from both 2 and 4 → prefer 4 (drop is firmest).
    const r = resolveAnchorBase('cue_3', side(makeGrid(), { 2: 10, 4: 60 }), 'B');
    expect(r?.sec).toBeCloseTo(60 - 32 * PERIOD_A);
    expect(r?.notice).toMatch(/derived from cue 4/);
  });

  it('falls back to the absolute convention position when no ladder cue is set', () => {
    const r = resolveAnchorBase('cue_4', side(makeGrid(120, 0, 1)), 'B');
    expect(r?.sec).toBeCloseTo(128 * PERIOD_A);
    expect(r?.notice).toMatch(/convention position \(beat 128\)/);
  });

  it('cannot resolve convention-less slots (5–8)', () => {
    expect(resolveAnchorBase('cue_5', side(makeGrid()), 'A')).toBeNull();
  });

  it('cannot resolve without a beatgrid (fallbacks need beats)', () => {
    expect(resolveAnchorBase('cue_4', side(null), 'A')).toBeNull();
    expect(resolveAnchorBase('grid_origin', side(null), 'A')).toBeNull();
  });

  it('still resolves a SET cue without a grid (no beat math needed)', () => {
    expect(resolveAnchorBase('cue_4', side(null, { 4: 64 }), 'A')).toEqual({ sec: 64 });
  });
});

// ── Window scaling ──────────────────────────────────────────────────────

describe('scaleWindow', () => {
  it('splits the chosen total proportionally, remainder to after', () => {
    expect(scaleWindow(32, 64, 48)).toEqual({ before: 16, after: 32 });
    expect(scaleWindow(32, 64, 192)).toEqual({ before: 64, after: 128 });
  });

  it('guarantees before + after ≡ chosen total under rounding', () => {
    const { before, after } = scaleWindow(3, 5, 4);
    expect(before + after).toBe(4);
  });

  it('scales free-signed windows', () => {
    // Anchor outside the window: shape preserved under halving.
    expect(scaleWindow(-8, 40, 16)).toEqual({ before: -4, after: 20 });
  });

  it('ignores the override on zero-length templates (no shape to keep)', () => {
    expect(scaleWindow(0, 0, 64)).toEqual({ before: 0, after: 0 });
  });
});

// ── Apply ───────────────────────────────────────────────────────────────

describe('applyTemplate', () => {
  const gridA = makeGrid(120);
  const gridB = makeGrid(126);

  it('lands the canonical move: drops aligned, blend 32 before, ride 32 after', () => {
    const a = side(gridA, { 4: 64 });
    const b = side(gridB, { 4: 30 });
    const { patch, notices } = applyTemplate(makeTemplate(), { a, b });
    // Alignment instant = A's cue 4 (+ delta 0) = 64.
    expect(patch.startSec).toBeCloseTo(64 - 32 * PERIOD_A);
    expect(patch.durationSec).toBeCloseTo(64 * PERIOD_A);
    // B's anchor lands on the instant: bInSec = anchor − before B-beats.
    expect(patch.bInSec).toBeCloseTo(30 - 32 * PERIOD_B);
    expect(patch.tempoMatch).toBe(true);
    expect(patch.lanes).toEqual(makeTemplate().lanes);
    expect(patch.lanes).not.toBe(makeTemplate().lanes); // cloned
    expect(patch.hiddenLanes).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('applies the delta on A\'s grid (phrase-offset alignment)', () => {
    const { patch } = applyTemplate(
      makeTemplate({ deltaBeats: 16 }),
      { a: side(gridA, { 4: 64 }), b: side(gridB, { 4: 30 }) }
    );
    // Instant = 64 + 16·0.5 = 72.
    expect(patch.startSec).toBeCloseTo(72 - 32 * PERIOD_A);
    expect(patch.bInSec).toBeCloseTo(30 - 32 * PERIOD_B);
  });

  it('scales proportionally at an apply-time total', () => {
    const { patch } = applyTemplate(
      makeTemplate(),
      { a: side(gridA, { 4: 64 }), b: side(gridB, { 4: 30 }) },
      32
    );
    // 32/32 at total 32 → 16/16: window hugs the anchor tighter.
    expect(patch.startSec).toBeCloseTo(64 - 16 * PERIOD_A);
    expect(patch.durationSec).toBeCloseTo(32 * PERIOD_A);
    expect(patch.bInSec).toBeCloseTo(30 - 16 * PERIOD_B);
  });

  it('supports a negative after (window ends before the anchor)', () => {
    const { patch } = applyTemplate(
      makeTemplate({ beforeBeats: 32, afterBeats: -8, scalable: false }),
      { a: side(gridA, { 4: 64 }), b: side(gridB, { 4: 30 }) }
    );
    expect(patch.startSec).toBeCloseTo(64 - 32 * PERIOD_A);
    expect(patch.durationSec).toBeCloseTo(24 * PERIOD_A);
  });

  it('zero-length template = hard cut AT the anchor', () => {
    const { patch } = applyTemplate(
      makeTemplate({ beforeBeats: 0, afterBeats: 0, scalable: false }),
      { a: side(gridA, { 4: 64 }), b: side(gridB, { 4: 30 }) }
    );
    expect(patch.startSec).toBeCloseTo(64);
    expect(patch.durationSec).toBe(0);
    expect(patch.bInSec).toBeCloseTo(30);
  });

  it('clamp shrinks the lead-in, preserving alignment and tail', () => {
    // A's cue 1 at 0.5s, before 32 → raw start −15.5s. The lead-in
    // shrinks to 1 beat; the alignment instant and after-length hold.
    const { patch, notices } = applyTemplate(
      makeTemplate({ alignABase: 'cue_1', beforeBeats: 32 }),
      { a: side(gridA, { 1: 0.5 }), b: side(gridB, { 4: 30 }) }
    );
    expect(patch.startSec).toBe(0);
    expect(patch.durationSec).toBeCloseTo((1 + 32) * PERIOD_A);
    // B's anchor still lands on the instant: bIn + (instant − start)·rateB = anchor.
    expect(patch.bInSec! + 0.5 * RATE_B).toBeCloseTo(30);
    expect(notices.some((n) => /lead-in shortened/.test(n))).toBe(true);
  });

  it('stamps anchors via fallbacks with notices', () => {
    const { patch, notices } = applyTemplate(makeTemplate(), {
      a: side(gridA, { 4: 64 }),
      b: side(gridB, { 2: 30 }), // cue 4 missing; derive from cue 2 (+64 beats)
    });
    expect(patch.bInSec).toBeCloseTo(30 + 64 * PERIOD_B - 32 * PERIOD_B);
    expect(notices.some((n) => /cue 4 missing on B/.test(n))).toBe(true);
  });

  it('leaves BOTH anchors untouched when one side fails (all-or-nothing)', () => {
    const { patch, notices } = applyTemplate(
      makeTemplate({ alignBBase: 'cue_5' }),
      { a: side(gridA, { 4: 64 }), b: side(gridB) }
    );
    expect(patch.startSec).toBeUndefined();
    expect(patch.bInSec).toBeUndefined();
    expect(patch.durationSec).toBeCloseTo(64 * PERIOD_A); // length still stamps
    expect(patch.lanes).toBeDefined();
    expect(notices.some((n) => /anchors unchanged/.test(n))).toBe(true);
  });

  it('missing B grid: anchors untouched, duration still stamps', () => {
    const { patch, notices } = applyTemplate(makeTemplate(), {
      a: side(gridA, { 4: 64 }),
      b: side(null),
    });
    expect(patch.startSec).toBeUndefined();
    expect(patch.bInSec).toBeUndefined();
    expect(patch.durationSec).toBeCloseTo(64 * PERIOD_A);
    expect(notices.length).toBeGreaterThan(0);
  });

  it('missing A grid degrades further: duration untouched too, lanes still stamp', () => {
    const { patch, notices } = applyTemplate(makeTemplate(), {
      a: side(null, { 4: 64 }),
      b: side(gridB, { 4: 30 }),
    });
    expect(patch.durationSec).toBeUndefined();
    expect(patch.startSec).toBeUndefined();
    expect(patch.lanes).toBeDefined();
    expect(patch.tempoMatch).toBe(true);
    expect(notices.some((n) => /beatgrid/.test(n))).toBe(true);
  });

  it('negative bInSec is first-class (silent lead gap), no clamp, no notice', () => {
    // B's drop 10 B-beats in, before 32 → negative entry anchor.
    const { patch, notices } = applyTemplate(makeTemplate(), {
      a: side(gridA, { 4: 64 }),
      b: side(gridB, { 4: 10 * PERIOD_B }),
    });
    expect(patch.bInSec).toBeCloseTo((10 - 32) * PERIOD_B);
    expect(notices).toEqual([]);
  });
});

// ── Derivation (save-time) ──────────────────────────────────────────────

describe('deriveAlignment', () => {
  const gridA = makeGrid(120);
  const gridB = makeGrid(126);

  it('round-trips the canonical apply', () => {
    const a = side(gridA, { 4: 64 });
    const b = side(gridB, { 4: 30 });
    const { patch } = applyTemplate(makeTemplate(), { a, b });
    const tr = { startSec: patch.startSec!, durationSec: patch.durationSec!, bInSec: patch.bInSec! };
    const d = deriveAlignment(tr, RATE_B, 'cue_4', 'cue_4', a, b);
    expect(d).toEqual({ deltaBeats: 0, beforeBeats: 32, afterBeats: 32 });
  });

  it('derives in the honest order: total first, after as remainder', () => {
    // Slightly off-grid drawing: duration 32.2s (64.4 beats → 64),
    // instant 0.6 beats from window start... everything whole-beat rounds
    // but before + after must equal the rounded total exactly.
    const a = side(gridA, { 4: 64 });
    const b = side(gridB, { 4: 30 });
    const tr = { startSec: 48.2, durationSec: 32.2, bInSec: 30 - ((64 - 48.2) / PERIOD_A) * PERIOD_B };
    const d = deriveAlignment(tr, RATE_B, 'cue_4', 'cue_4', a, b)!;
    expect(d.beforeBeats + d.afterBeats).toBe(Math.round(32.2 / PERIOD_A));
  });

  it('the delta absorbs the alignment offset from A\'s base', () => {
    const a = side(gridA, { 1: 10, 4: 64 });
    const b = side(gridB, { 4: 30 });
    const { patch } = applyTemplate(makeTemplate({ deltaBeats: 16 }), { a, b });
    const tr = { startSec: patch.startSec!, durationSec: patch.durationSec!, bInSec: patch.bInSec! };
    expect(deriveAlignment(tr, RATE_B, 'cue_4', 'cue_4', a, b)?.deltaBeats).toBe(16);
    // Same drawing, anchored to A's cue 1 instead: delta re-derives.
    expect(deriveAlignment(tr, RATE_B, 'cue_1', 'cue_4', a, b)?.deltaBeats).toBe(
      16 + Math.round((64 - 10) / PERIOD_A)
    );
  });

  it('is null when a base cannot resolve for saving (no fallbacks at save time)', () => {
    const a = side(gridA, { 4: 64 });
    const b = side(gridB, { 4: 30 });
    const tr = { startSec: 48, durationSec: 32, bInSec: 15 };
    expect(deriveAlignment(tr, RATE_B, 'cue_5', 'cue_4', a, b)).toBeNull(); // unset A cue
    expect(deriveAlignment(tr, RATE_B, 'cue_4', 'cue_2', a, b)).toBeNull(); // unset B cue
    expect(deriveAlignment(tr, RATE_B, 'cue_4', 'cue_4', side(null, { 4: 64 }), b)).toBeNull();
  });
});

describe('stripTemplateLanes', () => {
  const tr = (lanes: Transition['lanes'], hidden?: Transition['hiddenLanes']): Transition => ({
    startSec: 30,
    durationSec: 20,
    bInSec: 0,
    tempoMatch: true,
    lanes,
    hiddenLanes: hidden,
  });

  it('keeps drawn lanes', () => {
    const drawn = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    expect(stripTemplateLanes(tr({ faderA: drawn }))).toEqual({ faderA: drawn });
  });

  it('drops hidden lanes (author dismissed them)', () => {
    const drawn = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    expect(
      stripTemplateLanes(tr({ faderA: drawn, filterA: drawn }, ['filterA']))
    ).toEqual({ faderA: drawn });
  });

  it('drops lanes that still equal their default shape (added, never touched)', () => {
    // eqLowA default: [{x:0,y:0.5}]; faderB default ramps over 2s of a 20s window.
    expect(
      stripTemplateLanes(
        tr({
          eqLowA: [{ x: 0, y: 0.5 }],
          faderB: [{ x: 0, y: 0 }, { x: 0.1, y: 1 }],
        })
      )
    ).toEqual({});
  });

  it('drops empty arrays', () => {
    expect(stripTemplateLanes(tr({ faderA: [] }))).toEqual({});
  });
});

describe('defaultAnchorBase (A side)', () => {
  it('picks the set cue nearest the anchor point', () => {
    const s = side(makeGrid(), { 1: 10, 4: 64 });
    expect(defaultAnchorBase(60, s)).toBe('cue_4');
    expect(defaultAnchorBase(12, s)).toBe('cue_1');
  });

  it('falls back to grid_origin when no cues are set', () => {
    expect(defaultAnchorBase(60, side(makeGrid()))).toBe('grid_origin');
  });
});

describe('defaultAnchorBaseB (mix-in default)', () => {
  const tr = { durationSec: 20, bInSec: 10 };
  // B's window span: [10, 10 + 20·RATE_B].

  it('picks the EARLIEST set cue inside B\'s window span', () => {
    const s = side(makeGrid(126), { 2: 12, 4: 20, 1: 5 });
    expect(defaultAnchorBaseB(tr, RATE_B, s)).toBe('cue_2');
  });

  it('falls back to the nearest cue to the span midpoint when none is inside', () => {
    const s = side(makeGrid(126), { 1: 5, 4: 200 });
    expect(defaultAnchorBaseB(tr, RATE_B, s)).toBe('cue_1');
  });

  it('falls back to grid_origin with no cues', () => {
    expect(defaultAnchorBaseB(tr, RATE_B, side(makeGrid(126)))).toBe('grid_origin');
  });
});

describe('beatPeriodSec', () => {
  it('reads the first tempo change', () => {
    expect(beatPeriodSec(makeGrid(120))).toBeCloseTo(0.5);
  });
});

describe('stampIntoSession (apply target)', () => {
  const patch = {
    tempoMatch: true as const,
    lanes: { eqLowA: [{ x: 0, y: 0.5 }] },
    hiddenLanes: [],
    startSec: 80,
    durationSec: 32,
    bInSec: 14.7,
  };

  const pristineItem = (name = 'Transition 1'): SavedTransition => ({
    uuid: `u${name}`,
    name,
    transition: defaultMix().transition,
  });

  const editedItem = (name = 'hand-drawn'): SavedTransition => ({
    uuid: `u${name}`,
    name,
    transition: { ...defaultMix().transition, startSec: 12 },
  });

  it('stamps a pristine active Transition in place and renames it', () => {
    const items = [pristineItem()];
    const next = stampIntoSession(items, 0, 'bass swap', patch);
    expect(next.active).toBe(0);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].uuid).toBe(items[0].uuid); // same identity
    expect(next.items[0].name).toBe('bass swap');
    expect(next.items[0].transition.startSec).toBe(80);
    expect(next.items[0].transition.hiddenLanes).toEqual([]);
  });

  it('creates a NEW Transition when the active one has real edits', () => {
    const items = [editedItem()];
    const next = stampIntoSession(items, 0, 'bass swap', patch);
    expect(next.items).toHaveLength(2);
    expect(next.active).toBe(1);
    expect(next.items[0]).toEqual(items[0]); // hand-drawn work untouched
    expect(next.items[1].name).toBe('bass swap');
    expect(next.items[1].uuid).not.toBe(items[0].uuid);
    expect(next.items[1].transition.bInSec).toBeCloseTo(14.7);
  });

  it('a partial patch (unresolved anchors) leaves the receiver defaults', () => {
    const partial = { tempoMatch: true as const, lanes: {}, hiddenLanes: [] };
    const next = stampIntoSession([pristineItem()], 0, 'bass swap', partial);
    const d = defaultMix().transition;
    expect(next.items[0].transition.startSec).toBe(d.startSec);
    expect(next.items[0].transition.bInSec).toBe(d.bInSec);
  });
});
