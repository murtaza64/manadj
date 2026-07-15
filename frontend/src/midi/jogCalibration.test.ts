import { describe, expect, it } from 'vitest';
import { DEFAULT_JOG_CALIBRATION, GRV6_JOG_CALIBRATION } from './jogCalibration';

describe('jog calibration profiles', () => {
  it('preserves the established controller defaults for mappings without a profile', () => {
    expect(DEFAULT_JOG_CALIBRATION).toEqual({
      bendPercentPerTick: 10,
      bendMaxPercent: 8,
      bendFilterWindow: 20,
      rimSeekSecondsPerTick: 0.05,
      touchSeekSecondsPerTick: 0.01,
      fastSeekSecondsPerTick: 0.05,
      fastSeekAccelTicksPerSecond: 50,
      fastSeekAccelMax: 100,
    });
  });

  it('pins the controller-in-hand GRV6 result', () => {
    expect(GRV6_JOG_CALIBRATION).toEqual({
      bendPercentPerTick: 0.1,
      bendMaxPercent: 25,
      bendFilterWindow: 4,
      rimSeekSecondsPerTick: 0.0001,
      touchSeekSecondsPerTick: 0.00027,
      fastSeekSecondsPerTick: 0.05,
      fastSeekAccelTicksPerSecond: 50,
      fastSeekAccelMax: 100,
    });
  });
});
