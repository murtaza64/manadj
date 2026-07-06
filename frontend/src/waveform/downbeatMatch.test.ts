/**
 * Downbeat↔beat matching for the waveform renderer (ADR 0027 §8):
 * epsilon-based, not exact-float. The backend keeps the two arrays
 * consistent (issue 04 derives downbeats FROM the beat expansion), but the
 * failure mode of exact matching — ALL beat lines vanishing at zoomed-out
 * levels if either side ever derives independently — is worth the cheap
 * insurance.
 */
import { describe, expect, it } from 'vitest';
import { matchDownbeatIndices } from './WaveformRendererV2';

describe('matchDownbeatIndices', () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];

  it('matches exact floats (the correct-by-construction case)', () => {
    expect(matchDownbeatIndices(beats, [0, 2.0])).toEqual(new Set([0, 4]));
  });

  it('matches downbeats offset by 1e-9 (independent derivation insurance)', () => {
    expect(matchDownbeatIndices(beats, [0 + 1e-9, 2.0 - 1e-9])).toEqual(
      new Set([0, 4])
    );
  });

  it('does not match a mid-interval time to any beat', () => {
    expect(matchDownbeatIndices(beats, [0.25])).toEqual(new Set());
  });

  it('handles empty inputs', () => {
    expect(matchDownbeatIndices([], [1])).toEqual(new Set());
    expect(matchDownbeatIndices(beats, [])).toEqual(new Set());
  });
});
