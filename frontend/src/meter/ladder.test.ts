import { describe, expect, it } from 'vitest';
import type { BeatgridData, TempoChange } from '../types';
import { DEFAULT_ARITIES, groupBars, resolveLadder } from './ladder';

/** Constant-tempo grid fixture: expands segments into beat/downbeat arrays
 * the way the backend does (accumulate per segment, downbeat when the
 * running bar position wraps to 1). */
function makeGrid(
  segments: Array<{
    startTime: number;
    bpm: number;
    sig?: number;
    barPosition?: number;
    beats: number;
  }>,
): BeatgridData {
  const tempo_changes: TempoChange[] = [];
  const beat_times: number[] = [];
  const downbeat_times: number[] = [];
  for (const seg of segments) {
    const sig = seg.sig ?? 4;
    tempo_changes.push({
      start_time: seg.startTime,
      bpm: seg.bpm,
      time_signature_num: sig,
      time_signature_den: 4,
      bar_position: seg.barPosition ?? 1,
    });
    const period = 60 / seg.bpm;
    let pos = seg.barPosition ?? 1;
    for (let i = 0; i < seg.beats; i++) {
      const t = seg.startTime + i * period;
      beat_times.push(t);
      if (pos === 1) downbeat_times.push(t);
      pos = (pos % sig) + 1;
    }
  }
  return { tempo_changes, beat_times, downbeat_times };
}

describe('groupBars', () => {
  it('duple tiers are 1, 2, 4, 8, 16 bars', () => {
    expect([0, 1, 2, 3, 4].map((k) => groupBars(DEFAULT_ARITIES, k))).toEqual([
      1, 2, 4, 8, 16,
    ]);
  });
});

describe('resolveLadder', () => {
  it('is undefined without a grid or without downbeats', () => {
    expect(resolveLadder(null)).toBeNull();
    expect(
      resolveLadder({ tempo_changes: [], beat_times: [], downbeat_times: [] }),
    ).toBeNull();
  });

  it('anchors the default duple ladder at the grid origin', () => {
    // 128 BPM 4/4 from t=0, 32 bars.
    const grid = makeGrid([{ startTime: 0, bpm: 128, beats: 32 * 4 }]);
    const proj = resolveLadder(grid)!;
    expect(proj.topTier).toBe(4);
    expect(proj.tierBars).toEqual([1, 2, 4, 8, 16]);
    expect(proj.tiers).toHaveLength(32);
    expect(proj.barIndexes[0]).toBe(0);
    expect(proj.barIndexes[31]).toBe(31);
    expect(proj.tiers[0]).toBe(4); // bar 0: 16-bar boundary
    expect(proj.tiers[1]).toBe(0); // plain bar
    expect(proj.tiers[2]).toBe(1); // 2-bar
    expect(proj.tiers[4]).toBe(2); // 4-bar
    expect(proj.tiers[8]).toBe(3); // 8-bar
    expect(proj.tiers[16]).toBe(4); // 16-bar
    expect(proj.tiers[24]).toBe(3);
  });

  it('counts from the extended origin when the first mark is a beat late', () => {
    // Off-by-one-bar trap: first mark on beat 2, one period into the track.
    // Grid origin extends back to t=0; the grid's own first downbeat is
    // bar 1 (not 0) of the ladder.
    const period = 60 / 128;
    const grid = makeGrid([
      { startTime: period, bpm: 128, barPosition: 2, beats: 17 * 4 },
    ]);
    const proj = resolveLadder(grid)!;
    // First stored downbeat is 3 beats after the first mark = bar 1.
    expect(proj.barIndexes[0]).toBe(1);
    expect(proj.tiers[0]).toBe(0);
    expect(proj.tiers[1]).toBe(1); // bar 2
    expect(proj.tiers[15]).toBe(4); // bar 16
  });

  it('extrapolates the origin toward the track start for a late first mark', () => {
    // First mark 16 bars into the track: origin lands at t≈0, so the first
    // stored downbeat is already a 16-bar boundary.
    const barSec = (60 / 128) * 4;
    const grid = makeGrid([{ startTime: 16 * barSec, bpm: 128, beats: 8 * 4 }]);
    const proj = resolveLadder(grid)!;
    expect(proj.tiers[0]).toBe(4);
    expect(proj.tiers[2]).toBe(1);
  });

  it('counts bars ordinally across a tempo change', () => {
    // 8 bars at 128, then 8 bars at 140: tier pattern continues unbroken.
    const barSec = (60 / 128) * 4;
    const grid = makeGrid([
      { startTime: 0, bpm: 128, beats: 8 * 4 },
      { startTime: 8 * barSec, bpm: 140, beats: 8 * 4 },
    ]);
    const proj = resolveLadder(grid)!;
    expect(proj.tiers[8]).toBe(3); // first bar of the 140 side = bar 8
    expect(proj.tiers[12]).toBe(2); // bar 12: 4-bar boundary
  });

  it('handles 3/4 bars (duple grouping above a triple bar)', () => {
    const grid = makeGrid([{ startTime: 0, bpm: 120, sig: 3, beats: 20 * 3 }]);
    const proj = resolveLadder(grid)!;
    expect(proj.tiers[0]).toBe(4);
    expect(proj.tiers[2]).toBe(1);
    expect(proj.tiers[16]).toBe(4);
  });
});
