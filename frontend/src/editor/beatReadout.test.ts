/** Beat-domain readout conversions (mix-editor 18). */
import { describe, expect, it } from 'vitest';
import {
  barBeatLabel,
  barLength,
  bEntryLabel,
  beatIndexAt,
  beatsBetween,
  jumpDeltaLabel,
  lengthBeatsLabel,
} from './beatReadout';
import type { BeatgridData } from '../types';

/** 120 BPM grid (0.5s beats) starting at `offset`, 64 beats, bars of 4. */
function grid(offset = 0, beats = 64, period = 0.5): BeatgridData {
  const beat_times = Array.from({ length: beats }, (_, i) => offset + i * period);
  const downbeat_times = beat_times.filter((_, i) => i % 4 === 0);
  return {
    beat_times,
    downbeat_times,
    tempo_changes: [
      {
        start_time: offset,
        bpm: 60 / period,
        time_signature_num: 4,
        time_signature_den: 4,
        bar_position: 0,
      },
    ],
  } as BeatgridData;
}

describe('beatIndexAt', () => {
  it('exact beats, interpolation, and edge extrapolation', () => {
    const bt = grid().beat_times;
    expect(beatIndexAt(bt, 0)).toBe(0);
    expect(beatIndexAt(bt, 1.0)).toBe(2);
    expect(beatIndexAt(bt, 1.25)).toBeCloseTo(2.5);
    expect(beatIndexAt(bt, -0.5)).toBeCloseTo(-1); // before first beat
    expect(beatIndexAt(bt, 32.0)).toBeCloseTo(64); // past last beat
    expect(beatIndexAt([1], 0)).toBeNull();
  });

  it('handles grids that do not start at t=0', () => {
    const bt = grid(10).beat_times;
    expect(beatIndexAt(bt, 10)).toBe(0);
    expect(beatIndexAt(bt, 12)).toBeCloseTo(4);
  });

  it('variable grids interpolate per-interval', () => {
    // 1s beats then 0.5s beats.
    const bt = [0, 1, 2, 2.5, 3];
    expect(beatIndexAt(bt, 1.5)).toBeCloseTo(1.5);
    expect(beatIndexAt(bt, 2.25)).toBeCloseTo(2.5);
  });
});

describe('beatsBetween / barLength', () => {
  it('counts fractional beats across the grid', () => {
    const bt = grid().beat_times;
    expect(beatsBetween(bt, 2, 18)).toBeCloseTo(32);
    expect(beatsBetween(bt, 0, 0.75)).toBeCloseTo(1.5);
  });

  it('infers beats-per-bar from downbeats (fallback 4)', () => {
    expect(barLength(grid())).toBe(4);
    const g = grid();
    g.downbeat_times = [];
    expect(barLength(g)).toBe(4);
  });
});

describe('barBeatLabel', () => {
  it('whole positions read clean: bar.beat, 1-based', () => {
    const g = grid();
    expect(barBeatLabel(g, 0)).toBe('1.1');
    expect(barBeatLabel(g, 1.5)).toBe('1.4');
    expect(barBeatLabel(g, 2.0)).toBe('2.1');
    expect(barBeatLabel(g, 16.0)).toBe('9.1');
  });

  it('off-grid positions round to the nearest beat with a ~ prefix', () => {
    expect(barBeatLabel(grid(), 0.3)).toBe('~1.2'); // 0.6 beats → nearest 1
    expect(barBeatLabel(grid(), 0.51)).toBe('1.2'); // within eps of beat 1
  });

  it('grids with an offset origin place bar 1 at the first downbeat', () => {
    const g = grid(10);
    expect(barBeatLabel(g, 10)).toBe('1.1');
    expect(barBeatLabel(g, 12)).toBe('2.1');
  });
});

describe('lengthBeatsLabel', () => {
  it('whole bar multiples call out bars', () => {
    expect(lengthBeatsLabel(grid(), 2, 16)).toBe('32 beats (8 bars)');
  });

  it('whole beats without bar multiple, and fractional lengths', () => {
    expect(lengthBeatsLabel(grid(), 0, 1.5)).toBe('3 beats');
    expect(lengthBeatsLabel(grid(), 0, 1.75)).toBe('3.5 beats');
  });
});

describe('bEntryLabel', () => {
  it('non-negative anchors read as B grid position', () => {
    expect(bEntryLabel(grid(), 2.0)).toBe('2.1');
  });

  it('negative anchors read as lead gap in B beats', () => {
    expect(bEntryLabel(grid(), -2.0)).toBe('gap 4 beats');
    expect(bEntryLabel(grid(), -1.25)).toBe('gap 2.5 beats');
  });
});

describe('jumpDeltaLabel (transition-takes 01)', () => {
  it('reads whole B-beats when a grid makes them readable', () => {
    expect(jumpDeltaLabel(-8, 0.5)).toBe('-16 bt'); // 0.5s beats
    expect(jumpDeltaLabel(2, 0.5)).toBe('+4 bt');
  });

  it('falls back to seconds off-grid or without a grid', () => {
    expect(jumpDeltaLabel(-7.37, 0.5)).toBe('-7.4s');
    expect(jumpDeltaLabel(3.2, null)).toBe('+3.2s');
  });

  it('a near-zero delta reads as seconds, never "0 bt"', () => {
    expect(jumpDeltaLabel(0.01, 0.5)).toBe('+0.0s');
  });
});
