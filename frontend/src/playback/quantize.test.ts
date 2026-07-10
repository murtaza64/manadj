/**
 * Pure beat-domain snap helper (looping 01) — position → nearest gridline,
 * with graceful degradation when there is no grid.
 */
import { describe, expect, it } from 'vitest';
import {
  addBeats,
  crossDeckLaunchTarget,
  phasePreservingJumpTarget,
  snapToNearestBeat,
} from './quantize';

// A 120 BPM grid starting at 0.25s: beats every 0.5s.
const GRID = [0.25, 0.75, 1.25, 1.75, 2.25];

describe('snapToNearestBeat', () => {
  it('snaps down to the nearest earlier beat', () => {
    expect(snapToNearestBeat(0.9, GRID)).toBe(0.75);
  });

  it('snaps up to the nearest later beat', () => {
    expect(snapToNearestBeat(1.1, GRID)).toBe(1.25);
  });

  it('returns an exact gridline unchanged', () => {
    expect(snapToNearestBeat(1.25, GRID)).toBe(1.25);
  });

  it('breaks distance ties toward the earlier beat', () => {
    expect(snapToNearestBeat(1.0, GRID)).toBe(0.75);
  });

  it('clamps to the first beat before the grid', () => {
    expect(snapToNearestBeat(0.0, GRID)).toBe(0.25);
  });

  it('clamps to the last beat after the grid', () => {
    expect(snapToNearestBeat(99, GRID)).toBe(2.25);
  });

  it('degrades to the exact position without a grid', () => {
    expect(snapToNearestBeat(1.1, null)).toBe(1.1);
    expect(snapToNearestBeat(1.1, undefined)).toBe(1.1);
    expect(snapToNearestBeat(1.1, [])).toBe(1.1);
  });
});

describe('addBeats', () => {
  it('advances whole beats along the grid', () => {
    expect(addBeats(0.75, 2, GRID)).toBeCloseTo(1.75, 10);
  });

  it('carries an intra-beat offset', () => {
    expect(addBeats(0.9, 2, GRID)).toBeCloseTo(1.9, 10);
  });

  it('handles fractional beat counts', () => {
    expect(addBeats(0.75, 0.5, GRID)).toBeCloseTo(1.0, 10);
    expect(addBeats(0.75, 0.125, GRID)).toBeCloseTo(0.8125, 10);
  });

  it('extrapolates past the last beat at the edge beat length', () => {
    // Last interval is 0.5s; 2 beats past 2.25 = 3.25.
    expect(addBeats(2.25, 2, GRID)).toBeCloseTo(3.25, 10);
  });

  it('supports negative beat counts', () => {
    expect(addBeats(1.75, -2, GRID)).toBeCloseTo(0.75, 10);
  });
});

describe('phasePreservingJumpTarget', () => {
  it('pressing just after a beat lands at the cue plus the signed nearest-beat phase', () => {
    // playhead 1.3: nearest beat is 1.25, phase +0.05; cue on-grid at 0.75.
    expect(phasePreservingJumpTarget(0.75, 1.3, GRID)).toBeCloseTo(0.8, 10);
  });

  it('pressing just before a beat lands before the cue so the cue reaches the approaching beat', () => {
    // playhead 1.2: nearest beat is 1.25, phase -0.05; cue on-grid at 0.75.
    expect(phasePreservingJumpTarget(0.75, 1.2, GRID)).toBeCloseTo(0.7, 10);
  });

  it('keeps using the previous beat when it is the nearest gridline', () => {
    // playhead 1.4: nearest beat is 1.25, phase +0.15; cue on-grid at 0.75.
    expect(phasePreservingJumpTarget(0.75, 1.4, GRID)).toBeCloseTo(0.9, 10);
  });

  it('lands exactly on the cue when the playhead is on a gridline', () => {
    expect(phasePreservingJumpTarget(0.75, 1.75, GRID)).toBeCloseTo(0.75, 10);
  });

  it('snaps an off-grid cue to its nearest beat before adding the signed phase', () => {
    // cue 0.8 → nearest beat 0.75; playhead phase -0.05 → 0.7.
    expect(phasePreservingJumpTarget(0.8, 1.2, GRID)).toBeCloseTo(0.7, 10);
  });

  it('is a whole-beat displacement of the playhead', () => {
    const target = phasePreservingJumpTarget(0.75, 1.4, GRID);
    const beatLength = 0.5;
    const displacement = (1.4 - target) / beatLength;
    expect(displacement).toBeCloseTo(Math.round(displacement), 10);
  });

  it('degrades to the exact cue without a grid', () => {
    expect(phasePreservingJumpTarget(0.8, 1.4, null)).toBe(0.8);
    expect(phasePreservingJumpTarget(0.8, 1.4, [])).toBe(0.8);
  });

  it('uses the approaching first beat when the playhead is before the grid', () => {
    // playhead 0.1: nearest beat is 0.25, phase -0.15; cue 0.75 → 0.6.
    expect(phasePreservingJumpTarget(0.75, 0.1, GRID)).toBeCloseTo(0.6, 10);
  });
});

