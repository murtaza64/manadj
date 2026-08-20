/**
 * Musical regime decomposition (realtime-visualization 09): buildup / drop
 * detection as a SHARED seam, replacing every preset's private
 * trend.excitement heuristics (the kit's long-queued "canonical regime
 * decomposition").
 *
 * Continuous, non-exclusive channels in [0, 1]:
 * - buildup:        riser evidence — energy climbing over ~seconds while
 *                   the peak hasn't landed yet.
 * - dropTransition: the LANDING — pulses at the moment a primed buildup
 *                   resolves into heavy bass, decays over a few seconds
 *                   (transition signal, not a state).
 * - sustained:      plateau — energy holding above the slow baseline
 *                   (what "ride max(drop, energy)" always wanted).
 * - breakdown:      energy well below a baseline that used to be high.
 *
 * Pure dt-driven stepper; the bridge owns persistence and ships the
 * signal additively in frames. Presets read `frame.regime` and fall back
 * to their local derivations when absent.
 */

import type { BandLevels } from './bands';

export interface RegimeSignal {
  buildup: number;
  dropTransition: number;
  sustained: number;
  breakdown: number;
  /** Seconds since the last detected drop landing; Infinity before any. */
  dropAgeS: number;
}

export interface RegimeState {
  fast: number; // ~0.25s EMA of weighted energy
  med: number; // ~2s EMA (slope reference)
  slow: number; // ~10s EMA (baseline)
  peak: number; // decaying recent peak of fast
  riser: number; // buildup accumulator
  drop: number; // dropTransition envelope
  sustained: number;
  breakdown: number;
  primed: number; // how "armed" a drop is (riser history, decays slowly)
  sinceDropS: number;
}

export const INITIAL_REGIME: RegimeState = {
  fast: 0,
  med: 0,
  slow: 0,
  peak: 0,
  riser: 0,
  drop: 0,
  sustained: 0,
  breakdown: 0,
  primed: 0,
  sinceDropS: Infinity,
};

const alpha = (dt: number, tau: number) => 1 - Math.exp(-Math.max(0, dt) / tau);

/** Bass-weighted energy: the genre's pulse lives in the low band. */
export function regimeEnergy(bands: BandLevels): number {
  return Math.min(1, bands.low * 0.55 + bands.mid * 0.3 + bands.high * 0.15);
}

export function stepRegime(state: RegimeState, bands: BandLevels, dt: number): RegimeState {
  const e = regimeEnergy(bands);
  const fast = state.fast + (e - state.fast) * alpha(dt, 0.25);
  const med = state.med + (fast - state.med) * alpha(dt, 2.0);
  const slow = state.slow + (fast - state.slow) * alpha(dt, 10.0);
  const peak = Math.max(fast, state.peak * Math.exp(-dt / 12));

  // BUILDUP: sustained positive slope (fast above its 2s reference) while
  // the low band hasn't taken over yet (risers thin the bass, push mids/
  // highs). Accumulates over seconds, drains when the slope flattens.
  const slope = Math.max(0, fast - med); // >0 while climbing
  const bassDeficit = Math.min(1, Math.max(0, (bands.mid + bands.high) * 0.75 - bands.low * 0.6 + 0.25));
  const riserDrive = Math.min(1, slope * 10) * bassDeficit;
  let riser = state.riser + (riserDrive - state.riser) * alpha(dt, riserDrive > state.riser ? 1.2 : 0.8);
  riser = Math.min(1, Math.max(0, riser));

  // Priming: remember recent buildup so a landing can be attributed to it.
  const primed = Math.max(riser, state.primed * Math.exp(-dt / 4));

  // DROP LANDING: primed + bass slams in above the slow baseline.
  const bassSlam = bands.low > 0.45 && fast > slow * 1.15 + 0.05;
  let drop = state.drop * Math.exp(-dt / 3);
  let sinceDropS = state.sinceDropS + dt;
  if (bassSlam && primed > 0.35 && state.sinceDropS > 4) {
    drop = Math.max(drop, Math.min(1, primed + 0.3));
    sinceDropS = 0;
    riser = 0; // the buildup resolved
  }

  // SUSTAINED: plateau above baseline (independent of the landing pulse).
  const sustTarget = Math.min(1, Math.max(0, (fast - slow * 1.05) / 0.25)) * Math.min(1, fast / 0.35);
  const sustained = state.sustained + (sustTarget - state.sustained) * alpha(dt, 0.6);

  // BREAKDOWN: quiet relative to a baseline that used to be loud.
  const bdTarget = Math.min(1, Math.max(0, (slow * 0.7 - fast) / 0.2)) * Math.min(1, peak / 0.3);
  const breakdown = state.breakdown + (bdTarget - state.breakdown) * alpha(dt, 1.0);

  return { fast, med, slow, peak, riser, drop, sustained, breakdown, primed, sinceDropS };
}

export function regimeSignal(state: RegimeState): RegimeSignal {
  return {
    buildup: state.riser,
    dropTransition: state.drop,
    sustained: state.sustained,
    breakdown: state.breakdown,
    dropAgeS: state.sinceDropS,
  };
}
