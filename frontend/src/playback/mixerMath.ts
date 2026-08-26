/**
 * Pure mixer math (ADR 0009 / performance-mode issue 01). The audible
 * semantics of the mixer's controls live here, unit-tested; the Mixer module
 * applies them to gain nodes.
 */

const TRIM_RANGE_DB = 12;
/** Center leaves 6 dB per-channel headroom for two unity channels to sum.
 * The physical throw remains 24 dB wide: -18 dB .. +6 dB. */
export const TRIM_CENTER_DB = -6;
/** The trim knob's neutral position (= TRIM_CENTER_DB). */
export const TRIM_NEUTRAL = 0.5;
/** dB per full knob unit — a trim OFFSET in knob units (sets #164:
 * per-entry trim stores offsets from neutral) reads as offset·this dB. */
export const TRIM_DB_PER_UNIT = 2 * TRIM_RANGE_DB;
/** Master reserves its upper half for make-up gain. */
export const MASTER_UNITY_VALUE = 0.5;
export const MASTER_MAX_DB = 6;

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

/** Trim position [0,1] → linear gain. Center = -6 dB; range -18 .. +6 dB. */
export function trimToGain(value: number): number {
  const v = clamp01(value);
  return Math.pow(10, (TRIM_CENTER_DB + (v - 0.5) * 2 * TRIM_RANGE_DB) / 20);
}

/** Master position [0,1] → gain. Below unity it uses an audio taper; the
 * upper half rises linearly in dB to +6 dB. */
export function masterValueToGain(value: number): number {
  const v = clamp01(value);
  if (v <= MASTER_UNITY_VALUE) {
    const normalized = v / MASTER_UNITY_VALUE;
    return normalized * normalized;
  }
  const boostDb = ((v - MASTER_UNITY_VALUE) / (1 - MASTER_UNITY_VALUE)) * MASTER_MAX_DB;
  return Math.pow(10, boostDb / 20);
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
 * change). Neutral trim supplies the expected two-channel summing headroom;
 * the final sample ceiling guards correlated/extreme overloads.
 */
export function crossfaderGains(position: number): { a: number; b: number } {
  const x = Math.max(-1, Math.min(1, position));
  return {
    a: clamp01(1 - x),
    b: clamp01(1 + x),
  };
}

/** Per-channel crossfader assignment. Thru bypasses the crossfader. */
export function channelCrossfaderGain(
  assignment: 'left' | 'thru' | 'right',
  position: number
): number {
  const { a, b } = crossfaderGains(position);
  if (assignment === 'thru') return 1;
  return assignment === 'left' ? a : b;
}
