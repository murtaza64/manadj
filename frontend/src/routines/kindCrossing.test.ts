/** Kind-fluid crossings (ADR 0039, gh#330). */
import { describe, expect, it } from 'vitest';
import { transitionToProjection } from '../editor/pairSlotTranslation';
import type { Transition } from '../editor/mixModel';
import { addSlotsTo, emptyStructure, orderedSlots } from './authoredMix';
import { authoredToTransition, pairToAuthoredEdits } from './kindCrossing';
import { emptyEdits, type RoutineEdits } from './routineDraft';

const bpm120 = () => 120;
const twoSlot = (): RoutineEdits => {
  const e: RoutineEdits = { ...emptyEdits(), authored: emptyStructure() };
  addSlotsTo(e, [{ trackId: 1, entryPos: 30 }], 0);
  addSlotsTo(e, [{ trackId: 2, entryPos: 10 }], 32);
  return e;
};

describe('authoredToTransition', () => {
  it('opens the window at the incoming entry, positions from the built traces', () => {
    const r = authoredToTransition(twoSlot(), bpm120)!;
    expect(r.aTrackId).toBe(1);
    expect(r.bTrackId).toBe(2);
    expect(r.transition.startSec).toBeCloseTo(46); // 30 + 32 beats · 0.5 s
    expect(r.transition.bInSec).toBeCloseTo(10);
    expect(r.transition.durationSec).toBeCloseTo(16); // 32-beat tail
    expect(r.transition.tempoMatch).toBe(true);
    // The authored closed→open step sits at the window start: open.
    expect(r.transition.lanes.faderB).toEqual([{ x: 0, y: 1 }, { x: 1, y: 1 }]);
    expect(r.transition.lanes.faderA).toBeUndefined();
  });

  it('maps in-window jumps/lanes to x, applies nudges, drops out-of-window events', () => {
    const e = twoSlot();
    const [a, b] = orderedSlots(e).map((s) => s.slotId);
    e.jumps.push({ id: 'j1', slotId: b, beat: 40, deltaSec: -2, repeat: 2 });
    e.jumps.push({ id: 'j0', slotId: a, beat: 4, deltaSec: 8 }); // before the window
    e.nudges[a] = 1;
    e.lanes[`${a}:filter`] = [{ beat: 32, value: 0 }, { beat: 48, value: -1 }];
    const r = authoredToTransition(e, bpm120)!;
    expect(r.transition.jumps).toEqual([{ x: 0.25, deltaSec: -2, count: 2 }]);
    expect(r.transition.jumpsA).toBeUndefined();
    // Pre-window jump (+8 s) and nudge (+1 s) land in startSec.
    expect(r.transition.startSec).toBeCloseTo(55);
    expect(r.transition.lanes.filterA).toEqual([
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('refuses non-pairs, self-doubles and missing BPMs', () => {
    const three = twoSlot();
    addSlotsTo(three, [{ trackId: 3, entryPos: 0 }], 48);
    expect(authoredToTransition(three, bpm120)).toBeNull();
    expect(authoredToTransition(twoSlot(), (id) => (id === 2 ? null : 120))).toBeNull();
    const dbl: RoutineEdits = { ...emptyEdits(), authored: emptyStructure() };
    addSlotsTo(dbl, [{ trackId: 1, entryPos: 0 }, { trackId: 1, entryPos: 60 }], 32);
    expect(authoredToTransition(dbl, bpm120)).toBeNull();
  });
});

describe('pairToAuthoredEdits', () => {
  const tr: Transition = {
    startSec: 100,
    durationSec: 16,
    bInSec: 12,
    tempoMatch: true,
    lanes: { faderA: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
    jumps: [{ x: 0.5, deltaSec: -4 }],
  };
  const proj = transitionToProjection({
    uuid: 't', name: 'T', transition: tr, trackAId: 1, trackBId: 2, bpmA: 120, bpmB: 120,
  });

  it('carries structure, lanes and jumps; entry slot at beat 0', () => {
    const e = pairToAuthoredEdits(proj.detail, proj.edits, proj.sourceDurationBeats);
    const slots = orderedSlots(e);
    expect(slots.map((s) => s.trackId)).toEqual([1, 2]);
    expect(Math.min(...slots.map((s) => s.entryBeat))).toBe(0);
    expect(e.jumps).toHaveLength(1);
    expect(e.lanes['0:fader']).toBeDefined(); // authored fade-out
    expect(e.lanes['1:fader']).toBeDefined(); // pair default ramp-in
    expect(e.lanes['0:eqLow']).toBeUndefined(); // flat default: dropped
    // Ends with the pair window (32 beats after the incoming entry).
    const bEntry = slots.find((s) => s.trackId === 2)!.entryBeat;
    expect(e.authored!.durationBeats).toBeCloseTo(bEntry + 32);
  });

  it('round-trips back to the same Transition geometry', () => {
    const back = authoredToTransition(pairToAuthoredEdits(proj.detail, proj.edits, proj.sourceDurationBeats), bpm120)!;
    expect(back.transition.startSec).toBeCloseTo(100);
    expect(back.transition.bInSec).toBeCloseTo(12);
    expect(back.transition.durationSec).toBeCloseTo(16);
    expect(back.transition.jumps?.[0].x).toBeCloseTo(0.5);
    expect(back.transition.lanes.faderA?.at(-1)?.y).toBeCloseTo(0);
  });
});
