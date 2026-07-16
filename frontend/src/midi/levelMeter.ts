/**
 * The channel level-meter seam (four-deck-performance 36). Live channel
 * mean-absolute level in → a smoothed, Mixxx-normalized, segment-quantized MIDI value
 * out. Pure — no Web MIDI, no AudioContext, no React: the Mixer's analyser
 * tap feeds a recent mean-absolute level, this file shapes it, and the
 * level-meter bridge is the hands-on-verified glue that rate-limits and
 * sends. Mirrors the split feedback.ts uses (pure encode + tested seam,
 * verified glue), so the hardware-facing numbers are all unit-testable.
 *
 * DJ-mixer convention: the four channel meters read each fixed A–D
 * channel's own signal, INDEPENDENT of that channel's fader or the
 * crossfader — the meter tells you a channel is sounding even with its
 * fader down (which is exactly why the tap is post-EQ/filter, pre-fader:
 * the same point the PFL/headphone-cue bus taps, mixer.ts ChannelStrip).
 */

/** Mixxx EngineVuMeter's scale: log10(SHRT_MAX * meanAbs / 1000 + 1).
 * Source: mixxxdj/mixxx `src/engine/enginevumeter.cpp` (kVuUpdateRate = 30).
 * Keeping the literal derivation makes comparison with upstream obvious. */
export const MIXXX_VU_SCALE = 32767 / 1000;

/**
 * Mixxx ballistics: immediate attack and 10% decay per 30 Hz update. The
 * equivalent exponential release time constant keeps decay frame-rate
 * independent when the browser interval jitters.
 */
export const METER_ATTACK_S = 0;
export const METER_RELEASE_S = -(1 / 30) / Math.log(0.9);

/** Mixxx holds `peak_indicator` for 500 ms after clipping. */
export const METER_PEAK_HOLD_S = 0.5;

/**
 * Mean-absolute linear level → normalized meter position [0, 1], matching
 * Mixxx EngineVuMeter. Silence is exactly 0; loud material clamps at 1.
 * Unlike sample-peak dBFS, ordinary mastered tracks retain headroom on the
 * ladder while sustained loudness (not isolated transients) reaches red.
 */
export function meanAbsoluteToNormalized(meanAbsolute: number): number {
  const level = Math.log10(MIXXX_VU_SCALE * Math.max(0, meanAbsolute) + 1);
  return Math.min(1, level);
}

/**
 * One exponential-smoother step over `dt` seconds with Mixxx-style
 * asymmetric attack and release. Operates on the normalized meter level,
 * like EngineVuMeter::doSmooth.
 */
export function smoothLevel(
  previous: number,
  sample: number,
  dtSeconds: number,
  attackS: number = METER_ATTACK_S,
  releaseS: number = METER_RELEASE_S
): number {
  const target = Math.max(0, sample);
  const dt = Math.max(0, dtSeconds);
  const tau = target >= previous ? attackS : releaseS;
  if (tau <= 0 || dt <= 0) return target;
  // Standard one-pole smoother: coeff → 1 as dt ≫ tau (snap to target),
  // → 0 as dt ≪ tau (hold). Frame-rate independent.
  const coeff = 1 - Math.exp(-dt / tau);
  return previous + (target - previous) * coeff;
}

/**
 * Encode a normalized [0, 1] meter position to an ordinary (non-peak) MIDI
 * value in [0, maxValue]. The E1 table maps value ranges onto LEDs; the
 * bridge caps updates at 30 Hz and suppresses unchanged rounded values.
 */
export function encodeMeterValue(
  normalized: number,
  maxValue: number
): number {
  const n = Math.max(0, Math.min(1, normalized));
  return Math.round(n * maxValue);
}

/**
 * Per-channel meter state the bridge carries across sampler ticks: the
 * smoothed normalized level, clip hold, and last emitted output value.
 */
export interface MeterChannelState {
  /** Smoothed normalized level (Mixxx EngineVuMeter ballistics). */
  level: number;
  /** Remaining Mixxx-style clipping hold in seconds. */
  peakHoldSeconds: number;
  /** Last emitted normal value, or resolution + 1 for peak. */
  lastValue: number | null;
}

export function initialMeterState(): MeterChannelState {
  return { level: 0, peakHoldSeconds: 0, lastValue: null };
}

export interface MeterSample {
  meanAbsolute: number;
  clipped: boolean;
}

/** The outcome of one sampler tick for a channel. */
export interface MeterTick {
  /** The state to carry to the next tick. */
  state: MeterChannelState;
  /** The normalized [0, 1] meter position to send (encodeMeter scales it
   * into the device's value window), or null if the segment is unchanged
   * since the last emit (rate-limited: a steady level produces no MIDI). */
  normalized: number | null;
  /** Whether this emission should enter the device's red/peak range. */
  peak: boolean;
}

/**
 * One rate-limited sampler tick: normalize and smooth mean-absolute level,
 * hold clipping for 500 ms, and emit only when the rounded ordinary value
 * or peak state changes. Pure and deterministically testable.
 */
export function meterTick(
  prev: MeterChannelState,
  sample: MeterSample,
  dtSeconds: number,
  resolution: number
): MeterTick {
  const normalized = smoothLevel(
    prev.level,
    meanAbsoluteToNormalized(sample.meanAbsolute),
    dtSeconds
  );
  const remainingPeakHold = prev.peakHoldSeconds - Math.max(0, dtSeconds);
  const peakHoldSeconds = sample.clipped
    ? METER_PEAK_HOLD_S
    : remainingPeakHold > 1e-9
      ? remainingPeakHold
      : 0;
  const peak = peakHoldSeconds > 0;
  const value = peak ? resolution + 1 : encodeMeterValue(normalized, resolution);
  const state = { level: normalized, peakHoldSeconds, lastValue: value };
  if (prev.lastValue === value) {
    return { state, normalized: null, peak };
  }
  return { state, normalized, peak };
}