describe('crossDeckLaunchTarget', () => {
  // Reference deck's grid: beats every 0.5s (120 BPM) from 0.25s. GRID above.
  const cue = 10; // the launching deck's resolved launch position (its own domain).

  it('defers the launch when the reference beat is in the future', () => {
    // Reference playhead 1.1 → nearest beat 1.25, Δ = +0.15 (future).
    // Hold 0.15s, then enter exactly on the cue.
    const s = crossDeckLaunchTarget(cue, 1, { beatTimes: GRID, playhead: 1.1 });
    expect(s.delaySeconds).toBeCloseTo(0.15, 10);
    expect(s.at).toBeCloseTo(cue, 10);
  });

  it('launches immediately, entering ahead of the cue, when the reference beat just passed', () => {
    // Reference playhead 1.4 → nearest beat 1.25, Δ = -0.15 (past).
    // Start now as though playback began on that beat: enter 0.15s (× rate
    // 1) AFTER the cue, leaving the cue phase-locked 0.15s behind.
    const s = crossDeckLaunchTarget(cue, 1, { beatTimes: GRID, playhead: 1.4 });
    expect(s.delaySeconds).toBe(0);
    expect(s.at).toBeCloseTo(cue + 0.15, 10);
  });

  it('enters exactly on the cue with no delay when the reference is on a gridline', () => {
    // Reference playhead 1.25 is a beat: Δ = 0 → immediate, entry on cue.
    const s = crossDeckLaunchTarget(cue, 1, { beatTimes: GRID, playhead: 1.25 });
    expect(s.delaySeconds).toBe(0);
    expect(s.at).toBeCloseTo(cue, 10);
  });

  it('never defers more than half a reference beat (before/after boundary)', () => {
    const beatLength = 0.5;
    // Just before a beat (Δ just under half): defers ≤ half a beat.
    const before = crossDeckLaunchTarget(cue, 1, { beatTimes: GRID, playhead: 1.01 });
    expect(before.delaySeconds).toBeLessThanOrEqual(beatLength / 2 + 1e-9);
    // Just after a beat: launches immediately, entering a little ahead.
    const after = crossDeckLaunchTarget(cue, 1, { beatTimes: GRID, playhead: 1.26 });
    expect(after.delaySeconds).toBe(0);
    expect(after.at - cue).toBeLessThanOrEqual(beatLength / 2 + 1e-9);
  });

  it('scales the immediate ahead-entry by the launching deck playback rate', () => {
    // Δ = -0.1 at ref playhead 1.35 (nearest 1.25). At 2× rate, 0.1s real
    // maps to 0.2s of launching-deck audio position past the cue.
    const s = crossDeckLaunchTarget(cue, 2, { beatTimes: GRID, playhead: 1.35 });
    expect(s.delaySeconds).toBe(0);
    expect(s.at).toBeCloseTo(cue + 0.2, 10);
  });

  it('does not scale the deferred case by rate (enters exactly on cue)', () => {
    const s = crossDeckLaunchTarget(cue, 2, { beatTimes: GRID, playhead: 1.1 });
    expect(s.delaySeconds).toBeCloseTo(0.15, 10);
    expect(s.at).toBeCloseTo(cue, 10);
  });

  it('launches immediately at the exact cue without a usable reference', () => {
    expect(crossDeckLaunchTarget(cue, 1, null)).toEqual({ at: cue, delaySeconds: 0 });
    expect(crossDeckLaunchTarget(cue, 1, undefined)).toEqual({
      at: cue,
      delaySeconds: 0,
    });
    expect(crossDeckLaunchTarget(cue, 1, { beatTimes: [], playhead: 1.1 })).toEqual({
      at: cue,
      delaySeconds: 0,
    });
  });
});
