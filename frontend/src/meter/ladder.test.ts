import { describe, expect, it } from 'vitest';
import type { BeatgridData, TempoChange } from '../types';
import {
  DEFAULT_ARITIES,
  barCountLabel,
  groupBars,
  resolveLadder,
  resolvedMarkTimes,
} from './ladder';

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

describe('resolveLadder with Reset marks', () => {
  const barSec = (60 / 128) * 4; // 1.875s per 4/4 bar at 128
  const grid40 = () => makeGrid([{ startTime: 0, bpm: 128, beats: 40 * 4 }]);
  const marks = (...bars: number[]) => ({ reset_marks: bars.map((b) => b * barSec) });

  it('fakeout: 16+4 before the real drop — trailing parenthetical', () => {
    // Reset at the real drop (bar 20). Bars 0-15 complete a 16-group;
    // 16-19 are the fakeout extension.
    const proj = resolveLadder(grid40(), marks(20))!;
    expect(proj.tiers[20]).toBe(4); // count restarts at the mark
    expect(proj.barIndexes[20]).toBe(0);
    expect(proj.barIndexes[21]).toBe(1);
    expect(proj.parentheticals.slice(0, 16)).toEqual(new Array(16).fill(false));
    expect(proj.parentheticals.slice(16, 20)).toEqual([true, true, true, true]);
  });

  it('final open segment is never parenthetical', () => {
    // 20 bars after the mark at 20 in a 40-bar grid: incomplete 16-group
    // at the tail, but no next reset to be short of.
    const proj = resolveLadder(grid40(), marks(20))!;
    expect(proj.parentheticals.slice(20)).toEqual(new Array(20).fill(false));
  });

  it('12-bar intro: forward counting flags the trailing 4; an extra mark makes 4+8 clean', () => {
    const one = resolveLadder(grid40(), marks(12))!;
    expect(one.parentheticals.slice(0, 8)).toEqual(new Array(8).fill(false));
    expect(one.parentheticals.slice(8, 12)).toEqual([true, true, true, true]);

    const two = resolveLadder(grid40(), marks(4, 12))!;
    expect(two.parentheticals.slice(0, 12)).toEqual(new Array(12).fill(false));
    expect(two.tiers[4]).toBe(4); // segment restart
    expect(two.barIndexes[4]).toBe(0);
  });

  it('mid-breakdown inserted bar: 9-bar + 8-bar segments', () => {
    // Marks at the realignment point (bar 9) and the drop (bar 17).
    const proj = resolveLadder(grid40(), marks(9, 17))!;
    expect(proj.parentheticals[8]).toBe(true); // the inserted bar
    expect(proj.parentheticals.slice(0, 8)).toEqual(new Array(8).fill(false));
    expect(proj.parentheticals.slice(9, 17)).toEqual(new Array(8).fill(false));
    expect(proj.tiers[9]).toBe(4);
    expect(proj.tiers[17]).toBe(4);
  });

  it('leading pickup: a 1-bar segment is all parenthetical', () => {
    const proj = resolveLadder(grid40(), marks(3, 4))!;
    expect(proj.parentheticals[3]).toBe(true);
    expect(proj.barIndexes[4]).toBe(0);
  });

  it('marks resolve to the NEAREST downbeat and survive small grid shifts', () => {
    // 30ms off the bar-20 downbeat (a grid nudge later moved the lattice).
    const proj = resolveLadder(grid40(), { reset_marks: [20 * barSec + 0.03] })!;
    expect(proj.tiers[20]).toBe(4);
    expect(proj.barIndexes[20]).toBe(0);
  });

  it('barCountLabel: position in the top tier from the governing reset; parentheticals count "+k"', () => {
    // Fakeout: mark at bar 20 → bars 0-15 count 1..16, 16-19 read +1..+4,
    // and the count restarts at the mark.
    const proj = resolveLadder(grid40(), marks(20))!;
    expect(barCountLabel(proj, 0)).toBe('1 of 16');
    expect(barCountLabel(proj, 12)).toBe('13 of 16');
    expect(barCountLabel(proj, 15)).toBe('16 of 16');
    expect(barCountLabel(proj, 16)).toBe('+1');
    expect(barCountLabel(proj, 19)).toBe('+4');
    expect(barCountLabel(proj, 20)).toBe('1 of 16');
    expect(barCountLabel(proj, 32)).toBe('13 of 16');
  });

  it('barCountLabel wraps within the top tier on the default ladder', () => {
    const proj = resolveLadder(grid40())!;
    expect(barCountLabel(proj, 16)).toBe('1 of 16');
    expect(barCountLabel(proj, 20)).toBe('5 of 16');
  });

  it('resolvedMarkTimes lands marks on the lattice, deduped; dormant when gridless', () => {
    const grid = grid40();
    const offGrid = [12 * barSec + 0.03, 12 * barSec - 0.02, 20 * barSec];
    expect(resolvedMarkTimes(grid, { reset_marks: offGrid })).toEqual([
      grid.downbeat_times[12],
      grid.downbeat_times[20],
    ]);
    expect(resolvedMarkTimes(null, { reset_marks: offGrid })).toEqual([]);
    expect(resolvedMarkTimes(grid, null)).toEqual([]);
  });

  it('unsorted and duplicate marks normalize; a mark at the origin is a no-op', () => {
    const a = resolveLadder(grid40(), marks(12, 4, 12))!;
    const b = resolveLadder(grid40(), marks(4, 12))!;
    expect(a.tiers).toEqual(b.tiers);
    expect(a.parentheticals).toEqual(b.parentheticals);

    const withZero = resolveLadder(grid40(), marks(0))!;
    const without = resolveLadder(grid40())!;
    expect(withZero.tiers).toEqual(without.tiers);
  });
});
