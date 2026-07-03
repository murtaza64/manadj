/**
 * Pure DSP control mappings for the isolator EQ and HP/LP sweep filter.
 * The nodes themselves live in the Mixer's channel strips (ADR 0009); a
 * deck's declick constant also lives here (deck-side concern).
 */

export type EqBand = 'low' | 'mid' | 'high';

/** Butterworth Q expressed in dB (20·log10(1/√2)) for LR4 cascades. */
export const BUTTERWORTH_Q_DB = -3.0103;

/** Declick micro-fade length for source start/stop seams. */
export const DECLICK_S = 0.005;

/** Sweep filter frequency bounds. */
const SWEEP_LP_MIN_HZ = 80; // fully swept low-pass
const SWEEP_HP_MAX_HZ = 8000; // fully swept high-pass
export const SWEEP_BYPASS_HZ = 20000; // "open" low-pass ≈ bypass
const SWEEP_DEADZONE = 0.05;
const SWEEP_RESONANCE_DB = 3;

/**
 * Map an EQ control value in [0, 1] to linear gain.
 * 1 → +6 dB, 0.5 → 0 dB, 0 → full kill (gain 0).
 * Top half is linear in dB; bottom half linear in amplitude down to zero.
 */
export function eqValueToGain(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  if (v >= 0.5) return Math.pow(10, ((v - 0.5) * 12) / 20);
  return v / 0.5;
}

/**
 * Map sweep position in [-1, 1] to filter settings.
 * Center (± deadzone) = bypass (wide-open low-pass). Negative = LPF sweeping
 * down; positive = HPF sweeping up. Exponential frequency interpolation.
 */
export function sweepPositionToFilter(position: number): {
  type: 'lowpass' | 'highpass';
  frequency: number;
  qDb: number;
} {
  const p = Math.min(1, Math.max(-1, position));
  if (Math.abs(p) < SWEEP_DEADZONE) {
    return { type: 'lowpass', frequency: SWEEP_BYPASS_HZ, qDb: BUTTERWORTH_Q_DB };
  }
  if (p < 0) {
    const frequency = SWEEP_BYPASS_HZ * Math.pow(SWEEP_LP_MIN_HZ / SWEEP_BYPASS_HZ, -p);
    return { type: 'lowpass', frequency, qDb: SWEEP_RESONANCE_DB };
  }
  const frequency = 20 * Math.pow(SWEEP_HP_MAX_HZ / 20, p);
  return { type: 'highpass', frequency, qDb: SWEEP_RESONANCE_DB };
}
