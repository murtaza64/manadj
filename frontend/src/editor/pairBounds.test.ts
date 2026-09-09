import { expect, it } from 'vitest';
import { normalizePairWindow, pairAuthoringTransition, pairBounds } from './pairBounds';
import { aTrackTimeAt, bTrackTimeAt, laneValuesAt, type Transition } from './mixModel';
import { jumpCrossedDecks, planSet, planStateAtRaw } from '../sets/planner';
import type { PlanInput } from '../sets/planner';
import { mixTimeForTrackTime } from '../sets/pickup';
import { authoredPlayheadAt } from '../sets/replan';
import { transitionToProjection } from './pairSlotTranslation';
import { buildEditorRoutine } from '../routines/routineEditorModel';
import { routineSlotStateAt } from '../sets/routinePlan';

const tr: Transition = {
  startSec: 60, durationSec: 20, bInSec: 8, tempoMatch: false, lanes: {},
};

it('does not call a much later incoming restart a survivor of the handover', () => {
  const transition: Transition = { ...tr, lanes: {
    faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }],
    faderB: [{ x: 0, y: 1 }, { x: 0.5, y: 1 }, { x: 0.5, y: 0 },
      { x: 4, y: 0 }, { x: 4, y: 1 }],
  } };
  expect(pairBounds(transition, { a: 180, b: 300 }, 1).handover).toBeNull();
});

it('keeps a hidden incoming default fade on its original clock when outgoing content expands left', () => {
  const stash = [{ x: 0.25, y: 0.8 }, { x: 0.75, y: 0.3 }];
  const source: Transition = { ...tr, hiddenLanes: ['faderB'], lanes: {
    faderA: [{ x: -0.5, y: 1 }, { x: 1, y: 0 }], faderB: stash,
  } };
  const normalized = pairAuthoringTransition(source, 1);
  expect(normalized.hiddenLanes).toEqual(['faderB']);
  for (const t of [50, 52, 59, 60, 61, 62, 70])
    expect(laneValuesAt(normalized, t).faderB).toBeCloseTo(laneValuesAt(source, t).faderB);
  expect(normalized.lanes.faderB!.map((p) => [normalized.startSec + p.x * normalized.durationSec, p.y]))
    .toEqual([[65, 0.8], [75, 0.3]]);
  expect(pairBounds(normalized, { a: 180, b: 240 }, 1).handover?.enter).toBe(60);
});

it('projects a jump at the widened frame start without applying it before its instant', () => {
  const transition = pairAuthoringTransition({ ...tr, jumpsA: [{ x: -0.5, deltaSec: -4 }] }, 1);
  const p = transitionToProjection({ uuid: 'initial-jump', name: 'Pair', transition,
    trackAId: 1, trackBId: 2, bpmA: 120, bpmB: 120, durations: { a: 180, b: 240 } });
  const r = buildEditorRoutine(p.detail, p.trackBpms, p.targetBpm, p.edits).planned;
  for (const [globalTime, expected] of [[40, 40], [49.9, 49.9], [50, 46], [61, 57]]) {
    const s = routineSlotStateAt(r, r.slots[0], globalTime - transition.startSec);
    expect(s.trackTime).toBeCloseTo(expected);
    expect(s.playing).toBe(true);
  }
});

it('anchors an overlapping next handover on the actual incoming trajectory', () => {
  const plan = planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'ab' } },
      { trackId: 2, pin: { kind: 'transition', uuid: 'bc' } }, { trackId: 3, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 300, bpm: 100, hotCue1Sec: null }, 3: { durationSec: 300, bpm: 100, hotCue1Sec: null } },
    transitionsByUuid: {
      ab: { ...tr, bInSec: 0, tempoMatch: true },
      bc: { ...tr, startSec: 100, bInSec: 0, lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
    }, takesByUuid: {},
  });
  const start = plan.adjacencies[1].mixStartSec;
  expect(start).toBeCloseTo(60 + 100 / 1.2);
  expect(authoredPlayheadAt(plan, 100, 'ab')).toBe(100);
  expect(planStateAtRaw(plan, start - 1e-6).decks.B.trackTime).toBeCloseTo(100, 5);
  expect(planStateAtRaw(plan, start).decks.B.trackTime).toBeCloseTo(100);
  const end = plan.entries[1].exitMixSec;
  expect(planStateAtRaw(plan, end - 1e-6).decks.B.trackTime).toBeCloseTo(120, 5);
  expect(planStateAtRaw(plan, end).decks.B.playing).toBe(false);
});

