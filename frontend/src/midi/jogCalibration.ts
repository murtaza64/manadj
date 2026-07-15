export type JogProfile = 'grv6';

export interface JogCalibration {
  bendPercentPerTick: number;
  bendMaxPercent: number;
  bendFilterWindow: number;
  rimSeekSecondsPerTick: number;
  touchSeekSecondsPerTick: number;
  fastSeekSecondsPerTick: number;
  fastSeekAccelTicksPerSecond: number;
  fastSeekAccelMax: number;
}

export const DEFAULT_JOG_CALIBRATION: JogCalibration = {
  bendPercentPerTick: 10,
  bendMaxPercent: 8,
  bendFilterWindow: 20,
  rimSeekSecondsPerTick: 0.05,
  touchSeekSecondsPerTick: 0.01,
  fastSeekSecondsPerTick: 0.05,
  fastSeekAccelTicksPerSecond: 50,
  fastSeekAccelMax: 100,
};

/** Hardware-calibrated 2026-07-15 against a measured ~6600 counts/revolution. */
export const GRV6_JOG_CALIBRATION: JogCalibration = {
  bendPercentPerTick: 0.1,
  bendMaxPercent: 25,
  bendFilterWindow: 4,
  rimSeekSecondsPerTick: 0.0001,
  touchSeekSecondsPerTick: 0.00027,
  fastSeekSecondsPerTick: 0.05,
  fastSeekAccelTicksPerSecond: 50,
  fastSeekAccelMax: 100,
};

export function defaultJogCalibration(): JogCalibration {
  return { ...DEFAULT_JOG_CALIBRATION };
}
