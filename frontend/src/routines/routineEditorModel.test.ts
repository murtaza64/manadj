/**
 * Routine editor view model (gh#170): wire mapping, the editor build's
 * anchoring (beat 0 ≡ mix 0, slot 0 on A), and the beat ruler.
 */
import { describe, expect, it } from 'vitest';
import type { RoutineDetailWire } from '../api/client';
import {
  buildEditorRoutine,
  buildGlobalLadder,
  buildTrackMeter,
  rulerTicks,
  slotAccent,
  slotLadderMarks,
  wireRoutineToPlanInput,
  type ProjectedDownbeat,
} from './routineEditorModel';
import type { BeatgridData } from '../types';

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

describe('per-track ladders (buildTrackMeter / slotLadderMarks)', () => {
  /** 120 BPM 4/4, 32 bars from t=0: beat every 0.5 s, bar every 2 s. */
  function grid(): BeatgridData {
    const beat_times: number[] = [];
    const downbeat_times: number[] = [];
    for (let i = 0; i < 128; i++) {
      beat_times.push(i * 0.5);
      if (i % 4 === 0) downbeat_times.push(i * 0.5);
    }
    return {
      tempo_changes: [
        { start_time: 0, bpm: 120, time_signature_num: 4, time_signature_den: 4, bar_position: 1 },
      ],
      beat_times,
      downbeat_times,
    };
  }

  it('projects the track lattice through a run onto the routine clock', () => {
    const meter = buildTrackMeter(grid(), null)!;
    expect(meter).not.toBeNull();
    // One run: routine beats 0..32 play track 10..26 s (beatmatched).
    const runs = [{ b0: 0, b1: 32, ph0: 10, ph1: 26 }];
    const res = slotLadderMarks(meter, runs, 20); // zoomed in: weak beats show
    expect(res.baseTier).toBe(-1);
    // Track downbeat at 12 s (bar 6) lands at routine beat (12−10)/0.5 = 4.
    const downs = res.marks.filter((m) => m.tier >= 0);
    expect(downs.some((m) => Math.abs(m.beatR - 4) < 1e-6)).toBe(true);
    // Weak beats present between downbeats.
    expect(res.marks.some((m) => m.tier === -1)).toBe(true);
    // The track's OWN phase governs: bar 8 boundary (16 s → beat 12)
    // carries a higher tier than bar 6 (12 s → beat 4).
    const tierAt = (b: number) =>
      res.marks.find((m) => Math.abs(m.beatR - b) < 1e-6)?.tier;
    expect(tierAt(12)!).toBeGreaterThan(tierAt(4)!);
  });

  it('applies Reset marks: tiers restart and the mark projects gold', () => {
    const meter = buildTrackMeter(grid(), { reset_marks: [12] })!;
    const runs = [{ b0: 0, b1: 32, ph0: 10, ph1: 26 }];
    const res = slotLadderMarks(meter, runs, 20);
    // The reset's downbeat (12 s) carries the TOP tier and projects at
    // routine beat 4.
    const at4 = res.marks.find((m) => Math.abs(m.beatR - 4) < 1e-6)!;
    expect(at4.tier).toBe(meter.tierBars.length - 1);
    expect(res.resets.some((b) => Math.abs(b - 4) < 1e-6)).toBe(true);
  });

  it('culls weak beats and low tiers zoomed out; frozen runs carry nothing', () => {
    const meter = buildTrackMeter(grid(), null)!;
    const runs = [
      { b0: 0, b1: 32, ph0: 10, ph1: 26 },
      { b0: 32, b1: 40, ph0: 26, ph1: 26 }, // paused frame
    ];
    const res = slotLadderMarks(meter, runs, 2); // pxPerBar = 8 < 24
    expect(res.marks.every((m) => m.tier >= res.baseTier)).toBe(true);
    expect(res.baseTier).toBeGreaterThan(0);
    expect(res.marks.every((m) => m.beatR <= 32)).toBe(true); // frozen run: none
    // Gridless track → null meter (fallback path).
    expect(buildTrackMeter(null, null)).toBeNull();
  });
});

