import { describe, expect, it } from 'vitest';
import type { BeatgridData } from '../types';
import { beatPhaseAt, beatPositionAt, ladderBarIndexAt } from './beat';

// A steady 120 BPM grid: beats every 0.5 s from t = 10.
const GRID = Array.from({ length: 32 }, (_, i) => 10 + i * 0.5);

describe('beatPhaseAt', () => {
  it('is 0 on the beat and 0.5 on the offbeat', () => {
    expect(beatPhaseAt(GRID, 10)).toBeCloseTo(0, 10);
    expect(beatPhaseAt(GRID, 12)).toBeCloseTo(0, 10);
    expect(beatPhaseAt(GRID, 12.25)).toBeCloseTo(0.5, 10);
  });

  it('advances linearly within a beat', () => {
    expect(beatPhaseAt(GRID, 11.1)).toBeCloseTo(0.2, 10);
    expect(beatPhaseAt(GRID, 11.4)).toBeCloseTo(0.8, 10);
  });

  it('wraps lead-in extrapolation (before the first beat) into [0, 1)', () => {
    // 0.1 s before the first beat = phase 0.8 on the extrapolated grid.
    const phase = beatPhaseAt(GRID, 9.9);
    expect(phase).not.toBeNull();
    expect(phase!).toBeCloseTo(0.8, 10);
    expect(phase!).toBeGreaterThanOrEqual(0);
    expect(phase!).toBeLessThan(1);
  });

  it('extrapolates past the last beat', () => {
    const last = GRID[GRID.length - 1];
    expect(beatPhaseAt(GRID, last + 0.25)).toBeCloseTo(0.5, 10);
  });

  it('is null for an unusable grid', () => {
    expect(beatPhaseAt([], 1)).toBeNull();
    expect(beatPhaseAt([10], 10.2)).toBeNull();
  });
});

describe('beatPositionAt', () => {
  // Downbeats every 4 beats starting at the first beat (t = 10).
  const DOWNBEATS = [10, 12, 14, 16];

  it('counts the bar: beatInBar 0..3 and barPhase sweeping the bar', () => {
    expect(beatPositionAt(GRID, DOWNBEATS, 10)).toMatchObject({
      beatInBar: 0,
      barPhase: 0,
      beatsPerBar: 4,
    });
    expect(beatPositionAt(GRID, DOWNBEATS, 10.5)!.beatInBar).toBe(1);
    expect(beatPositionAt(GRID, DOWNBEATS, 11.5)!.beatInBar).toBe(3);
    expect(beatPositionAt(GRID, DOWNBEATS, 12)!.beatInBar).toBe(0); // next bar
    expect(beatPositionAt(GRID, DOWNBEATS, 11)!.barPhase).toBeCloseTo(0.5, 10);
  });

  it('anchors bars to the first downbeat, not the first beat', () => {
    // Downbeats offset by one beat: the "1" lands on grid beat 1.
    const offset = [10.5, 12.5];
    const position = beatPositionAt(GRID, offset, 10.5)!;
    expect(position.beatInBar).toBe(0);
    expect(position.barPhase).toBeCloseTo(0, 10);
  });

  it('infers beats-per-bar from the downbeat interval', () => {
    // Downbeats every 3 beats → 3/4.
    const waltz = [10, 11.5, 13];
    expect(beatPositionAt(GRID, waltz, 10)!.beatsPerBar).toBe(3);
    expect(beatPositionAt(GRID, waltz, 11)!.beatInBar).toBe(2);
  });

  it('assumes 4/4 from the first beat without downbeats', () => {
    const position = beatPositionAt(GRID, [], 11.5)!;
    expect(position.beatsPerBar).toBe(4);
    expect(position.beatInBar).toBe(3);
  });

  it('keeps beat phase identical to beatPhaseAt', () => {
    const t = 11.37;
    expect(beatPositionAt(GRID, DOWNBEATS, t)!.phase).toBeCloseTo(
      beatPhaseAt(GRID, t)!,
      10
    );
  });

  it('is null for an unusable grid', () => {
    expect(beatPositionAt([10], [10], 10.2)).toBeNull();
  });

  it('counts absolute bars for phrase tiers', () => {
    expect(beatPositionAt(GRID, DOWNBEATS, 10)!.barIndex).toBe(0);
    expect(beatPositionAt(GRID, DOWNBEATS, 12)!.barIndex).toBe(1);
    expect(beatPositionAt(GRID, DOWNBEATS, 18.5)!.barIndex).toBe(4); // phrase rollover
    expect(beatPositionAt(GRID, DOWNBEATS, 9.4)!.barIndex).toBe(-1); // lead-in
  });

  it('leaves ladderBarIndex null without a grid argument (fallback to barIndex)', () => {
    const pos = beatPositionAt(GRID, DOWNBEATS, 14)!;
    expect(pos.barIndex).toBe(2);
    expect(pos.ladderBarIndex).toBeNull();
  });
});

