/**
 * Routine draft store (gh#170 pass 2): gesture-coalesced undo/redo over
 * the edits value; history resets on load (undo never crosses artifact
 * identity).
 */
import { describe, expect, it } from 'vitest';
import { emptyEdits } from './routineDraft';
import { RoutineDraftStore } from './routineDraftStore';

const make = () => {
  const s = new RoutineDraftStore();
  s.load('r-1', emptyEdits());
  return s;
};

describe('gesture coalescing', () => {
  it('a lane drag (many onChange) is ONE undo entry, sealed by pointer-up', () => {
    const s = make();
    // Simulated drag: 3 onChange frames.
    s.setLane('0', 'fader', [{ beat: 0, value: 1 }]);
    s.setLane('0', 'fader', [{ beat: 0, value: 0.6 }]);
    s.setLane('0', 'fader', [{ beat: 0, value: 0.2 }]);
    s.endGesture();
    // A second drag on the same lane: a FRESH entry.
    s.setLane('0', 'fader', [{ beat: 0, value: 0.9 }]);
    s.endGesture();
    expect(s.getSnapshot().edits.lanes['0:fader'][0].value).toBe(0.9);
    s.undo();
    expect(s.getSnapshot().edits.lanes['0:fader'][0].value).toBe(0.2);
    s.undo();
    expect(s.getSnapshot().edits.lanes['0:fader']).toBeUndefined();
    expect(s.getSnapshot().canUndo).toBe(false);
  });

  it('redo replays; a new mutation clears the redo branch', () => {
    const s = make();
    s.addJump({ id: 'j1', slotId: '2', beat: 16, deltaSec: -2 });
    s.undo();
    expect(s.getSnapshot().edits.jumps).toHaveLength(0);
    s.redo();
    expect(s.getSnapshot().edits.jumps).toHaveLength(1);
    s.undo();
    s.addJump({ id: 'j2', slotId: '1', beat: 8, deltaSec: 2 });
    expect(s.getSnapshot().canRedo).toBe(false);
  });
});

describe('jump mutations', () => {
  it('update coalesces per jump; repeat drops when the delta turns forward (loop doctrine)', () => {
    const s = make();
    s.addJump({ id: 'j1', slotId: '0', beat: 16, deltaSec: -2, repeat: 4 });
    s.updateJump('j1', { deltaSec: 2 });
    const j = s.getSnapshot().edits.jumps[0];
    expect(j.deltaSec).toBe(2);
    expect(j.repeat).toBeUndefined();
  });

  it('recorded-jump removal round-trips through restore', () => {
    const s = make();
    s.removeRecordedJump('1', 32.5);
    expect(s.getSnapshot().edits.removedRecordedJumps).toHaveLength(1);
    s.restoreRecordedJump('1', 32.5);
    expect(s.getSnapshot().edits.removedRecordedJumps).toHaveLength(0);
  });
});

describe('entry-offset overrides (ADR 0039, #207 slice 2)', () => {
  it('a reorder drag (many swap writes) is ONE undo entry; clear reverts to recorded', () => {
    const s = make();
    // A vertical drag crossing two slots: two swap mutations, one key.
    s.setEntryOffsetsLive('drag-1', { a: 32, b: 16 });
    s.setEntryOffsetsLive('drag-1', { a: 48, c: 32 });
    s.endGesture();
    expect(s.getSnapshot().edits.entryOffsets).toEqual({ a: 48, b: 16, c: 32 });
    s.undo();
    expect(s.getSnapshot().edits.entryOffsets).toEqual({});
    s.redo();
    // null clears an entry (a swap landing back on the recorded offset).
    s.setEntryOffsetsLive('drag-2', { b: null });
    s.endGesture();
    expect(s.getSnapshot().edits.entryOffsets).toEqual({ a: 48, c: 32 });
    // Revert-to-recorded: one undo step.
    s.clearEntryOffset('a');
    expect(s.getSnapshot().edits.entryOffsets).toEqual({ c: 32 });
    s.undo();
    expect(s.getSnapshot().edits.entryOffsets).toEqual({ a: 48, c: 32 });
  });
});

describe('load boundaries', () => {
  it('loading a routine resets history and identity', () => {
    const s = make();
    s.addJump({ id: 'j1', slotId: '0', beat: 4, deltaSec: -1 });
    s.load('r-2', emptyEdits());
    expect(s.getSnapshot().routineUuid).toBe('r-2');
    expect(s.getSnapshot().canUndo).toBe(false);
    expect(s.getSnapshot().edits.jumps).toHaveLength(0);
  });
});