it.each([false, true])('does not seek backward to a skipped next anchor (later return: %s)', (returns) => {
  const input: PlanInput = {
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'ab' } },
      { trackId: 2, pin: { kind: 'transition', uuid: 'bc' } }, { trackId: 3, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 300, bpm: 120, hotCue1Sec: null }, 3: { durationSec: 300, bpm: 120, hotCue1Sec: null } },
    transitionsByUuid: {
      ab: { ...tr, bInSec: 0, jumps: [{ x: 1.5, deltaSec: 30 }, ...(returns ? [{ x: 2, deltaSec: -30 }] : [])],
        lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
      bc: { ...tr, startSec: 50, bInSec: 0, lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
    }, takesByUuid: {},
  };
  const plan = planSet(input);
  const expectedPosition = returns ? 50 : 80;
  expect(planStateAtRaw(plan, 110 - 1e-6).decks.B.trackTime).toBeCloseTo(expectedPosition, 5);
  expect(planStateAtRaw(plan, 110).decks.B.trackTime).toBeCloseTo(expectedPosition);
  expect(jumpCrossedDecks(plan, 109.9, 110.1)).toEqual([]);
  expect(jumpCrossedDecks(plan, 89.9, 90.1)).toEqual(['B']);
  if (returns) {
    expect(plan.adjacencies[1].kind).toBe('transition');
    expect(plan.adjacencies[1].mixStartSec).toBe(110);
    expect(plan.warnings.some((w) => w.kind === 'unreachable-transition-anchor')).toBe(false);
  } else {
    expect(plan.adjacencies[1].kind).toBe('hardcut');
    expect(plan.adjacencies[1].mixStartSec).toBe(330); // B reaches its natural 300s EOF
    expect(plan.entries[1].exitMixSec).toBe(330);
    expect(planStateAtRaw(plan, 329.9).decks.B.trackTime).toBeCloseTo(299.9);
    expect(plan.warnings).toContainEqual(expect.objectContaining({
      kind: 'unreachable-transition-anchor', severity: 'warning', adjacencyIndex: 1,
      message: expect.stringContaining('50'),
    }));
  }
  expect(input.entries[1].pin).toEqual({ kind: 'transition', uuid: 'bc' });
  expect(input.transitionsByUuid.bc.startSec).toBe(50);
});

it('removes the unreachable pin from tempo-runway constraints when degrading to a hard cut', () => {
  const plan = planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'ab' } },
      { trackId: 2, pin: { kind: 'transition', uuid: 'bc' } }, { trackId: 3, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 300, bpm: 100, hotCue1Sec: null }, 3: { durationSec: 300, bpm: 120, hotCue1Sec: null } },
    transitionsByUuid: {
      ab: { ...tr, bInSec: 0, tempoMatch: true, jumps: [{ x: 1.5, deltaSec: 30 }],
        lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
      bc: { ...tr, startSec: 50, bInSec: 0, lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
    }, takesByUuid: {},
  });
  expect(plan.adjacencies[0].tempoReturnEndSec).toBeCloseTo(120);
  expect(planStateAtRaw(plan, 100).decks.B.trackTime).toBeCloseTo(77);
  expect(plan.adjacencies[1].kind).toBe('hardcut');
  expect(plan.adjacencies[1].mixStartSec).toBeCloseTo(322);
  expect(plan.warnings.some((w) => w.kind === 'insufficient-runway')).toBe(false);
  expect(plan.warnings.filter((w) => w.kind === 'unreachable-transition-anchor')).toHaveLength(1);
});

