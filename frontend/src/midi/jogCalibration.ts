export type JogProfile = 'grv6' | 'ddj-sb3';

/**
 * Pioneer DDJ jog behavior (GRV6, SB3): touch-edge-started scratch, device
 * vinyl-mode streams (platter CC 34 vinyl on / 35 vinyl off). Calibration
 * differs per device; behavior does not.
 */
export function isPioneerJog(profile: JogProfile | undefined): boolean {
  return profile === 'grv6' || profile === 'ddj-sb3';
}

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

/**
 * DDJ-SB3: UNMEASURED (no hardware). Same protocol family and same Mixxx
 * constants (720 intervals/rev convention) as the GRV6, so start from the
 * GRV6 values; recalibrate per docs/research/ddj-grv6-jog-calibration.md
 * once the controller is in hand.
 */
export const SB3_JOG_CALIBRATION: JogCalibration = { ...GRV6_JOG_CALIBRATION };

export function defaultJogCalibration(): JogCalibration {
  return { ...DEFAULT_JOG_CALIBRATION };
}
