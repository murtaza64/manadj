import { describe, expect, it } from 'vitest';
import { beatPhaseAt, beatPositionAt } from './beat';

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
});
