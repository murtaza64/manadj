import { describe, expect, it } from 'vitest';
import { firstNonSilentTime, resolveInitialCue } from './cueDefaults';

describe('resolveInitialCue', () => {
  it('prefers the saved cue over everything', () => {
    expect(
      resolveInitialCue({ saved: 42.5, firstBeat: 0.3, firstNonSilence: 1.1 })
    ).toBe(42.5);
  });

  it('falls back to the first beat when no cue is saved', () => {
    expect(
      resolveInitialCue({ saved: null, firstBeat: 0.3, firstNonSilence: 1.1 })
    ).toBe(0.3);
  });

  it('falls back to first non-silence without a beatgrid', () => {
    expect(
      resolveInitialCue({ saved: null, firstBeat: null, firstNonSilence: 1.1 })
    ).toBe(1.1);
  });

  it('falls back to 0 when nothing is known', () => {
    expect(
      resolveInitialCue({ saved: null, firstBeat: null, firstNonSilence: null })
    ).toBe(0);
  });

  it('treats a saved cue of 0 as a real cue, not absence', () => {
    expect(
      resolveInitialCue({ saved: 0, firstBeat: 0.3, firstNonSilence: 1.1 })
    ).toBe(0);
  });
});

describe('firstNonSilentTime', () => {
  const RATE = 100; // samples per second, for easy math

  function samples(values: number[]): Float32Array {
    return new Float32Array(values);
  }

  it('finds the first sample above the threshold', () => {
    const s = samples([0, 0, 0, 0, 0.5, 0.8]);
    expect(firstNonSilentTime(s, RATE)).toBeCloseTo(4 / RATE, 10);
  });

  it('counts negative excursions as sound', () => {
    const s = samples([0, 0, -0.5, 0.5]);
    expect(firstNonSilentTime(s, RATE)).toBeCloseTo(2 / RATE, 10);
  });

  it('ignores noise-floor samples below the threshold', () => {
    const s = samples([0.001, -0.002, 0.005, 0.9]);
    expect(firstNonSilentTime(s, RATE)).toBeCloseTo(3 / RATE, 10);
  });

  it('respects a custom threshold', () => {
    const s = samples([0.05, 0.2]);
    expect(firstNonSilentTime(s, RATE, 0.1)).toBeCloseTo(1 / RATE, 10);
    expect(firstNonSilentTime(s, RATE, 0.01)).toBeCloseTo(0, 10);
  });

  it('returns null for silence-only audio', () => {
    expect(firstNonSilentTime(samples([0, 0.001, -0.001, 0]), RATE)).toBeNull();
  });

  it('returns null for empty audio', () => {
    expect(firstNonSilentTime(samples([]), RATE)).toBeNull();
  });
});
