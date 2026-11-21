import { describe, expect, it } from 'vitest';
import type { BeatgridData } from '../types';
import { gridForOverlayRegions, projectGridToHorizon, silenceLoopEntry } from './gridProjection';

/** Mirror of backend beatgrid_utils.calculate_beats_from_tempo_changes. */
function walk(tempoChanges: BeatgridData['tempo_changes'], duration: number): BeatgridData {
  const beat_times: number[] = [];
  const downbeat_times: number[] = [];
  for (let i = 0; i < tempoChanges.length; i++) {
    const tc = tempoChanges[i];
    const interval = 60 / tc.bpm;
    const nextStart = i + 1 < tempoChanges.length ? tempoChanges[i + 1].start_time : null;
    let t = tc.start_time;
    let pos = tc.bar_position;
    while (t <= duration) {
      if (nextStart !== null && t >= nextStart - interval / 2) break;
      beat_times.push(t);
      if (pos === 1) downbeat_times.push(t);
      t += interval;
      pos = (pos % tc.time_signature_num) + 1;
    }
  }
  return { tempo_changes: tempoChanges, beat_times, downbeat_times };
}

const c120 = [{ start_time: 0, bpm: 120, time_signature_num: 4, time_signature_den: 4, bar_position: 1 }];

describe('projectGridToHorizon', () => {
  it('extends the final segment lattice past EOF without touching the stored prefix', () => {
    const grid = walk(c120, 300); // 120bpm 4/4: beats 0..300 step 0.5
    const n = grid.beat_times.length;
    const out = projectGridToHorizon(grid, 310);
    expect(out.beat_times.slice(0, n)).toEqual(grid.beat_times);
    expect(out.downbeat_times.slice(0, grid.downbeat_times.length)).toEqual(grid.downbeat_times);
    expect(out.tempo_changes).toBe(grid.tempo_changes);
    // Appended beats continue the 0.5s lattice: 300.5 .. 310.x
    const appended = out.beat_times.slice(n);
    expect(appended[0]).toBeCloseTo(300.5, 9);
    expect(appended[appended.length - 1]).toBeGreaterThanOrEqual(310);
    expect(appended[1] - appended[0]).toBeCloseTo(0.5, 9);
    // Appended downbeats stay on the 4-beat bar phase: 302, 304, ...
    const appendedDb = out.downbeat_times.slice(grid.downbeat_times.length);
    expect(appendedDb[0]).toBeCloseTo(302, 9);
    expect(appendedDb[1] - appendedDb[0]).toBeCloseTo(2, 9);
  });

  it('returns the grid unchanged when coverage already reaches the horizon', () => {
    const grid = walk(c120, 300);
    expect(projectGridToHorizon(grid, 250)).toBe(grid);
    expect(projectGridToHorizon(grid, 300)).toBe(grid);
  });

  it('continues a multi-segment grid on the FINAL segment only', () => {
    const two = [
      { start_time: 0, bpm: 120, time_signature_num: 4, time_signature_den: 4, bar_position: 1 },
      { start_time: 100, bpm: 60, time_signature_num: 4, time_signature_den: 4, bar_position: 1 },
    ];
    const grid = walk(two, 120); // final segment: 1s beats from t=100
    const n = grid.beat_times.length;
    const out = projectGridToHorizon(grid, 126);
    const appended = out.beat_times.slice(n);
    expect(appended[0] - grid.beat_times[n - 1]).toBeCloseTo(1, 9);
    expect(appended[1] - appended[0]).toBeCloseTo(1, 9);
    // Bar phase of the final segment: downbeats at 100, 104, ... then 124
    const appendedDb = out.downbeat_times.slice(grid.downbeat_times.length);
    expect(appendedDb[0]).toBeCloseTo(124, 9);
  });

  it('returns empty grids unchanged', () => {
    const empty: BeatgridData = { tempo_changes: [], beat_times: [], downbeat_times: [] };
    expect(projectGridToHorizon(empty, 100)).toBe(empty);
  });
});

