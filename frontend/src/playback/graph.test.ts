import { describe, expect, it } from 'vitest';
import { eqValueToGain, sweepPositionToFilter } from './graph';

describe('eqValueToGain', () => {
  it('kills to exactly zero at the bottom', () => {
    expect(eqValueToGain(0)).toBe(0);
  });

  it('is exactly unity at center', () => {
    expect(eqValueToGain(0.5)).toBe(1);
  });

  it('boosts to +6 dB at the top', () => {
    expect(eqValueToGain(1)).toBeCloseTo(Math.pow(10, 6 / 20), 10);
  });

  it('is linear in amplitude in the bottom half', () => {
    expect(eqValueToGain(0.25)).toBeCloseTo(0.5, 10);
    expect(eqValueToGain(0.1)).toBeCloseTo(0.2, 10);
  });

  it('is linear in dB in the top half', () => {
    expect(eqValueToGain(0.75)).toBeCloseTo(Math.pow(10, 3 / 20), 10);
  });

  it('clamps out-of-range values', () => {
    expect(eqValueToGain(-0.5)).toBe(0);
    expect(eqValueToGain(1.5)).toBeCloseTo(Math.pow(10, 6 / 20), 10);
  });
});

describe('sweepPositionToFilter', () => {
  const BYPASS_HZ = 20000;
  const BUTTERWORTH_Q_DB = -3.0103;

  it('bypasses in the center deadzone as a wide-open lowpass', () => {
    for (const pos of [0, 0.04, -0.04]) {
      const f = sweepPositionToFilter(pos);
      expect(f.type).toBe('lowpass');
      expect(f.frequency).toBe(BYPASS_HZ);
      expect(f.qDb).toBeCloseTo(BUTTERWORTH_Q_DB, 3);
    }
  });

  it('sweeps to a resonant 80 Hz lowpass at full negative', () => {
    const f = sweepPositionToFilter(-1);
    expect(f.type).toBe('lowpass');
    expect(f.frequency).toBeCloseTo(80, 6);
    expect(f.qDb).toBeGreaterThan(0);
  });

  it('sweeps to a resonant 8 kHz highpass at full positive', () => {
    const f = sweepPositionToFilter(1);
    expect(f.type).toBe('highpass');
    expect(f.frequency).toBeCloseTo(8000, 6);
    expect(f.qDb).toBeGreaterThan(0);
  });

  it('lowers the lowpass cutoff monotonically as position goes further negative', () => {
    const f1 = sweepPositionToFilter(-0.2);
    const f2 = sweepPositionToFilter(-0.5);
    const f3 = sweepPositionToFilter(-0.8);
    expect(f1.type).toBe('lowpass');
    expect(f1.frequency).toBeGreaterThan(f2.frequency);
    expect(f2.frequency).toBeGreaterThan(f3.frequency);
    expect(f3.frequency).toBeGreaterThan(80);
    expect(f1.frequency).toBeLessThan(BYPASS_HZ);
  });

  it('raises the highpass cutoff monotonically as position goes further positive', () => {
    const f1 = sweepPositionToFilter(0.2);
    const f2 = sweepPositionToFilter(0.5);
    const f3 = sweepPositionToFilter(0.8);
    expect(f1.type).toBe('highpass');
    expect(f1.frequency).toBeLessThan(f2.frequency);
    expect(f2.frequency).toBeLessThan(f3.frequency);
    expect(f3.frequency).toBeLessThan(8000);
    expect(f1.frequency).toBeGreaterThan(20);
  });

  it('clamps positions beyond the ends', () => {
    expect(sweepPositionToFilter(-2)).toEqual(sweepPositionToFilter(-1));
    expect(sweepPositionToFilter(2)).toEqual(sweepPositionToFilter(1));
  });
});
