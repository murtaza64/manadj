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

  it('anchor: the earliest mark governs the pre-anchor region, counted BACKWARD (ADR 0030)', () => {
    // Mark at the real drop (bar 20) is the ladder anchor. Complete groups
    // peel recursively from it: 4 bars, then 16 bars nearest the anchor.
    const proj = resolveLadder(grid40(), marks(20))!;
    expect(proj.tiers[20]).toBe(4); // count restarts at the anchor
    expect(proj.barIndexes[20]).toBe(0);
    expect(proj.barIndexes[21]).toBe(1);
    expect(proj.parentheticals.slice(0, 20)).toEqual(new Array(20).fill(false));
    expect(proj.tiers[0]).toBe(2); // derived 4-bar group
    expect(proj.tiers[4]).toBe(4);
  });

  it('anchor: an 8-bar intro reads "1 of 8 … 8 of 8", not "9 of 16 …"', () => {
    // 8-bar intro into an anchored drop (bar 8). The largest group that
    // fits the 8-bar region is the 8-bar tier — no phantom 16.
    const proj = resolveLadder(grid40(), marks(8))!;
    expect(proj.parentheticals.slice(0, 8)).toEqual(new Array(8).fill(false));
    expect(barCountLabel(proj, 0)).toBe('1 of 8');
    expect(barCountLabel(proj, 7)).toBe('8 of 8');
    expect(barCountLabel(proj, 8)).toBe('1 of 16'); // anchored drop, full tier
    expect(proj.tiers[8]).toBe(4); // the anchor
    expect(proj.tiers[0]).toBe(3); // the 8-bar group opens the region
  });

  it('anchor: a 9-bar intro flags its pickup "+1" with zero extra marks', () => {
    // 9 bars before the anchor (bar 9): peel the largest that fits (8),
    // right-aligned to the anchor (bars 1-8); the leading bar 0 is "+1".
    const proj = resolveLadder(grid40(), marks(9))!;
    expect(proj.parentheticals[0]).toBe(true);
    expect(proj.parentheticals.slice(1, 9)).toEqual(new Array(8).fill(false));
    expect(barCountLabel(proj, 0)).toBe('+1');
    expect(barCountLabel(proj, 1)).toBe('1 of 8');
    expect(barCountLabel(proj, 8)).toBe('8 of 8');
    expect(proj.tiers[9]).toBe(4); // the anchor
  });

  it('includes inferred Grid-origin bars in backward peeling', () => {
    // The first stored downbeat is one bar after the inferred Grid origin.
    // With eight stored bars before the anchor, the inferred bar is the
    // leading pickup and the visible region is a clean 8.
    const period = 60 / 128;
    const grid = makeGrid([
      { startTime: period, bpm: 128, barPosition: 2, beats: 20 * 4 },
    ]);
    const proj = resolveLadder(grid, { reset_marks: [grid.downbeat_times[8]] })!;
    expect(proj.parentheticals.slice(0, 8)).toEqual(new Array(8).fill(false));
    expect(barCountLabel(proj, 0)).toBe('1 of 8');
    expect(barCountLabel(proj, 7)).toBe('8 of 8');
  });

  it('parenthetical ordinals include inferred bars before the first stored downbeat', () => {
    // Under a ternary first tier, five pre-anchor bars peel 3 and leave two.
    // The first remainder bar is inferred, so the first visible bar is +2.
    const period = 60 / 128;
    const grid = makeGrid([
      { startTime: period, bpm: 128, barPosition: 2, beats: 20 * 4 },
    ]);
    const proj = resolveLadder(grid, {
      arities: [3],
      reset_marks: [grid.downbeat_times[4]],
    })!;
    expect(proj.parentheticals[0]).toBe(true);
    expect(barCountLabel(proj, 0)).toBe('+2');
    expect(barCountLabel(proj, 1)).toBe('1 of 3');
  });

  it('anchor: a 20-bar intro peels a clean 4 + 16 backward', () => {
    const proj = resolveLadder(grid40(), marks(20))!;
    expect(barCountLabel(proj, 0)).toBe('1 of 4');
    expect(barCountLabel(proj, 3)).toBe('4 of 4');
    expect(barCountLabel(proj, 4)).toBe('1 of 16');
    expect(barCountLabel(proj, 19)).toBe('16 of 16');
    expect(barCountLabel(proj, 20)).toBe('1 of 16');
  });

  it('anchor: a bare anchor absorbs misalignment silently — a second mark SAYS "bonus bar"', () => {
    // A lone anchor on a 20-bar intro derives a clean 4 + 16.
    const one = resolveLadder(grid40(), marks(20))!;
    expect(one.parentheticals.slice(0, 20)).toEqual(new Array(20).fill(false));

    // A new earlier anchor demotes bar 20 to a reset. The 20 bars BETWEEN
    // marks keep forward semantics: 16 clean + 4 trailing bonus bars.
    const two = resolveLadder(grid40(), marks(0, 20))!;
    expect(two.parentheticals.slice(0, 16)).toEqual(new Array(16).fill(false));
    expect(two.parentheticals.slice(16, 20)).toEqual([true, true, true, true]);
    expect(two.tiers[20]).toBe(4);
  });

  it('anchor: a 24-bar intro peels 8 + 16, resetting the readout per group', () => {
    const proj = resolveLadder(grid40(), marks(24))!;
    expect(proj.parentheticals.slice(0, 24)).toEqual(new Array(24).fill(false));
    expect(barCountLabel(proj, 0)).toBe('1 of 8');
    expect(barCountLabel(proj, 7)).toBe('8 of 8');
    expect(barCountLabel(proj, 8)).toBe('1 of 16');
    expect(barCountLabel(proj, 23)).toBe('16 of 16');
  });

  it('anchor: regions longer than the top tier peel repeated top-tier groups', () => {
    const proj = resolveLadder(grid40(), marks(32))!;
    expect(barCountLabel(proj, 0)).toBe('1 of 16');
    expect(barCountLabel(proj, 15)).toBe('16 of 16');
    expect(barCountLabel(proj, 16)).toBe('1 of 16');
    expect(barCountLabel(proj, 31)).toBe('16 of 16');
  });

  it('anchor: adding a mark BEFORE the anchor re-anchors and demotes the old anchor to a reset', () => {
    // Ex2 intro-then-drop: anchor at the drop (bar 16), then mark the intro
    // start (bar 4). Bar 4 becomes the anchor; bar 16 stays a reset. The
    // pre-anchor region (0-3) counts backward from bar 4.
    const before = resolveLadder(grid40(), marks(16))!;
    // Lone anchor at 16: backward peel is one clean 16 (bars 0-15).
    expect(before.parentheticals.slice(0, 16)).toEqual(new Array(16).fill(false));
    expect(before.barIndexes[0]).toBe(0);

    const after = resolveLadder(grid40(), marks(4, 16))!;
    // Bar 4 is now the anchor; its pre-region (0-3) is a clean 4 backward.
    // The old anchor at 16 is now an ordinary reset, so bars 4-15 retain
    // forward semantics: 8 clean bars followed by four parentheticals.
    expect(after.tiers[4]).toBe(4);
    expect(after.tiers[16]).toBe(4);
    expect(after.parentheticals.slice(0, 12)).toEqual(new Array(12).fill(false));
    expect(after.parentheticals.slice(12, 16)).toEqual([true, true, true, true]);
    // Bars 0-3 count 1..4 backward-aligned to the bar-4 anchor.
    expect(after.barIndexes.slice(0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('final open segment is never parenthetical', () => {
    // 20 bars after the mark at 20 in a 40-bar grid: incomplete 16-group
    // at the tail, but no next reset to be short of.
    const proj = resolveLadder(grid40(), marks(20))!;
    expect(proj.parentheticals.slice(20)).toEqual(new Array(20).fill(false));
  });

  it('12-bar intro: recursive backward peel derives a clean 4 + 8', () => {
    const one = resolveLadder(grid40(), marks(12))!;
    expect(one.parentheticals.slice(0, 12)).toEqual(new Array(12).fill(false));
    expect(barCountLabel(one, 0)).toBe('1 of 4');
    expect(barCountLabel(one, 3)).toBe('4 of 4');
    expect(barCountLabel(one, 4)).toBe('1 of 8');
    expect(barCountLabel(one, 11)).toBe('8 of 8');

    // A mark at bar 4 demotes bar 12 to a reset and re-anchors at bar 4;
    // the pre-anchor 4 (0-3) is now a clean backward segment, 4+8 clean.
    const two = resolveLadder(grid40(), marks(4, 12))!;
    expect(two.parentheticals.slice(0, 12)).toEqual(new Array(12).fill(false));
    expect(two.tiers[4]).toBe(4); // re-anchor
    expect(two.barIndexes[4]).toBe(0);
  });

  it('mid-breakdown inserted bar: 9-bar pre-anchor + 8-bar segment', () => {
    // Anchor at bar 9, reset at the drop (bar 17). The pre-anchor 9 peels 8
    // backward (bars 1-8); the leading bar 0 is the inserted/pickup bar.
    const proj = resolveLadder(grid40(), marks(9, 17))!;
    expect(proj.parentheticals[0]).toBe(true); // the leading inserted bar
    expect(proj.parentheticals.slice(1, 9)).toEqual(new Array(8).fill(false));
    expect(proj.parentheticals.slice(9, 17)).toEqual(new Array(8).fill(false));
    expect(proj.tiers[9]).toBe(4);
    expect(proj.tiers[17]).toBe(4);
  });

  it('leading pickup: a 1-bar pre-anchor segment is all parenthetical', () => {
    // Anchor at bar 4; the single bar 3 before... no, mark bar 1 as anchor:
    // a 1-bar pre-anchor region (bar 0) is all pickup.
    const proj = resolveLadder(grid40(), marks(1))!;
    expect(proj.parentheticals[0]).toBe(true);
    expect(proj.barIndexes[1]).toBe(0);
    expect(proj.tiers[1]).toBe(4); // the anchor
  });

  it('marks resolve to the NEAREST downbeat and survive small grid shifts', () => {
    // 30ms off the bar-20 downbeat (a grid nudge later moved the lattice).
    const proj = resolveLadder(grid40(), { reset_marks: [20 * barSec + 0.03] })!;
    expect(proj.tiers[20]).toBe(4);
    expect(proj.barIndexes[20]).toBe(0);
  });

  it('barCountLabel: post-anchor counts in the top tier; pre-anchor uses peeled groups', () => {
    const proj = resolveLadder(grid40(), marks(20))!;
    expect(barCountLabel(proj, 0)).toBe('1 of 4');
    expect(barCountLabel(proj, 3)).toBe('4 of 4');
    expect(barCountLabel(proj, 4)).toBe('1 of 16');
    expect(barCountLabel(proj, 19)).toBe('16 of 16');
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
