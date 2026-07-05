/**
 * Pure beat-domain snap helper (looping 01) — position → nearest gridline,
 * with graceful degradation when there is no grid.
 */
import { describe, expect, it } from 'vitest';
import { snapToNearestBeat } from './quantize';

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
