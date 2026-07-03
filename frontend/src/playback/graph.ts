/**
 * Web Audio graph for a Deck: isolator-style 3-band EQ + HP/LP sweep filter.
 *
 * Topology (ADR 0007):
 *
 *   [per-start source + envelope] ──> input ─┬─ LP·LP(250) ────────────── lowGain ──┐
 *                                            ├─ HP·HP(250)·LP·LP(2.5k) ── midGain ──┼─> sum ─> sweep ─> master ─> destination
 *                                            └─ HP·HP(2.5k) ───────────── highGain ─┘
 *
 * Crossovers are 4th-order Linkwitz-Riley (two cascaded Butterworth biquads,
 * Q = -3.01 dB each — BiquadFilterNode's Q is in dB for lowpass/highpass).
 * Full kill is a true gain of 0. All parameter moves are ramped, never set.
 */

export type EqBand = 'low' | 'mid' | 'high';

/** Crossover frequencies — tweak by ear. */
const CROSSOVER_LOW_MID_HZ = 250;
const CROSSOVER_MID_HIGH_HZ = 2500;

/** Butterworth Q expressed in dB (20·log10(1/√2)) for LR4 cascades. */
const BUTTERWORTH_Q_DB = -3.0103;

/** Time constant for filter parameter smoothing (zipper-noise avoidance). */
const PARAM_SMOOTHING_S = 0.015;

/** Linear ramp length for EQ gain moves (reaches the target exactly). */
const EQ_RAMP_S = 0.05;

/** Declick micro-fade length for source start/stop seams. */
export const DECLICK_S = 0.005;

/** Sweep filter frequency bounds. */
const SWEEP_LP_MIN_HZ = 80; // fully swept low-pass
const SWEEP_HP_MAX_HZ = 8000; // fully swept high-pass
const SWEEP_BYPASS_HZ = 20000; // "open" low-pass ≈ bypass
const SWEEP_DEADZONE = 0.05;
const SWEEP_RESONANCE_DB = 3;

function makeFilter(
  ctx: AudioContext,
  type: 'lowpass' | 'highpass',
  frequency: number
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = BUTTERWORTH_Q_DB;
  return f;
}

function chain(nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

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

export class DeckGraph {
  private readonly ctx: AudioContext;
  /** Where per-start sources feed in (via createEnvelope). */
  private readonly input: GainNode;
  private readonly bandGains: Record<EqBand, GainNode>;
  private readonly sweep: BiquadFilterNode;
  private readonly master: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    const sum = ctx.createGain();

    const low = [
      makeFilter(ctx, 'lowpass', CROSSOVER_LOW_MID_HZ),
      makeFilter(ctx, 'lowpass', CROSSOVER_LOW_MID_HZ),
      ctx.createGain(),
    ];
    const mid = [
      makeFilter(ctx, 'highpass', CROSSOVER_LOW_MID_HZ),
      makeFilter(ctx, 'highpass', CROSSOVER_LOW_MID_HZ),
      makeFilter(ctx, 'lowpass', CROSSOVER_MID_HIGH_HZ),
      makeFilter(ctx, 'lowpass', CROSSOVER_MID_HIGH_HZ),
      ctx.createGain(),
    ];
    const high = [
      makeFilter(ctx, 'highpass', CROSSOVER_MID_HIGH_HZ),
      makeFilter(ctx, 'highpass', CROSSOVER_MID_HIGH_HZ),
      ctx.createGain(),
    ];

    for (const band of [low, mid, high]) {
      this.input.connect(band[0]);
      chain(band);
      band[band.length - 1].connect(sum);
    }

    this.bandGains = {
      low: low[low.length - 1] as GainNode,
      mid: mid[mid.length - 1] as GainNode,
      high: high[high.length - 1] as GainNode,
    };

    this.sweep = ctx.createBiquadFilter();
    this.sweep.type = 'lowpass';
    this.sweep.frequency.value = SWEEP_BYPASS_HZ;
    this.sweep.Q.value = BUTTERWORTH_Q_DB;

    this.master = ctx.createGain();

    sum.connect(this.sweep);
    this.sweep.connect(this.master);
    this.master.connect(ctx.destination);
  }

  /**
   * value in [0, 1]: 0 = kill, 0.5 = flat, 1 = +6 dB.
   * Linear ramp so the target is actually reached — a kill must land on a
   * true gain of 0, not a setTargetAtTime asymptote.
   */
  setEqValue(band: EqBand, value: number): void {
    const gain = this.bandGains[band].gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(eqValueToGain(value), now + EQ_RAMP_S);
  }

  /** position in [-1, 1]: negative = LPF, positive = HPF, center = bypass. Ramped. */
  setFilterPosition(position: number): void {
    const { type, frequency, qDb } = sweepPositionToFilter(position);
    const now = this.ctx.currentTime;
    if (this.sweep.type !== type) {
      // `type` is not an AudioParam and flips instantaneously. Make the new
      // filter transparent at the flip (wide-open frequency, flat Q), then
      // ramp to the target — avoids a pop when sweeping across center.
      this.sweep.type = type;
      const transparentHz = type === 'lowpass' ? SWEEP_BYPASS_HZ : 20;
      this.sweep.frequency.cancelScheduledValues(now);
      this.sweep.frequency.setValueAtTime(transparentHz, now);
      this.sweep.Q.cancelScheduledValues(now);
      this.sweep.Q.setValueAtTime(BUTTERWORTH_Q_DB, now);
    }
    this.sweep.frequency.setTargetAtTime(frequency, now, PARAM_SMOOTHING_S);
    this.sweep.Q.setTargetAtTime(qDb, now, PARAM_SMOOTHING_S);
  }

  /**
   * Create a declick envelope for a new source: fades in over DECLICK_S.
   * Returns the gain node to connect a source into.
   */
  createEnvelope(): GainNode {
    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1, now + DECLICK_S);
    env.connect(this.input);
    return env;
  }

  /** Fade an envelope out over DECLICK_S; caller stops the source afterwards. */
  releaseEnvelope(env: GainNode): void {
    const now = this.ctx.currentTime;
    env.gain.cancelScheduledValues(now);
    env.gain.setValueAtTime(env.gain.value, now);
    env.gain.linearRampToValueAtTime(0, now + DECLICK_S);
  }
}
