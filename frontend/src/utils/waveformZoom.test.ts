import { describe, expect, it } from 'vitest';
import { composeRate } from '../playback/tempo';
import {
  DEFAULT_VISIBLE_SECONDS,
  MAX_VISIBLE_SECONDS,
  MIN_VISIBLE_SECONDS,
  clampVisibleSeconds,
  STEP_RATIO,
  stepVisibleSeconds,
  trackWindowSeconds,
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
  it('zooming in shows fewer seconds, out shows more (one shared ratio)', () => {
    expect(stepVisibleSeconds(20, 'in')).toBeCloseTo(20 / STEP_RATIO, 10);
    expect(stepVisibleSeconds(20, 'out')).toBeCloseTo(20 * STEP_RATIO, 10);
  });

  it('in/out round-trips', () => {
    expect(stepVisibleSeconds(stepVisibleSeconds(20, 'in'), 'out')).toBeCloseTo(20, 10);
  });

  it('clamps at the bounds', () => {
    expect(stepVisibleSeconds(MIN_VISIBLE_SECONDS, 'in')).toBe(MIN_VISIBLE_SECONDS);
    expect(stepVisibleSeconds(MAX_VISIBLE_SECONDS, 'out')).toBe(MAX_VISIBLE_SECONDS);
  });
});

describe('trackWindowSeconds (performance-mode 06)', () => {
  it('unpitched decks render the shared window unchanged', () => {
    expect(trackWindowSeconds(20, 1)).toBe(20);
  });

  it('equal effective BPM means equal beats in the viewport', () => {
    // Deck A: 120 BPM at 0%. Deck B: 126 BPM pitched down to 120 effective.
    const sharedZoom = 20;
    const pitchB = (120 / 126 - 1) * 100;
    const beatsA = (120 / 60) * trackWindowSeconds(sharedZoom, composeRate(0, 0));
    const beatsB = (126 / 60) * trackWindowSeconds(sharedZoom, composeRate(pitchB, 0));
    expect(beatsB).toBeCloseTo(beatsA, 10);
  });

  it('the window follows pitch (callers pass a pitch-only rate; bend excluded)', () => {
    expect(trackWindowSeconds(20, composeRate(5, 0))).toBeCloseTo(21, 10);
  });

  it('the wheel round-trip stays rate-free: scaling then unscaling is exact', () => {
    const rate = composeRate(5.5, 0);
    expect(trackWindowSeconds(20, rate) / rate).toBeCloseTo(20, 10);
  });
});
