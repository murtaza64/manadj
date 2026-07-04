/**
 * Transition-template model tests (mix-editor issue 03).
 *
 * Pure seams: grid-origin backward extrapolation, anchor resolution
 * (cue → relative ladder → absolute convention → untouched), beats →
 * seconds translation, lane stripping, and apply/derive round-trips.
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
  deriveAnchorDeltaBeats,
  deriveLengthBeats,
  gridOriginSec,
  resolveAnchorBase,
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
    alignA: { base: 'cue_4', deltaBeats: 32 },
    alignB: { base: 'cue_4', deltaBeats: -32 },
    lengthBeats: 64,
    scalable: true,
    lanes: { eqLowA: [{ x: 0, y: 0.5 }, { x: 0.5, y: 0 }] },
    ...overrides,
  };
}

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
  const period = 0.5; // 120 BPM

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
    expect(r?.sec).toBeCloseTo(64 - 32 * period);
    expect(r?.notice).toMatch(/cue 3 missing on B/);
  });

  it('derives upward too (missing 4 from set 2)', () => {
    const r = resolveAnchorBase('cue_4', side(makeGrid(), { 2: 10 }), 'A');
    expect(r?.sec).toBeCloseTo(10 + 64 * period);
    expect(r?.notice).toMatch(/derived from cue 2/);
  });

  it('breaks nearest-slot ties toward the firmer (higher) rung', () => {
    // cue 3 is 32 beats from both 2 and 4 → prefer 4 (drop is firmest).
    const r = resolveAnchorBase('cue_3', side(makeGrid(), { 2: 10, 4: 60 }), 'B');
    expect(r?.sec).toBeCloseTo(60 - 32 * period);
    expect(r?.notice).toMatch(/derived from cue 4/);
  });

  it('falls back to the absolute convention position when no ladder cue is set', () => {
    const grid = makeGrid(120, 0, 1);
    const r = resolveAnchorBase('cue_4', side(grid), 'B');
    expect(r?.sec).toBeCloseTo(128 * period);
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

// ── Apply ───────────────────────────────────────────────────────────────

describe('applyTemplate', () => {
  const gridA = makeGrid(120); // period 0.5
  const gridB = makeGrid(126); // period 60/126

  it('lands the PRD worked example: drop alignment with 32-beat lead-in', () => {
    const a = side(gridA, { 4: 64 });
    const b = side(gridB, { 4: 30 });
    const { patch, notices } = applyTemplate(makeTemplate(), { a, b });
    // startSec = A-local time of alignA = cueA4 + 32 A-beats.
    expect(patch.startSec).toBeCloseTo(64 + 32 * 0.5);
    // bInSec = B-local time of alignB = cueB4 − 32 B-beats.
    expect(patch.bInSec).toBeCloseTo(30 - 32 * (60 / 126));
    // duration = lengthBeats in A-beats (mix time ≡ A time).
    expect(patch.durationSec).toBeCloseTo(64 * 0.5);
    expect(patch.tempoMatch).toBe(true);
    expect(patch.lanes).toEqual(makeTemplate().lanes);
    expect(patch.lanes).not.toBe(makeTemplate().lanes); // cloned
    expect(patch.hiddenLanes).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('scales at an apply-time beat count', () => {
    const { patch } = applyTemplate(
      makeTemplate(),
      { a: side(gridA, { 4: 64 }), b: side(gridB, { 4: 30 }) },
      32
    );
    expect(patch.durationSec).toBeCloseTo(32 * 0.5);
  });

  it('stamps anchors via fallbacks with notices', () => {
    const { patch, notices } = applyTemplate(makeTemplate(), {
      a: side(gridA, { 4: 64 }),
      b: side(gridB, { 2: 30 }), // cue 4 missing; derive from cue 2 (+64 beats)
    });
    expect(patch.bInSec).toBeCloseTo(30 + 64 * (60 / 126) - 32 * (60 / 126));
    expect(notices.some((n) => /cue 4 missing on B/.test(n))).toBe(true);
  });

  it('leaves BOTH anchors untouched when one side fails (all-or-nothing)', () => {
    const { patch, notices } = applyTemplate(
      makeTemplate({ alignB: { base: 'cue_5', deltaBeats: 0 } }),
      { a: side(gridA, { 4: 64 }), b: side(gridB) }
    );
    expect(patch.startSec).toBeUndefined();
    expect(patch.bInSec).toBeUndefined();
    expect(patch.durationSec).toBeCloseTo(32); // length still stamps (A grid exists)
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
    expect(patch.durationSec).toBeCloseTo(32);
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

  it('clamps startSec at 0 with a notice (the model clamp)', () => {
    // cue 1 at 0.5s, delta −32 beats → −15.5s → clamp.
    const { patch, notices } = applyTemplate(
      makeTemplate({ alignA: { base: 'cue_1', deltaBeats: -32 } }),
      { a: side(gridA, { 1: 0.5 }), b: side(gridB, { 4: 30 }) }
    );
    expect(patch.startSec).toBe(0);
    expect(notices.some((n) => /clamped/.test(n))).toBe(true);
  });

  it('negative bInSec is first-class (silent lead gap), no clamp, no notice', () => {
    // B's drop 10 beats in, delta −32 → negative entry anchor.
    const { patch, notices } = applyTemplate(makeTemplate(), {
      a: side(gridA, { 4: 64 }),
      b: side(gridB, { 4: 10 * (60 / 126) }),
    });
    expect(patch.bInSec).toBeCloseTo((10 - 32) * (60 / 126));
    expect(notices).toEqual([]);
  });
});

// ── Derivation (save-time) ──────────────────────────────────────────────

describe('deriveAnchorDeltaBeats', () => {
  it('rounds the delta to whole beats of the side\'s own grid', () => {
    // anchor 40.1, cue at 32.0, period 0.5 → 16.2 → 16.
    const r = deriveAnchorDeltaBeats(40.1, 'cue_4', side(makeGrid(), { 4: 32 }));
    expect(r).toBe(16);
  });

  it('derives against grid origin', () => {
    const r = deriveAnchorDeltaBeats(4.0, 'grid_origin', side(makeGrid(120, 0.5, 2)));
    expect(r).toBe(8); // origin 0, period 0.5
  });

  it('is null when the base cannot resolve for saving (no fallbacks at save time)', () => {
    // A save-time fallback would bake a weaker anchor into the recipe
    // permanently — only set cues and the grid origin qualify.
    expect(deriveAnchorDeltaBeats(4.0, 'cue_4', side(makeGrid()))).toBeNull();
    expect(deriveAnchorDeltaBeats(4.0, 'cue_5', side(makeGrid()))).toBeNull();
    expect(deriveAnchorDeltaBeats(4.0, 'cue_4', side(null))).toBeNull();
  });
});

describe('deriveLengthBeats', () => {
  it('measures the window in whole A-beats', () => {
    expect(deriveLengthBeats(20, makeGrid(120))).toBe(40);
    expect(deriveLengthBeats(20.2, makeGrid(120))).toBe(40);
  });

  it('never returns less than 0', () => {
    expect(deriveLengthBeats(0, makeGrid(120))).toBe(0);
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

describe('defaultAnchorBase', () => {
  it('picks the set cue nearest the anchor point', () => {
    const s = side(makeGrid(), { 1: 10, 4: 64 });
    expect(defaultAnchorBase(60, s)).toBe('cue_4');
    expect(defaultAnchorBase(12, s)).toBe('cue_1');
  });

  it('falls back to grid_origin when no cues are set', () => {
    expect(defaultAnchorBase(60, side(makeGrid()))).toBe('grid_origin');
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
