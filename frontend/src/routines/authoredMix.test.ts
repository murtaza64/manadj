/** Authored mixes (ADR 0039, gh#325): the blank draft's structure model. */
import { describe, expect, it } from 'vitest';
import {
  addSlotsTo,
  defaultEntryPos,
  emptyStructure,
  removeSlotFrom,
  snapEntryBeat,
  structureForSave,
  structureFromDetail,
  structureToDetail,
} from './authoredMix';
import { emptyEdits, type RoutineEdits } from './routineDraft';
import { editsForSave, RoutineDraftStore } from './routineDraftStore';
import { buildEditorRoutine } from './routineEditorModel';
import { traceStateAt } from '../sets/routinePlan';
import type { HotCue } from '../types';

const blank = (): RoutineEdits => ({ ...emptyEdits(), authored: emptyStructure() });
const drop = (trackId: number, entryPos = 0) => ({ trackId, entryPos });

describe('defaults', () => {
  it('entry position = Hot Cue 1, else track start', () => {
    const cue = (slot_number: number, time_seconds: number) => ({ slot_number, time_seconds }) as HotCue;
    expect(defaultEntryPos([cue(2, 9), cue(1, 31.5)])).toBe(31.5);
    expect(defaultEntryPos([cue(2, 9)])).toBe(0);
    expect(defaultEntryPos(undefined)).toBe(0);
  });

  it('entry beat snaps to the bar unless fine', () => {
    expect(snapEntryBeat(29.4, true)).toBe(28);
    expect(snapEntryBeat(30.2, true)).toBe(32);
    expect(snapEntryBeat(29.4, false)).toBe(29.4);
  });
});

describe('addSlotsTo', () => {
  it('first track enters at 0 with no fader step; later ones get an authored closed→open step', () => {
    const e = blank();
    const [a] = addSlotsTo(e, [drop(1, 12)], 40);
    expect(e.authored!.slots).toEqual([{ slotId: a, trackId: 1, entryBeat: 0, entryPos: 12 }]);
    expect(e.lanes[`${a}:fader`]).toBeUndefined();
    const [b] = addSlotsTo(e, [drop(2)], 32);
    expect(e.authored!.slots[1].entryBeat).toBe(32);
    expect(e.lanes[`${b}:fader`]).toEqual([
      { beat: 31.9375, value: 0 },
      { beat: 32, value: 1 },
    ]);
    expect(e.authored!.durationBeats).toBe(64);
  });

  it('a multi-track drop on an empty canvas: entry at 0, next at the drop beat, then staggered', () => {
    const e = blank();
    addSlotsTo(e, [drop(1), drop(2), drop(3)], 16);
    expect(e.authored!.slots.map((s) => s.entryBeat)).toEqual([0, 16, 48]);
  });

  it('a drop before the entry slot re-anchors beat 0 and shifts every beat-stamped edit', () => {
    const e = blank();
    const [a] = addSlotsTo(e, [drop(1)], 0);
    const [b] = addSlotsTo(e, [drop(2)], 32);
    e.jumps.push({ id: 'j', slotId: a, beat: 40, deltaSec: -4 });
    e.playbackBounds = { startBeat: 0, endBeat: 64 };
    const [c] = addSlotsTo(e, [drop(3)], -8);
    const byId = Object.fromEntries(e.authored!.slots.map((s) => [s.slotId, s.entryBeat]));
    expect(byId).toEqual({ [c]: 0, [a]: 8, [b]: 40 });
    expect(e.jumps[0].beat).toBe(48);
    expect(e.lanes[`${b}:fader`][1].beat).toBe(40);
    expect(e.playbackBounds).toEqual({ startBeat: 8, endBeat: 72 });
  });
});

describe('removeSlotFrom', () => {
  it('drops the slot and every edit addressed to it', () => {
    const e = blank();
    const [, b, c] = addSlotsTo(e, [drop(1), drop(2), drop(3)], 32);
    e.nudges[b] = 0.2;
    e.trims[b] = 0.7;
    e.jumps.push({ id: 'j', slotId: b, beat: 40, deltaSec: -2 });
    removeSlotFrom(e, b);
    expect(e.authored!.slots.map((s) => s.slotId)).not.toContain(b);
    expect(Object.keys(e.lanes)).toEqual([`${c}:fader`]);
    expect(e.jumps).toEqual([]);
    expect(e.nudges).toEqual({});
    expect(e.trims).toEqual({});
  });

  it('removing the entry slot re-anchors on the next entry', () => {
    const e = blank();
    const [a, b] = addSlotsTo(e, [drop(1), drop(2), drop(3)], 32);
    removeSlotFrom(e, a);
    expect(e.authored!.slots.find((s) => s.slotId === b)!.entryBeat).toBe(0);
    expect(e.authored!.slots.map((s) => s.entryBeat)).toEqual([0, 32]);
  });
});

describe('wire round trip', () => {
  it('structure ↔ detail ↔ save body, entry-ordered', () => {
    const e = blank();
    addSlotsTo(e, [drop(1, 5), drop(2, 7)], 32);
    addSlotsTo(e, [drop(3, 9)], 16);
    const d = structureToDetail('u', null, e.authored!);
    expect(d.cast).toEqual([1, 3, 2]);
    expect(d.entry_offsets_beats).toEqual([0, 16, 32]);
    expect(d.authored).toBe(true);
    expect(d.events).toEqual([]);
    const back = structureFromDetail(d);
    expect(structureForSave(back)).toEqual(structureForSave(e.authored!));
  });

  it('editsForSave strips the structure (it persists as first-class fields)', () => {
    const e = blank();
    addSlotsTo(e, [drop(1), drop(2)], 32);
    const saved = editsForSave(e)!;
    expect(saved.authored).toBeUndefined();
    expect(Object.keys(saved.lanes)).toHaveLength(1);
  });
});

describe('draft store', () => {
  it('add/remove slot are single undo steps', () => {
    const store = new RoutineDraftStore();
    store.load('u', blank());
    store.addSlots([drop(1)], 0);
    const [b] = store.addSlots([drop(2)], 32);
    expect(store.getSnapshot().edits.authored!.slots).toHaveLength(2);
    store.removeSlot(b);
    expect(store.getSnapshot().edits.authored!.slots).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().edits.authored!.slots).toHaveLength(2);
    store.undo();
    expect(store.getSnapshot().edits.authored!.slots).toHaveLength(1);
    store.redo();
    expect(store.getSnapshot().edits.lanes[`${b}:fader`]).toHaveLength(2);
  });
});

describe('editor build of an authored draft', () => {
  it('synthesizes beatmatched traces and plays each slot from its entry', () => {
    const e = blank();
    addSlotsTo(e, [drop(1, 30), drop(2, 10), drop(3, 0)], 32);
    const d = structureToDetail('u', null, e.authored!);
    const ed = buildEditorRoutine(d, [120, 120, 120], 120, e);
    const [s0, s1, s2] = ed.planned.slots;
    expect(traceStateAt(s0.trace, 8)).toMatchObject({ pos: 34, moving: true });
    expect(traceStateAt(s1.trace, 40)).toMatchObject({ pos: 14, moving: true });
    expect(s2.lanes.authored?.fader).toBe(true);
    expect(ed.planned.slots.map((s) => s.deck)).toEqual(['A', 'B', 'C']);
  });
});