describe('buildGlobalLadder', () => {
  /** Synthetic projected downbeats: bars every 4 routine beats from
   * `startBeat`, the track's own barIndex starting at `phase0` (its count
   * within its 16-bar phrases). */
  function bars(startBeat: number, count: number, phase0: number): ProjectedDownbeat[] {
    return Array.from({ length: count }, (_, i) => {
      const barIndex = phase0 + i;
      const mod = barIndex % 16;
      const tier = mod === 0 ? 4 : mod % 8 === 0 ? 3 : mod % 4 === 0 ? 2 : mod % 2 === 0 ? 1 : 0;
      return { beatR: startBeat + i * 4, tier, parenthetical: false, barIndex };
    });
  }

  it('anchors on slot 0 and hands off seamlessly when phases agree', () => {
    // Slot 0 governs beats 0..64 (bars 0..15); slot 1 takes over at 64
    // with ITS barIndex ≡ 16 mod 16 = 0 — the count continues.
    const spans = [
      { slot: 0, entryBeat: 0, releaseBeat: 64 },
      { slot: 1, entryBeat: 32, releaseBeat: 128 },
    ];
    const g = buildGlobalLadder(
      spans,
      [bars(0, 16, 0), bars(32, 24, 8)], // slot 1's bar at 64 has barIndex 16 (≡0)
      [[], []],
      [16, 16],
      128
    );
    expect(g.resets).toHaveLength(0);
    // While both are audible (32..64), slot 0 governs (first entry).
    const at48 = g.marks.find((m) => Math.abs(m.beatR - 48) < 1e-6)!;
    expect(at48).toBeDefined();
    expect(g.marks.some((m) => m.parenthetical)).toBe(false);
  });

  it('derives a reset + gold extra bars when a handoff breaks the phase', () => {
    // Slot 0 exits at beat 64 (after bar 15 of its phrase). Slot 1's own
    // count puts its next phrase boundary ONE BAR LATE (beat 68): the bar
    // at 64 is the mix's extra bar — parenthetical, plain tier — and the
    // derived reset lands at 68 although neither track has a mark.
    const spans = [
      { slot: 0, entryBeat: 0, releaseBeat: 64 },
      { slot: 1, entryBeat: 32, releaseBeat: 128 },
    ];
    const g = buildGlobalLadder(
      spans,
      // slot 1's bars: at beat 64 its barIndex is 15 (one shy of the
      // boundary), so 68 carries barIndex 16 ≡ 0.
      [bars(0, 16, 0), bars(32, 24, 7)],
      [[], []],
      [16, 16],
      128
    );
    expect(g.resets.some((r) => Math.abs(r - 68) < 1e-6)).toBe(true);
    const extra = g.marks.find((m) => Math.abs(m.beatR - 64) < 1e-6)!;
    expect(extra.parenthetical).toBe(true);
    expect(extra.tier).toBe(0);
    // After the derived reset the incoming ladder counts normally.
    const boundary = g.marks.find((m) => Math.abs(m.beatR - 68) < 1e-6)!;
    expect(boundary.parenthetical).toBe(false);
    expect(boundary.tier).toBe(4);
  });

  it('carries source Reset marks into the guide list', () => {
    const spans = [{ slot: 0, entryBeat: 0, releaseBeat: 64 }];
    const g = buildGlobalLadder(spans, [bars(0, 16, 0)], [[24]], [16], 64);
    expect(g.resets).toEqual([24]);
  });
});

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

  it('renders negative beats (#205: out-of-span context shows around the window)', () => {
    const ticks = rulerTicks(-10, 20, 8);
    expect(ticks[0].beat).toBeLessThan(0);
    const major = ticks.find((t) => t.major && t.beat < 0);
    expect(major?.label).toBe(String(major?.beat));
    // Beat 0 still ticks exactly (the window boundary stays on the grid).
    expect(ticks.some((t) => t.beat === 0)).toBe(true);
  });
});

describe('slotAccent', () => {
  it('wears the allocated DECK accent (gh#190); overflow is neutral', () => {
    expect(slotAccent('A')).toBe('#00e5ff');
    expect(slotAccent('B')).toBe('#ff2d95');
    expect(slotAccent(null)).toBe('#8a8a96');
  });
});
