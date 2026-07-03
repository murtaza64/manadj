import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VISIBLE_SECONDS,
  MAX_VISIBLE_SECONDS,
  MIN_VISIBLE_SECONDS,
  clampVisibleSeconds,
  stepVisibleSeconds,
  visibleSecondsForZoom,
  zoomFactorForVisibleSeconds,
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

describe('zoomFactorForVisibleSeconds', () => {
  it('is duration / visible seconds', () => {
    expect(zoomFactorForVisibleSeconds(300, 20)).toBeCloseTo(15, 10);
    expect(zoomFactorForVisibleSeconds(600, 20)).toBeCloseTo(30, 10);
  });

  it('gives the same seconds-per-pixel for different durations', () => {
    // The whole point: visibleFraction × duration is the same timespan.
    const a = 300 / zoomFactorForVisibleSeconds(300, 20);
    const b = 421.7 / zoomFactorForVisibleSeconds(421.7, 20);
    expect(a).toBeCloseTo(b, 10);
  });

  it('never zooms wider than the whole track', () => {
    expect(zoomFactorForVisibleSeconds(10, 20)).toBe(1);
  });

  it('clamps the requested seconds first', () => {
    expect(zoomFactorForVisibleSeconds(600, 1)).toBeCloseTo(600 / MIN_VISIBLE_SECONDS, 10);
  });

  it('caps the factor for very long files (geometry guard rail)', () => {
    expect(zoomFactorForVisibleSeconds(7200, 4)).toBe(400);
  });

  it('degenerate durations show the whole track', () => {
    expect(zoomFactorForVisibleSeconds(0, 20)).toBe(1);
    expect(zoomFactorForVisibleSeconds(-5, 20)).toBe(1);
    expect(zoomFactorForVisibleSeconds(NaN, 20)).toBe(1);
    expect(zoomFactorForVisibleSeconds(Infinity, 20)).toBe(1);
  });
});

describe('visibleSecondsForZoom', () => {
  it('inverts the factor conversion', () => {
    expect(visibleSecondsForZoom(300, zoomFactorForVisibleSeconds(300, 25))).toBeCloseTo(
      25,
      10
    );
  });

  it('degenerate inputs fall back to the default', () => {
    expect(visibleSecondsForZoom(0, 16)).toBe(DEFAULT_VISIBLE_SECONDS);
    expect(visibleSecondsForZoom(300, 0)).toBe(DEFAULT_VISIBLE_SECONDS);
    expect(visibleSecondsForZoom(NaN, 16)).toBe(DEFAULT_VISIBLE_SECONDS);
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
