import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VISIBLE_SECONDS,
  MAX_VISIBLE_SECONDS,
  MIN_VISIBLE_SECONDS,
  clampVisibleSeconds,
  stepVisibleSeconds,
} from './waveformZoom';

describe('clampVisibleSeconds', () => {
  it('passes values inside the bounds through', () => {
    expect(clampVisibleSeconds(20)).toBe(20);
  });

  it('clamps to the seconds bounds', () => {
    expect(clampVisibleSeconds(0.5)).toBe(MIN_VISIBLE_SECONDS);
    expect(clampVisibleSeconds(10_000)).toBe(MAX_VISIBLE_SECONDS);
  });

  it('falls back to the default on nonsense', () => {
    expect(clampVisibleSeconds(NaN)).toBe(DEFAULT_VISIBLE_SECONDS);
    expect(clampVisibleSeconds(Infinity)).toBe(DEFAULT_VISIBLE_SECONDS);
  });
});

describe('stepVisibleSeconds', () => {
  it('zooming in shows fewer seconds, out shows more', () => {
    expect(stepVisibleSeconds(24, 'in')).toBeCloseTo(20, 10);
    expect(stepVisibleSeconds(20, 'out')).toBeCloseTo(24, 10);
  });

  it('in/out round-trips', () => {
    expect(stepVisibleSeconds(stepVisibleSeconds(20, 'in'), 'out')).toBeCloseTo(20, 10);
  });

  it('clamps at the bounds', () => {
    expect(stepVisibleSeconds(MIN_VISIBLE_SECONDS, 'in')).toBe(MIN_VISIBLE_SECONDS);
    expect(stepVisibleSeconds(MAX_VISIBLE_SECONDS, 'out')).toBe(MAX_VISIBLE_SECONDS);
  });
});
