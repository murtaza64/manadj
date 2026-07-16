import { describe, expect, it } from 'vitest';
import { LIVE_OUTPUT_CEILING, samplePeakCeilingCurve } from './gainStaging';

describe('samplePeakCeilingCurve', () => {
  it('uses the chosen -2 dBFS live ceiling', () => {
    expect(20 * Math.log10(LIVE_OUTPUT_CEILING)).toBeCloseTo(-2, 10);
  });

  it('is linear below the ceiling and bounded at both ends', () => {
    const curve = samplePeakCeilingCurve(LIVE_OUTPUT_CEILING, 9);
    expect(curve[0]).toBeCloseTo(-LIVE_OUTPUT_CEILING, 6);
    expect(curve[2]).toBeCloseTo(-0.5, 6);
    expect(curve[4]).toBe(0);
    expect(curve[6]).toBeCloseTo(0.5, 6);
    expect(curve[8]).toBeCloseTo(LIVE_OUTPUT_CEILING, 6);
  });

  it('rejects invalid curve domains', () => {
    expect(() => samplePeakCeilingCurve(0)).toThrow(RangeError);
    expect(() => samplePeakCeilingCurve(1, 4)).toThrow(RangeError);
  });
});
