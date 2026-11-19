import { describe, expect, it } from 'vitest';
import { extendBeatTimesPastEof } from './gridExtend';

describe('extendBeatTimesPastEof (gh#424)', () => {
  it('appends beats on the final interval up to the horizon', () => {
    const grid = [0, 0.5, 1.0, 1.5]; // 120 BPM
    const out = extendBeatTimesPastEof(grid, 3.0);
    expect(out).toEqual([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
  });

  it('never mutates or reuses the stored array', () => {
    const grid = [0, 0.5, 1.0];
    const out = extendBeatTimesPastEof(grid, 5);
    expect(out).not.toBe(grid);
    expect(grid).toEqual([0, 0.5, 1.0]);
    expect(out.slice(0, 3)).toEqual(grid);
  });

  it('returns a copy unchanged when the grid already covers the horizon', () => {
    const grid = [0, 0.5, 1.0, 1.5];
    const out = extendBeatTimesPastEof(grid, 1.0);
    expect(out).toEqual(grid);
    expect(out).not.toBe(grid);
  });

  it('degrades on empty and single-beat grids', () => {
    expect(extendBeatTimesPastEof([], 10)).toEqual([]);
    expect(extendBeatTimesPastEof([1.0], 10)).toEqual([1.0]);
  });

  it('lets addBeats-style math land past EOF: a 4-beat loop engaged one beat before EOF projects past it', () => {
    // 120 BPM grid ending at 2.0s (EOF), horizon one bar past.
    const grid = [0, 0.5, 1.0, 1.5, 2.0];
    const out = extendBeatTimesPastEof(grid, 4.0);
    // Engage at 1.5, 4 beats: end must be 3.5, past the stored EOF of 2.0.
    expect(out[out.length - 1]).toBeGreaterThanOrEqual(3.5);
    expect(out[out.indexOf(1.5) + 4]).toBeCloseTo(3.5, 10);
  });
});