it('keeps handover tempo independent of hidden authoring content', () => {
  const source: Transition = { ...tr, bInSec: 0, tempoMatch: true,
    lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } };
  const build = (transition: Transition) => planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'ab' } }, { trackId: 2, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 300, bpm: 100, hotCue1Sec: null } },
    transitionsByUuid: { ab: transition }, takesByUuid: {},
  });
  const plain = build(source);
  const retained = build({ ...source, hiddenLanes: ['filterA'],
    lanes: { ...source.lanes, filterA: [{ x: 10, y: 0.5 }] } });
  for (const plan of [plain, retained]) {
    expect(plan.adjacencies[0].mixEndSec).toBe(80);
    expect(plan.adjacencies[0].tempoReturnEndSec).toBeCloseTo(120);
    expect(planStateAtRaw(plan, 100).decks.B.pitchPercent).toBeCloseTo(10);
    expect(plan.totalSec).toBeCloseTo(352);
  }
});

it('anchors after repeated incoming material and transfers transport authority without a pitch discontinuity', () => {
  const plan = planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'ab' } },
      { trackId: 2, pin: { kind: 'transition', uuid: 'bc' } }, { trackId: 3, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 300, bpm: 100, hotCue1Sec: null }, 3: { durationSec: 300, bpm: 100, hotCue1Sec: null } },
    transitionsByUuid: {
      ab: { ...tr, bInSec: 0, tempoMatch: true, jumps: [{ x: 3.5, deltaSec: -12, count: 3 }] },
      bc: { ...tr, startSec: 100, bInSec: 0, lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
    }, takesByUuid: {},
  });
  expect(plan.adjacencies[1].mixStartSec).toBeCloseTo(173.3333333333);
  expect(plan.entries[1].exitMixSec).toBeCloseTo(190);
  for (const [t, pos] of [[173.3333333333, 100], [180, 108], [185, 114]]) {
    expect(planStateAtRaw(plan, t).decks.B.trackTime).toBeCloseTo(pos);
    expect(planStateAtRaw(plan, t).decks.B.pitchPercent).toBeCloseTo(20);
  }
  expect(jumpCrossedDecks(plan, 139.9, 140.1)).toEqual(['B']);
  expect(jumpCrossedDecks(plan, 149.9, 150.1)).toEqual(['B']);
});

it('preserves incoming post-handover jumps and lane times while tempo returns', () => {
  const source: Transition = { ...tr, bInSec: 0, tempoMatch: true,
    jumps: [{ x: 2, deltaSec: -10 }],
    lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }], eqLowB: [{ x: 1, y: 0.5 }, { x: 2, y: 0.2 }] } };
  for (const hidden of [false, true]) {
    const transition = hidden ? { ...source, hiddenLanes: ['filterA' as const],
      lanes: { ...source.lanes, filterA: [{ x: 10, y: 0.5 }] } } : source;
    const plan = planSet({
      entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'ab' } }, { trackId: 2, pin: null }],
      tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null }, 2: { durationSec: 300, bpm: 100, hotCue1Sec: null } },
      transitionsByUuid: { ab: transition }, takesByUuid: {},
    });
    expect(planStateAtRaw(plan, 100 - 1e-6).decks.B.trackTime).toBeCloseTo(47, 5);
    expect(planStateAtRaw(plan, 100).decks.B.trackTime).toBeCloseTo(37);
    expect(planStateAtRaw(plan, 120).decks.B.trackTime).toBeCloseTo(58);
    expect(planStateAtRaw(plan, 100).lanes.B.eq.low).toBeCloseTo(0.2);
    expect(plan.totalSec).toBeCloseTo(362);
    expect(mixTimeForTrackTime(plan, 1, 58)).toBeCloseTo(120);
    expect(jumpCrossedDecks(plan, 99.9, 100.1)).toEqual(['B']);
  }
});

