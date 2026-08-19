import { describe, expect, it } from 'vitest';
import {
  countSoloReviews,
  INITIAL_CYCLE,
  nextCandidateId,
  sampleParamValues,
  stepCycle,
} from './soloReview';

const LISTINGS = [
  { id: 'a', rating: 1050 },
  { id: 'b', rating: 1000 },
  { id: 'c', rating: 1100 },
];

describe('countSoloReviews', () => {
  it('counts only solo events by target', () => {
    const counts = countSoloReviews([
      { type: 'solo', target: 'a' },
      { type: 'solo', target: 'a' },
      { type: 'vote', target: 'a' },
      { type: 'solo', target: 'b' },
      { type: 'solo' },
    ]);
    expect(counts).toEqual({ a: 2, b: 1 });
  });
});

describe('nextCandidateId', () => {
  it('picks the least-reviewed candidate', () => {
    expect(nextCandidateId(LISTINGS, { a: 2, b: 0, c: 1 }, null)).toBe('b');
  });

  it('breaks count ties by higher rating', () => {
    expect(nextCandidateId(LISTINGS, {}, null)).toBe('c');
  });

  it('never returns the current candidate when others exist', () => {
    expect(nextCandidateId(LISTINGS, {}, 'c')).toBe('a');
  });

  it('returns the only candidate even if current', () => {
    expect(nextCandidateId([LISTINGS[0]], {}, 'a')).toBe('a');
  });

  it('returns null for an empty pool', () => {
    expect(nextCandidateId([], {}, null)).toBeNull();
  });
});

describe('sampleParamValues', () => {
  const params = [{ id: 'x', min: 0, max: 2, step: 0.05, default: 1 }];

  it('stays within bounds and snaps to step', () => {
    let call = 0;
    // Deterministic rng cycling through values incl. extremes.
    const rng = () => [0.9, 0.0001, 0.99, 0.2, 0.5, 0.8][call++ % 6];
    for (let i = 0; i < 20; i++) {
      const v = sampleParamValues(params, rng).x;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(2);
      expect(Math.round(v / 0.05) * 0.05).toBeCloseTo(v, 10);
    }
  });

  it('explores full range on the exploratory branch', () => {
    // First draw < 0.15 → uniform branch with rng()=0.999 → near max.
    let call = 0;
    const rng = () => (call++ === 0 ? 0.1 : 0.999);
    expect(sampleParamValues(params, rng).x).toBeCloseTo(2, 5);
  });

  it('centers on the default for the gaussian branch', () => {
    // u1=1 → gauss=0 → exactly the default.
    let call = 0;
    const rng = () => (call++ === 0 ? 0.9 : 1);
    expect(sampleParamValues(params, rng).x).toBe(1);
  });
});

describe('stepCycle', () => {
  it('off never advances', () => {
    const { advance } = stepCycle(INITIAL_CYCLE, 'off', 10_000_000, 1, 128);
    expect(advance).toBe(false);
  });

  it('timer advances after the period', () => {
    let s = { ...INITIAL_CYCLE, lastAdvanceAt: 0 };
    let r = stepCycle(s, 'timer', 44_000, 0, 128);
    expect(r.advance).toBe(false);
    r = stepCycle(r.state, 'timer', 45_001, 0, 128);
    expect(r.advance).toBe(true);
  });

  it('drop mode advances N beats after a rising edge', () => {
    // 128 bpm → 16 beats = 7500ms.
    let r = stepCycle(INITIAL_CYCLE, 'drop', 1000, 0.2, 128);
    expect(r.advance).toBe(false);
    r = stepCycle(r.state, 'drop', 2000, 0.8, 128); // rising edge, arm
    expect(r.advance).toBe(false);
    expect(r.state.dueAt).toBe(2000 + 7500);
    r = stepCycle(r.state, 'drop', 9000, 0.8, 128); // sustained, not due yet
    expect(r.advance).toBe(false);
    r = stepCycle(r.state, 'drop', 9501, 0.8, 128);
    expect(r.advance).toBe(true);
    expect(r.state.dueAt).toBeNull();
  });

  it('refractory ignores immediate re-triggers', () => {
    let r = stepCycle(INITIAL_CYCLE, 'drop', 1000, 0.8, 128); // edge, arm
    r = stepCycle(r.state, 'drop', 8501, 0.8, 128); // fires
    expect(r.advance).toBe(true);
    // dip + new edge inside refractory (20s from 1000): no re-arm
    r = stepCycle(r.state, 'drop', 9000, 0.2, 128);
    r = stepCycle(r.state, 'drop', 9500, 0.8, 128);
    expect(r.state.dueAt).toBeNull();
  });
});
