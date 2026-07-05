/**
 * Pure mixer math (ADR 0009 / performance-mode issue 01). The audible
 * semantics of the mixer's controls live here, unit-tested; the Mixer module
 * applies them to gain nodes.
 */

const TRIM_RANGE_DB = 12;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Channel fader position [0,1] → linear gain. Audio taper (quadratic): the
 * lower half of the throw stays quiet, like a hardware channel fader.
 */
export function channelFaderToGain(value: number): number {
  const v = clamp01(value);
  return v * v;
}

/** Trim position [0,1] → linear gain. Center = unity; ±12 dB at the ends. */
export function trimToGain(value: number): number {
  const v = clamp01(value);
  return Math.pow(10, ((v - 0.5) * 2 * TRIM_RANGE_DB) / 20);
}

/**
 * Cue level (headphone volume) [0,1] → linear gain. Same audio taper as the
 * channel fader — it is a volume control, not a trim (headphone-cue 02).
 */
export function cueLevelToGain(value: number): number {
  const v = clamp01(value);
  return v * v;
}

/**
 * Cue/mix blend position [0 (cue only), 1 (master only)] → gains for the
 * two signals feeding the headphones (headphone-cue 03). Equal-power curve
 * (constant summed energy) — the standard monitor-blend law: sweeping the
 * knob changes the balance, not the loudness, and both signals are clearly
 * present at the middle. Both gains are applied IN THE MAIN GRAPH before
 * the bridge (ADR 0017), which is what keeps cue and master sample-aligned
 * inside the headphones.
 */
export function cueMixGains(position: number): { cue: number; master: number } {
  const x = clamp01(position);
  return {
    cue: Math.cos((x * Math.PI) / 2),
    master: Math.sin((x * Math.PI) / 2),
  };
}

/**
 * Crossfader position [-1 (full A), 1 (full B)] → per-channel gains.
 * Dipless curve: a channel is at unity anywhere in its own half INCLUDING
 * center, and fades linearly to a full kill at the opposite end. Center is
 * transparent (no -3 dB dip — the library's single-deck loudness must not
 * change), and the summed center case is the limiter's job.
 */
export function crossfaderGains(position: number): { a: number; b: number } {
  const x = Math.max(-1, Math.min(1, position));
  return {
    a: clamp01(1 - x),
    b: clamp01(1 + x),
  };
}
