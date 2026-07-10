/**
 * METRIC LADDER resolver (glossary; ADR 0029) — the one seam every display
 * consumer reads hypermeter through. Takes a Beatgrid and yields the
 * projection: per-downbeat tier levels for the implicit default ladder
 * (duple `[2,2,2,2]` — 2/4/8/16-bar tiers — anchored at the Grid origin,
 * no Reset marks; nothing persisted). Persisted ladders and Reset marks
 * arrive in metric-ladder 02 and extend THIS function; consumers never
 * read arities or marks raw.
 *
 * Bars are counted ordinally over `downbeat_times` (tempo-agnostic); only
 * the offset between the Grid origin and the first stored downbeat is
 * measured in seconds, on the first segment's own constant-tempo lattice.
 */
import type { BeatgridData } from '../types';
import { gridOriginSec } from './gridOrigin';

/** v1 ships arities fixed duple (ADR 0029; editing deferred). */
export const DEFAULT_ARITIES: readonly number[] = [2, 2, 2, 2];

/** Bars per tier-k group: product of the arities below k (k=0 → the bar). */
export function groupBars(arities: readonly number[], k: number): number {
  let bars = 1;
  for (let i = 0; i < k; i++) bars *= arities[i];
  return bars;
}

export interface LadderProjection {
  /** tiers[i] = tier of `downbeat_times[i]`: 0 = plain bar, k = boundary
   * of a tier-k group (duple default: k=1 → 2-bar … k=4 → 16-bar). */
  tiers: number[];
  /** Bar ordinal of `downbeat_times[i]` counted from the ladder origin —
   * the per-bar count consumers derive positions from (bar-in-16 =
   * `barIndexes[i] % tierBars[topTier]`). */
  barIndexes: number[];
  /** tierBars[k] = bars per tier-k group ([1, 2, 4, 8, 16] under the duple
   * default) — consumers read spacing from HERE, never from `1 << k`. */
  tierBars: number[];
  /** Highest tier in the ladder (= arities.length). */
  topTier: number;
  /** The ladder's arity stack, bottom-up from the bar. */
  arities: readonly number[];
}

/** Downbeat time → tier, keyed on the exact floats of `downbeat_times` —
 * for consumers that look downbeats up by time from the SAME array (the
 * editor lane guides). Empty map when the ladder is undefined. */
export function downbeatTierMap(grid: BeatgridData | null): Map<number, number> {
  const proj = resolveLadder(grid);
  const map = new Map<number, number>();
  if (!proj || !grid) return map;
  for (let i = 0; i < proj.tiers.length; i++) {
    map.set(grid.downbeat_times[i], proj.tiers[i]);
  }
  return map;
}

/** Resolve a Track's Metric ladder projection; null when the ladder is
 * undefined (no grid / no downbeats — gridless Tracks have no ladder). */
export function resolveLadder(grid: BeatgridData | null): LadderProjection | null {
  if (!grid || grid.tempo_changes.length === 0 || grid.downbeat_times.length === 0) {
    return null;
  }
  const arities = DEFAULT_ARITIES;
  const topTier = arities.length;

  // Whole bars between the Grid origin and the first stored downbeat, on
  // the first segment's lattice (both are downbeats of that lattice, so
  // the quotient is integral up to float noise — round, don't floor).
  const tc = grid.tempo_changes[0];
  const barSec = (60 / tc.bpm) * tc.time_signature_num;
  const barsOffset = Math.max(
    0,
    Math.round((grid.downbeat_times[0] - gridOriginSec(grid)) / barSec),
  );

  const tierBars = new Array<number>(topTier + 1);
  for (let k = 0; k <= topTier; k++) tierBars[k] = groupBars(arities, k);

  const tiers = new Array<number>(grid.downbeat_times.length);
  const barIndexes = new Array<number>(grid.downbeat_times.length);
  for (let i = 0; i < tiers.length; i++) {
    const barIndex = barsOffset + i;
    barIndexes[i] = barIndex;
    let tier = 0;
    for (let k = 1; k <= topTier; k++) {
      if (barIndex % tierBars[k] !== 0) break;
      tier = k;
    }
    tiers[i] = tier;
  }
  return { tiers, barIndexes, tierBars, topTier, arities };
}
