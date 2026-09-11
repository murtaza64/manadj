import { describe, expect, it } from 'vitest';
import { emptyEdits, parseEdits } from '../routines/routineDraft';
import { buildPlannedRoutine, createSlotLanesCursor, plannedWithLaneEdits, slotLanesAt, type RoutinePlanInput } from './routinePlan';

const input: RoutinePlanInput = {
  cast: [1, 2, 3], entryOffsetsBeats: [0, 16, 32], entryPositions: [60, 0, 10], durationBeats: 64,
  events: [
    { kind: 'tick', beat: 0, playheads: { 0: 60 } },
    { kind: 'tick', beat: 64, playheads: { 0: 92, 1: 24, 2: 26 } },
    { kind: 'control', beat: 0, slot: 1, control: 'trim', value: 0.4 },
    { kind: 'control', beat: 32, slot: 1, control: 'trim', value: 0.6 },
  ],
};
const ctx = { startEntryIndex: 0, mixStartSec: 0, targetBpm: 120,
  adoptedDeck: 'A' as const, busy: [], trackBpms: [120, 120, 120] };

describe('authored trim envelopes', () => {
  it('replaces recorded trim with the same linear envelope in full builds and live updates', () => {
    const edits = { ...emptyEdits(), lanes: { '1:trim': [{ beat: 0, value: 0.25 }, { beat: 64, value: 0.75 }] } };
    const base = buildPlannedRoutine(input, ctx).routine;
    const built = buildPlannedRoutine({ ...input, edits }, ctx).routine;
    const live = plannedWithLaneEdits(base, edits);
    expect(built.slots[1].lanes.authored?.trim).toBe(true);
    expect(live.slots[1].trace).toBe(base.slots[1].trace);
    for (const beat of [0, 16, 32, 48, 64]) {
      expect(slotLanesAt(built.slots[1], beat).trim).toBeCloseTo(0.25 + beat / 128);
      expect(slotLanesAt(live.slots[1], beat)).toEqual(slotLanesAt(built.slots[1], beat));
    }
    expect(parseEdits(JSON.parse(JSON.stringify(edits)))).toEqual(edits);
    expect(base.slots[1].lanes.trim).toEqual([{ beat: 0, value: 0.4 }, { beat: 32, value: 0.6 }]);
  });

  it('composes the slot knob offset and clamps identically in cursor and direct playback', () => {
    const edits = { ...emptyEdits(), trims: { '1': 0.8 },
      lanes: { '1:trim': [{ beat: 0, value: 0.1 }, { beat: 64, value: 0.9 }] } };
    const slot = buildPlannedRoutine({ ...input, edits }, ctx).routine.slots[1];
    const cursor = createSlotLanesCursor(slot);
    for (const beat of [0, 16, 32, 48, 64]) {
      const direct = slotLanesAt(slot, beat);
      expect(direct.trim).toBeCloseTo(Math.min(1, 0.4 + beat / 80));
      expect(cursor(beat)).toEqual(direct);
    }
  });
});
