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
  it('counts solo verdicts and vote participation as exposure', () => {
    const counts = countSoloReviews([
      { type: 'solo', target: 'a' },
      { type: 'solo', target: 'a' },
      { type: 'vote', a: 'a', b: 'c' },
      { type: 'solo', target: 'b' },
      { type: 'note', target: 'b' },
      { type: 'solo' },
    ]);
    expect(counts).toEqual({ a: 3, b: 1, c: 1 });
  });
});

describe('nextCandidateId', () => {
  it('picks from the least-reviewed tier only', () => {
    expect(nextCandidateId(LISTINGS, { a: 2, b: 0, c: 1 }, null)).toBe('b');
  });

  it('picks randomly within a count tie (rng-driven)', () => {
    expect(nextCandidateId(LISTINGS, {}, null, () => 0)).toBe('a');
    expect(nextCandidateId(LISTINGS, {}, null, () => 0.99)).toBe('c');
  });

  it('covers the whole tier across draws (not a fixed descent)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const id = nextCandidateId(LISTINGS, {}, null);
      if (id) seen.add(id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('never returns the current candidate when others exist', () => {
    for (let i = 0; i < 20; i++) {
      expect(nextCandidateId(LISTINGS, {}, 'c')).not.toBe('c');
    }
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
    // 128 bpm → 128 beats = 60000ms.
    let r = stepCycle(INITIAL_CYCLE, 'drop', 1000, 0.2, 128);
    expect(r.advance).toBe(false);
    r = stepCycle(r.state, 'drop', 2000, 0.8, 128); // rising edge, arm
    expect(r.advance).toBe(false);
    expect(r.state.dueAt).toBe(2000 + 60000);
    r = stepCycle(r.state, 'drop', 61_000, 0.8, 128); // sustained, not due yet
    expect(r.advance).toBe(false);
    r = stepCycle(r.state, 'drop', 62_001, 0.8, 128);
    expect(r.advance).toBe(true);
    expect(r.state.dueAt).toBeNull();
  });

  it('a second drop inside the pending window advances immediately', () => {
    let r = stepCycle(INITIAL_CYCLE, 'drop', 1000, 0.8, 128); // edge, arm (due at 61s)
    expect(r.state.dueAt).not.toBeNull();
    // dip + a fresh drop mid-window (past refractory): cut NOW, not at 61s
    r = stepCycle(r.state, 'drop', 30_000, 0.2, 128);
    r = stepCycle(r.state, 'drop', 30_500, 0.8, 128);
    expect(r.advance).toBe(true);
    expect(r.state.dueAt).toBeNull();
  });

  it('the same drop cannot refire inside the refractory', () => {
    let r = stepCycle(INITIAL_CYCLE, 'drop', 1000, 0.8, 128); // edge, arm
    const due = r.state.dueAt;
    // dip + edge again within the 20s refractory: pending schedule untouched
    r = stepCycle(r.state, 'drop', 5_000, 0.2, 128);
    r = stepCycle(r.state, 'drop', 5_500, 0.8, 128);
    expect(r.advance).toBe(false);
    expect(r.state.dueAt).toBe(due);
  });
});