// A steady 120 BPM 4/4 grid, 40 bars from t = 0 (0.5 s per beat, 2 s per bar).
// Constructed the way the backend serves it so resolveLadder can consume it.
function grid40(): BeatgridData {
  const beat_times: number[] = [];
  const downbeat_times: number[] = [];
  for (let i = 0; i < 160; i++) {
    const t = i * 0.5;
    beat_times.push(t);
    if (i % 4 === 0) downbeat_times.push(t);
  }
  return {
    tempo_changes: [
      {
        start_time: 0,
        bpm: 120,
        time_signature_num: 4,
        time_signature_den: 4,
        bar_position: 1,
      },
    ],
    beat_times,
    downbeat_times,
  };
}

const barSec = 2; // 120 BPM, 4/4

describe('ladderBarIndexAt (reset-mark-correct bar ordinal)', () => {
  it('is null without a grid', () => {
    expect(ladderBarIndexAt(null, null, 5)).toBeNull();
  });

  it('is null before the first downbeat (no bar to count yet)', () => {
    const grid = grid40();
    // Push the first downbeat late so t=0 sits before it.
    grid.downbeat_times = grid.downbeat_times.filter((d) => d >= 2);
    expect(ladderBarIndexAt(grid, null, 0.5)).toBeNull();
  });

  it('matches the raw bar count on the default (no-mark) ladder', () => {
    const grid = grid40();
    expect(ladderBarIndexAt(grid, null, 0)).toBe(0);
    expect(ladderBarIndexAt(grid, null, barSec * 5 + 0.3)).toBe(5);
    expect(ladderBarIndexAt(grid, null, barSec * 17)).toBe(17);
  });

  it('restarts the count at a Reset mark — phrase/section re-anchor', () => {
    // Mark at bar 20 (the anchor): bars 0..19 count backward into it, bar 20
    // restarts at 0. The pre-anchor region peels 4 + 16, so bar 16 reads 0.
    const grid = grid40();
    const marks = { reset_marks: [20 * barSec] };
    expect(ladderBarIndexAt(grid, marks, 20 * barSec)).toBe(0); // anchor = fresh section
    expect(ladderBarIndexAt(grid, marks, 21 * barSec + 0.4)).toBe(1);
    expect(ladderBarIndexAt(grid, marks, 36 * barSec)).toBe(16); // one section past the anchor
    // Pre-anchor: the 16-bar group peels back to bar 4, so bar 4 reads 0.
    expect(ladderBarIndexAt(grid, marks, 4 * barSec)).toBe(0);
    expect(ladderBarIndexAt(grid, marks, 19 * barSec)).toBe(15);
  });

  it('a mid-track reset shifts phrase/section boundaries off the raw grid', () => {
    // Two marks: anchor at bar 8, reset at bar 20. Between them counting is
    // forward from the reset — bar 20 is section boundary 0, not raw 20 % 16.
    const grid = grid40();
    const marks = { reset_marks: [8 * barSec, 20 * barSec] };
    // Raw grid: bar 20 % 16 === 4 (mid-section). Ladder: fresh section (0).
    const raw = beatPositionAt(grid.beat_times, grid.downbeat_times, 20 * barSec)!;
    expect(((raw.barIndex % 16) + 16) % 16).toBe(4);
    expect(ladderBarIndexAt(grid, marks, 20 * barSec)).toBe(0);
    // The phrase tier (%4) also re-aligns at the reset.
    expect(ladderBarIndexAt(grid, marks, 21 * barSec) ?? 0).toBe(1);
  });

  it('resolves marks to the nearest downbeat (off-grid mark seconds)', () => {
    const grid = grid40();
    const marks = { reset_marks: [20 * barSec + 0.3] }; // 0.3 s past bar 20's downbeat
    expect(ladderBarIndexAt(grid, marks, 20 * barSec)).toBe(0);
  });
});

describe('beatPositionAt with a ladder', () => {
  it('fills ladderBarIndex from the resolver when grid + marks are passed', () => {
    const grid = grid40();
    const marks = { reset_marks: [20 * barSec] };
    const pos = beatPositionAt(
      grid.beat_times,
      grid.downbeat_times,
      21 * barSec + 0.2,
      grid,
      marks,
    )!;
    // barIndex stays the raw first-downbeat count; ladderBarIndex re-anchors.
    expect(pos.barIndex).toBe(21);
    expect(pos.ladderBarIndex).toBe(1);
  });

  it('agrees with the raw count on the default ladder', () => {
    const grid = grid40();
    const pos = beatPositionAt(grid.beat_times, grid.downbeat_times, 17 * barSec, grid, null)!;
    expect(pos.barIndex).toBe(17);
    expect(pos.ladderBarIndex).toBe(17);
  });
});