describe('silenceLoopEntry', () => {
  it('enters at the first projected 16-bar boundary at/after last audible, past EOF', () => {
    // 120bpm 4/4: 16 bars = 32s; boundaries at 0, 32, ..., 288, 320, ...
    const grid = walk(c120, 300);
    const entry = silenceLoopEntry(grid, null, 299.3);
    expect(entry).not.toBeNull();
    expect(entry!.entrySec).toBeCloseTo(320, 9); // past the 300s EOF
    expect(entry!.loopLengthBeats).toBe(64);
    expect(entry!.loopLengthSec).toBeCloseTo(32, 9);
  });

  it('uses the boundary AT the sample when it lands exactly on one', () => {
    const grid = walk(c120, 300);
    const entry = silenceLoopEntry(grid, null, 288);
    expect(entry!.entrySec).toBeCloseTo(288, 9);
  });

  it('respects a Reset mark: the mark downbeat carries the top tier', () => {
    const grid = walk(c120, 300);
    // Reset at 296s (a downbeat): counting restarts, so 296 is a top-tier
    // boundary and the next is 328 - not the origin-aligned 320.
    const entry = silenceLoopEntry(grid, { reset_marks: [296] }, 295);
    expect(entry!.entrySec).toBeCloseTo(296, 9);
    const after = silenceLoopEntry(grid, { reset_marks: [296] }, 297);
    expect(after!.entrySec).toBeCloseTo(328, 9);
  });

  it('returns null for gridless tracks (D4: keep stop-at-end)', () => {
    const empty: BeatgridData = { tempo_changes: [], beat_times: [], downbeat_times: [] };
    expect(silenceLoopEntry(empty, null, 100)).toBeNull();
    expect(silenceLoopEntry(null, null, 100)).toBeNull();
  });

  it('fixed64 gate: a custom ladder whose top tier is not 64 beats gets no entry', () => {
    const grid = walk(c120, 300);
    // Top tier 8 bars = 32 beats: unresolved semantics, keep stop-at-end.
    expect(silenceLoopEntry(grid, { arities: [2, 2, 2], reset_marks: [] }, 299.3)).toBeNull();
    // Top tier 32 bars = 128 beats: likewise gated.
    expect(silenceLoopEntry(grid, { arities: [2, 2, 2, 2, 2], reset_marks: [] }, 299.3)).toBeNull();
  });

  it('fixed64 gate: a custom ladder whose top tier spans 64 beats still enters', () => {
    const grid = walk(c120, 300);
    // [4,4] -> top tier 16 bars = 64 beats: same entry lattice as default.
    const entry = silenceLoopEntry(grid, { arities: [4, 4], reset_marks: [] }, 299.3);
    expect(entry).not.toBeNull();
    expect(entry!.entrySec).toBeCloseTo(320, 9);
    expect(entry!.loopLengthBeats).toBe(64);
  });

  it('fixed64 gate: non-4/4 meters get no entry (16 bars of 3/4 = 48 beats)', () => {
    const waltz = [
      { start_time: 0, bpm: 120, time_signature_num: 3, time_signature_den: 4, bar_position: 1 },
    ];
    const grid = walk(waltz, 300);
    expect(silenceLoopEntry(grid, null, 299.3)).toBeNull();
  });
});

describe('gridForOverlayRegions (gh#424 tail rendering)', () => {
  it('returns the grid unchanged when no region crosses EOF', () => {
    const grid = walk(c120, 300);
    expect(gridForOverlayRegions(grid, [], 300)).toBe(grid);
    expect(gridForOverlayRegions(grid, [120, 288], 300)).toBe(grid);
  });

  it('extends the lattice to cover a silence-loop region past EOF', () => {
    const grid = walk(c120, 300);
    const n = grid.beat_times.length;
    const out = gridForOverlayRegions(grid, [352], 300); // 64 beats at 120bpm = 32s, entry 320
    expect(out).not.toBe(grid);
    expect(out.beat_times.slice(0, n)).toEqual(grid.beat_times);
    expect(out.beat_times[out.beat_times.length - 1]).toBeGreaterThanOrEqual(352);
    // Downbeats continue on the same 4-beat bar phase past EOF.
    const lastDb = out.downbeat_times[out.downbeat_times.length - 1];
    expect(lastDb).toBeGreaterThan(300);
    expect(lastDb % 2).toBeCloseTo(0, 9);
  });
});
