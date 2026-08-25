/**
 * Routine editor view model (gh#170): wire mapping, the editor build's
 * anchoring (beat 0 ≡ mix 0, slot 0 on A), and the beat ruler.
 */
import { describe, expect, it } from 'vitest';
import type { RoutineDetailWire } from '../api/client';
import {
  buildEditorRoutine,
  rulerTicks,
  slotColor,
  wireRoutineToPlanInput,
} from './routineEditorModel';

const detail: RoutineDetailWire = {
  uuid: 'r-1',
  name: null,
  cast: [1, 2, 3],
  entry_offsets_beats: [0, 16, 32],
  entry_positions: [60, 0, 10],
  duration_beats: 64,
  origin_take_uuid: 't-1',
  created_at: null,
  events: [
    { kind: 'tick', beat: 0, playheads: { '0': 60 } },
    { kind: 'tick', beat: 64, playheads: { '0': 92, '1': 24, '2': 26 } },
  ],
};

describe('wireRoutineToPlanInput', () => {
  it('camel-cases into THE replay seam', () => {
    const input = wireRoutineToPlanInput(detail);
    expect(input.cast).toEqual([1, 2, 3]);
    expect(input.entryOffsetsBeats).toEqual([0, 16, 32]);
    expect(input.entryPositions).toEqual([60, 0, 10]);
    expect(input.durationBeats).toBe(64);
    expect(input.events).toHaveLength(2);
  });
});

describe('buildEditorRoutine', () => {
  it('anchors beat 0 at mix 0 with slot 0 adopted on A, allocation A→B→C', () => {
    const e = buildEditorRoutine(detail, [120, 120, 120], 120);
    expect(e.planned.mixStartSec).toBe(0);
    expect(e.planned.mixEndSec).toBeCloseTo(32); // 64 beats at 0.5 s/beat
    expect(e.planned.slots.map((s) => s.deck)).toEqual(['A', 'B', 'C']);
    expect(e.planned.secPerBeat).toBeCloseTo(0.5);
  });

  it('re-anchors to any target tempo (beat-domain doctrine)', () => {
    const e = buildEditorRoutine(detail, [120, 120, 120], 126);
    expect(e.planned.mixEndSec).toBeCloseTo(64 * (60 / 126));
    // Slot base pitch follows the tempo delta (within the varispeed clamp).
    expect(e.planned.slots[0].basePitchPercent).toBeCloseTo(5, 1);
  });
});

describe('rulerTicks', () => {
  it('labels land on steps that clear the label width', () => {
    const ticks = rulerTicks(0, 64, 8); // 8 px/beat → 8-beat labels (64 px)
    const majors = ticks.filter((t) => t.major).map((t) => t.beat);
    expect(majors).toEqual([0, 8, 16, 24, 32, 40, 48, 56, 64]);
    expect(ticks.find((t) => t.beat === 2)?.major).toBe(false);
  });

  it('zooms coarse: low px/beat widens the step', () => {
    const ticks = rulerTicks(0, 512, 0.5); // needs a 128-beat step
    const majors = ticks.filter((t) => t.major).map((t) => t.beat);
    expect(majors).toEqual([0, 128, 256, 384, 512]);
  });

  it('never starts below beat 0', () => {
    const ticks = rulerTicks(-10, 20, 8);
    expect(ticks[0].beat).toBeGreaterThanOrEqual(0);
  });
});

describe('slotColor', () => {
  it('cycles a bright entry-ordered palette, slot 0 magenta', () => {
    expect(slotColor(0)).toBe('#ff3fd4');
    expect(slotColor(1)).not.toBe(slotColor(0));
    expect(slotColor(8)).toBe(slotColor(0));
  });
});
