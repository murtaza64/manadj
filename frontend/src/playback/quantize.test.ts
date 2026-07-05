/**
 * Pure beat-domain snap helper (looping 01) — position → nearest gridline,
 * with graceful degradation when there is no grid.
 */
import { describe, expect, it } from 'vitest';
import { phasePreservingJumpTarget, snapToNearestBeat } from './quantize';

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

describe('phasePreservingJumpTarget', () => {
  it('lands at the cue plus the playhead intra-beat phase', () => {
    // playhead 1.4: beat before is 1.25, phase 0.15; cue on-grid at 0.75.
    expect(phasePreservingJumpTarget(0.75, 1.4, GRID)).toBeCloseTo(0.9, 10);
  });

  it('lands exactly on the cue when the playhead is on a gridline', () => {
    expect(phasePreservingJumpTarget(0.75, 1.75, GRID)).toBeCloseTo(0.75, 10);
  });

  it('snaps an off-grid cue to its nearest beat before adding the phase', () => {
    // cue 0.8 → nearest beat 0.75; phase 0.15 → 0.9.
    expect(phasePreservingJumpTarget(0.8, 1.4, GRID)).toBeCloseTo(0.9, 10);
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

  it('degrades to the exact cue when the playhead is before the first beat', () => {
    expect(phasePreservingJumpTarget(0.75, 0.1, GRID)).toBe(0.75);
  });
});