it('adopts the instantaneous return-ramp rate when a jump brings the next anchor forward', () => {
  const plan = planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'ab' } },
      { trackId: 2, pin: { kind: 'transition', uuid: 'bc' } }, { trackId: 3, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 300, bpm: 100, hotCue1Sec: null }, 3: { durationSec: 300, bpm: 100, hotCue1Sec: null } },
    transitionsByUuid: {
      ab: { ...tr, bInSec: 0, tempoMatch: true, jumps: [{ x: 1.5, deltaSec: 50 }],
        lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
      bc: { ...tr, startSec: 100, bInSec: 0, lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } },
    }, takesByUuid: {},
  });
  const start = plan.adjacencies[1].mixStartSec;
  expect(start).toBeCloseTo(102.744390175996, 8);
  expect(planStateAtRaw(plan, start - 1e-6).decks.B.trackTime).toBeCloseTo(100, 5);
  expect(planStateAtRaw(plan, start).decks.B.trackTime).toBeCloseTo(100);
  expect(planStateAtRaw(plan, start + 1).decks.B.trackTime).toBeCloseTo(101.08627804912);
  expect(mixTimeForTrackTime(plan, 1, 101.08627804912)).toBeCloseTo(start + 1);
});

it('full-open outgoing ends at natural EOF, not the saved EXIT', () => {
  expect(pairBounds(tr, { a: 180, b: 240 }, 1).handover).toEqual({ enter: 60, exit: 180 });
});

it('folds outgoing cross-cut returns and retains the nonzero fade tail', () => {
  const bounds = pairBounds({ ...tr, lanes: { faderA: [
    { x: 0, y: 1 }, { x: 0.2, y: 0 }, { x: 0.4, y: 1 },
    { x: 0.8, y: 0.01 }, { x: 0.9, y: 0 },
  ] } }, { a: 180, b: 240 }, 1);
  expect(bounds.handover).toEqual({ enter: 60, exit: 78 });
});

it('uses the shared filter and all-band EQ kill policy, not waveform energy', () => {
  const durations = { a: 180, b: 240 };
  expect(pairBounds({ ...tr, lanes: { filterA: [{ x: 0, y: 0.5 }, { x: 1, y: 1 }] } },
    durations, 1).handover?.exit).toBeCloseTo(79.4);
  const kill = [{ x: 0, y: 0.5 }, { x: 1, y: 0 }];
  expect(pairBounds({ ...tr, lanes: { eqLowA: kill, eqMidA: kill, eqHighA: kill } },
    durations, 1).handover?.exit).toBeCloseTo(78);
  expect(pairBounds({ ...tr, lanes: { eqLowA: kill } }, durations, 1).handover?.exit).toBe(180);
  expect(pairBounds({ ...tr, lanes: { faderB: [{ x: 0, y: 0.1 }] } }, durations, 1).handover).toBeNull();
});

it('uses jump-aware first EOF, including repeats beyond the saved window', () => {
  expect(pairBounds({ ...tr, jumpsA: [{ x: 0.5, deltaSec: -10, count: 15 }] },
    { a: 180, b: 400 }, 1).handover?.exit).toBe(330);
  expect(pairBounds({ ...tr, jumpsA: [{ x: 0.5, deltaSec: 200 }, { x: 0.6, deltaSec: -200 }] },
    { a: 180, b: 240 }, 1).handover?.exit).toBe(70);
});

it('does not invent a handover when incoming never survives outgoing', () => {
  expect(pairBounds(tr, { a: 180, b: 20 }, 1).handover).toBeNull();
  expect(pairBounds({ ...tr, lanes: { faderB: [{ x: 0, y: 0 }] } },
    { a: 180, b: 240 }, 1).handover).toBeNull();
});

it('Set playback keeps outgoing open past old EXIT and stops it at the authored fade end', () => {
  const plan = (transition: Transition) => planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'pair' } }, { trackId: 2, pin: null }],
    tracks: {
      1: { durationSec: 180, bpm: 120, hotCue1Sec: null },
      2: { durationSec: 240, bpm: 120, hotCue1Sec: null },
    },
    transitionsByUuid: { pair: transition }, takesByUuid: {},
  });
  const open = plan(tr);
  expect(open.entries[0].exitMixSec).toBe(180);
  expect(planStateAtRaw(open, 100).decks.A.playing).toBe(true);
  const faded = plan({ ...tr, lanes: { faderA: [{ x: 0, y: 1 }, { x: 2, y: 0 }] } });
  expect(faded.entries[0].exitMixSec).toBe(100);
  expect(planStateAtRaw(faded, 99.9).lanes.A.fader).toBeCloseTo(0.0025);
  expect(planStateAtRaw(faded, 100).decks.A.playing).toBe(false);
});

