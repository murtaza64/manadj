/** #352: a Transition's scratch clips survive projection onto the slot
 * surface — the planned slot carries the gesture at the right mix time,
 * anchored on its trace, and the trace lands where the arrangement does. */
import { describe, expect, it } from 'vitest';
import { bTrackTimeAt, type Transition } from './mixModel';
import { transitionToProjection } from './pairSlotTranslation';
import { normalizePairWindow } from './pairBounds';
import { buildEditorRoutine } from '../routines/routineEditorModel';
import { traceStateAt } from '../sets/routinePlan';

const tr: Transition = {
  startSec: 60,
  durationSec: 20,
  bInSec: 8,
  tempoMatch: true,
  lanes: {},
  scratches: [{ x: 0.5, durationSec: 0.5, deltaSec: -0.4,
    frames: [[0, 0, 0, 0, 1, 1], [0.2, -0.3, -6, -1, 1, 1], [0.5, 0.1, 0, 0, 1, 0]] }],
};

describe('pair projection with scratch clips', () => {
  it('plans the incoming gesture on its slot and lands the trace with the arrangement', () => {
    const proj = transitionToProjection({ uuid: 'u', name: 'n', transition: tr, trackAId: 1, trackBId: 2, bpmA: 120, bpmB: 120 });
    const { planned } = buildEditorRoutine(proj.detail, proj.trackBpms, proj.targetBpm, proj.edits);
    const slot = planned.slots.find((s) => s.trackId === 2)!;
    expect(slot.scratches).toHaveLength(1);
    const c = slot.scratches![0];
    const startMix = c.startMixSec;
    expect(c.endMixSec - startMix).toBeCloseTo(0.5, 6);
    // Gesture anchored at B's arrangement position at its start (18).
    expect(c.frames[0].position).toBeCloseTo(bTrackTimeAt(tr, 70, 1), 3);
    expect(c.frames.at(-1)!.position).toBeCloseTo(18.1, 3);
    // After release the slot trace agrees with the arrangement.
    const beatAfter = (startMix + 2 - planned.beatOriginMixSec) / planned.secPerBeat;
    const mixAfter = 72;
    expect(traceStateAt(slot.trace, beatAfter).pos).toBeCloseTo(bTrackTimeAt(tr, mixAfter, 1), 2);
  });
});

describe('pair window normalization keeps scratch clips', () => {
  it('re-expresses clip starts in the new frame and contains a clip past the old end', () => {
    const t: Transition = { ...tr, scratchesA: [{ x: 0.99, durationSec: 1, deltaSec: -1, frames: [[0, 0, 0, 0, 1, 1], [1, 0, 0, 0, 1, 0]] }] };
    const n = normalizePairWindow(t, { handover: null, outgoingEnd: 80, authoringEnd: 81 });
    const endA = n.startSec + n.scratchesA![0].x * n.durationSec + 1;
    expect(endA).toBeCloseTo(80.8, 6);
    expect(n.startSec + n.durationSec).toBeGreaterThanOrEqual(80.8 - 1e-6);
    expect(n.startSec + n.scratches![0].x * n.durationSec).toBeCloseTo(70, 6);
  });
});
