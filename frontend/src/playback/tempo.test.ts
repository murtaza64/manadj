import { describe, expect, it } from 'vitest';
import { bpmMatch, composeRate, effectiveBpm, keyDrifted } from './tempo';

describe('composeRate', () => {
  it('is unity with no pitch and no bend', () => {
    expect(composeRate(0, 0)).toBe(1);
  });

  it('matches pitch-only rate when bend is zero', () => {
    expect(composeRate(8, 0)).toBeCloseTo(1.08, 10);
    expect(composeRate(-8, 0)).toBeCloseTo(0.92, 10);
  });

  it('stacks bend multiplicatively on pitch', () => {
    expect(composeRate(8, 2)).toBeCloseTo(1.08 * 1.02, 10);
    expect(composeRate(-4, -2)).toBeCloseTo(0.96 * 0.98, 10);
  });

  it('zero bend IS the pitch-only rate (release restores exactly)', () => {
    expect(composeRate(3.7, 0)).toBe(1 + 3.7 / 100);
    expect(composeRate(-6.25, 0)).toBe(1 - 6.25 / 100);
    expect(composeRate(3.7, 2)).not.toBe(composeRate(3.7, 0));
  });
});

describe('effectiveBpm', () => {
  it('is base BPM at zero pitch', () => {
    expect(effectiveBpm(128, 0)).toBe(128);
  });

  it('scales with pitch', () => {
    expect(effectiveBpm(100, 8)).toBeCloseTo(108, 10);
    expect(effectiveBpm(100, -8)).toBeCloseTo(92, 10);
  });
});

describe('keyDrifted (key-lock 04)', () => {
  it('marks an unlocked deck at |pitch| ≥ the threshold, both directions', () => {
    expect(keyDrifted(false, 3)).toBe(true);
    expect(keyDrifted(false, -3)).toBe(true);
    expect(keyDrifted(false, 8)).toBe(true);
  });

  it('stays quiet below the threshold', () => {
    expect(keyDrifted(false, 0)).toBe(false);
    expect(keyDrifted(false, 2.9)).toBe(false);
    expect(keyDrifted(false, -2.9)).toBe(false);
  });

  it('a locked Deck never drifts, regardless of pitch', () => {
    expect(keyDrifted(true, 8)).toBe(false);
    expect(keyDrifted(true, -8)).toBe(false);
  });
});

describe('bpmMatch', () => {
  it('matches the other deck directly when in range', () => {
    const r = bpmMatch(126, 128);
    expect(r).toEqual({ kind: 'match', pitchPercent: expect.closeTo((128 / 126 - 1) * 100, 10) });
  });

  it('matches exactly at zero when BPMs are equal', () => {
    expect(bpmMatch(128, 128)).toEqual({ kind: 'match', pitchPercent: 0 });
  });

  it('falls back to double-time when direct is out of reach', () => {
    // own 170 vs other 87: direct needs -48.8%, double (174) needs +2.35%.
    const r = bpmMatch(170, 87);
    expect(r).toEqual({
      kind: 'match',
      pitchPercent: expect.closeTo((174 / 170 - 1) * 100, 10),
    });
  });

  it('falls back to half-time when direct is out of reach', () => {
    // own 85 vs other 168: direct needs +97.6%, half (84) needs -1.18%.
    const r = bpmMatch(85, 168);
    expect(r).toEqual({
      kind: 'match',
      pitchPercent: expect.closeTo((84 / 85 - 1) * 100, 10),
    });
  });

  it('prefers the direct match whenever it reaches', () => {
    // At ±8%, no two candidates can reach simultaneously (they sit a factor
    // of 2 apart), so direct-preference manifests as: direct wins whenever
    // it is reachable, regardless of the others.
    expect(bpmMatch(100, 98)).toEqual({
      kind: 'match',
      pitchPercent: expect.closeTo(-2, 10),
    });
    expect(bpmMatch(15, 14)).toEqual({
      kind: 'match',
      pitchPercent: expect.closeTo((14 / 15 - 1) * 100, 10),
    });
  });

  it('reports out-of-reach when no candidate is within ±8%', () => {
    expect(bpmMatch(100, 130)).toEqual({ kind: 'out-of-reach' });
    expect(bpmMatch(128, 100)).toEqual({ kind: 'out-of-reach' });
  });

  it('honors the exact ±8% boundary', () => {
    expect(bpmMatch(100, 108)).toEqual({
      kind: 'match',
      pitchPercent: expect.closeTo(8, 10),
    });
    expect(bpmMatch(100, 108.001)).toEqual({ kind: 'out-of-reach' });
  });

  it('matches against the other deck effective BPM, not base', () => {
    // Caller passes effective BPM; a pitched-up other deck shifts the target.
    const other = effectiveBpm(120, 5); // 126
    expect(bpmMatch(128, other)).toEqual({
      kind: 'match',
      pitchPercent: expect.closeTo((126 / 128 - 1) * 100, 10),
    });
  });
});