it('retains every lane and setup jump when the handover shrinks, and is idempotent', () => {
  const source: Transition = { ...tr, lanes: {
    faderA: [{ x: 0, y: 1 }, { x: 0.5, y: 0 }],
    faderB: [{ x: 0.2, y: 0 }, { x: 0.4, y: 1 }],
    eqLowB: [{ x: 2, y: 0.2 }], filterA: [{ x: 1.5, y: 0.7 }],
  }, hiddenLanes: ['filterA'], jumpsA: [{ x: 0.1, deltaSec: -4 }],
    jumps: [{ x: 1.5, deltaSec: -2, count: 4 }] };
  const durations = { a: 180, b: 240 };
  const normalized = normalizePairWindow(source, pairBounds(source, durations, 1));
  expect(normalized.durationSec).toBe(40); // retained EQ point, not EXIT at 70
  expect(pairBounds(normalized, durations, 1).handover).toEqual({ enter: 64, exit: 70 });
  expect(normalizePairWindow(normalized, pairBounds(normalized, durations, 1))).toEqual(normalized);
  for (const t of [60, 62, 65, 70, 90, 95, 100]) {
    expect(laneValuesAt(normalized, t)).toEqual(laneValuesAt(source, t));
    expect(aTrackTimeAt(normalized, t)).toBe(aTrackTimeAt(source, t));
    expect(bTrackTimeAt(normalized, t, 1)).toBe(bTrackTimeAt(source, t, 1));
  }
});

it('widens before the old ENTER without sliding existing controls or incoming alignment', () => {
  const source: Transition = { ...tr, lanes: {
    faderA: [{ x: -0.5, y: 1 }, { x: 0.5, y: 0 }],
    faderB: [{ x: 0, y: 1 }],
  }, jumpsA: [{ x: -0.2, deltaSec: -4 }] };
  const normalized = pairAuthoringTransition(source, 1.1);
  expect(normalized.startSec).toBe(50);
  expect(normalized.bInSec).toBeCloseTo(-3);
  expect(laneValuesAt(normalized, 55).faderB).toBe(0);
  for (const t of [60.01, 65, 75]) {
    expect(laneValuesAt(normalized, t).faderA).toBeCloseTo(laneValuesAt(source, t).faderA);
    expect(bTrackTimeAt(normalized, t, 1.1)).toBeCloseTo(bTrackTimeAt(source, t, 1.1));
  }
});

it('Set retains incoming controls after handover rather than reopening the fader', () => {
  const plan = planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'pair' } }, { trackId: 2, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null }, 2: { durationSec: 240, bpm: 120, hotCue1Sec: null } },
    transitionsByUuid: { pair: { ...tr, lanes: {
      faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }], faderB: [{ x: 0, y: 0.5 }],
    } } }, takesByUuid: {},
  });
  expect(planStateAtRaw(plan, 90).lanes.B.fader).toBe(0.5);
});

it('an invalid incoming EOF does not prematurely stop the outgoing Set track', () => {
  const plan = planSet({
    entries: [{ trackId: 1, pin: { kind: 'transition', uuid: 'pair' } }, { trackId: 2, pin: null }],
    tracks: { 1: { durationSec: 180, bpm: 120, hotCue1Sec: null }, 2: { durationSec: 20, bpm: 120, hotCue1Sec: null } },
    transitionsByUuid: { pair: { ...tr, jumps: [{ x: 0.1, deltaSec: 100 }, { x: 0.2, deltaSec: -100 }] } }, takesByUuid: {},
  });
  expect(plan.warnings.some((w) => w.message.includes('No incoming handover'))).toBe(true);
  expect(plan.entries[1].exitMixSec).toBe(62);
  expect(planStateAtRaw(plan, 100).decks.A.playing).toBe(true);
  expect(planStateAtRaw(plan, 100).decks.B.playing).toBe(false);
});
