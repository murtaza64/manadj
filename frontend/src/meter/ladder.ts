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

/** The persisted deviation as served by /api/metric-ladders (or any subset
 * carrying the same fields): Reset marks in track-time seconds. */
export interface PersistedLadder {
  reset_marks: readonly number[];
  arities?: readonly number[];
}

export interface LadderProjection {
  /** tiers[i] = tier of `downbeat_times[i]`: 0 = plain bar, k = boundary
   * of a tier-k group (duple default: k=1 → 2-bar … k=4 → 16-bar). A Reset
   * mark's downbeat is bar 0 of its segment, so it carries the top tier. */
  tiers: number[];
  /** Bar ordinal of `downbeat_times[i]` counted from the GOVERNING reset
   * (the ladder origin for the region before the first mark) — the per-bar
   * count consumers derive positions from (bar-in-16 =
   * `barIndexes[i] % tierBars[topTier]`). */
  barIndexes: number[];
  /** parentheticals[i] = this bar is "extra" (ADR 0029): in a segment
   * BOUNDED by a next Reset mark, the trailing bars after the last
   * complete group of the segment's highest completed tier. The final
   * open segment is never parenthetical (no next reset to be short of). */
  parentheticals: boolean[];
  /** tierBars[k] = bars per tier-k group ([1, 2, 4, 8, 16] under the duple
   * default) — consumers read spacing from HERE, never from `1 << k`. */
  tierBars: number[];
  /** Highest tier in the ladder (= arities.length). */
  topTier: number;
  /** The ladder's arity stack, bottom-up from the bar. */
  arities: readonly number[];
}

/** Nearest-downbeat ordinal for a mark (binary search; ties break low).
 * Shared with authoring: "mark reset at playhead" snaps through this. */
export function nearestDownbeatOrdinal(downbeats: readonly number[], t: number): number {
  let lo = 0;
  let hi = downbeats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (downbeats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  // lo = first ordinal with time >= t; compare against its predecessor.
  if (lo > 0 && t - downbeats[lo - 1] <= downbeats[lo] - t) return lo - 1;
  return lo;
}

/** Reset marks resolved onto the downbeat lattice (deduped, sorted) — the
 * positions display draws mark indicators at. Empty when the ladder is
 * undefined (gridless: marks lie dormant, nothing renders). */
export function resolvedMarkTimes(
  grid: BeatgridData | null,
  persisted?: PersistedLadder | null,
): number[] {
  if (!grid || grid.downbeat_times.length === 0 || !persisted?.reset_marks.length) {
    return [];
  }
  const ordinals = [
    ...new Set(
      persisted.reset_marks.map((m) => nearestDownbeatOrdinal(grid.downbeat_times, m)),
    ),
  ].sort((a, b) => a - b);
  return ordinals.map((o) => grid.downbeat_times[o]);
}

/** The stored Reset mark nearest a track time (delete-nearest's target);
 * null when there are none. Raw seconds on both sides — the ear aims at
 * the stored mark, not its downbeat resolution. */
export function nearestMark(marks: readonly number[], t: number): number | null {
  if (marks.length === 0) return null;
  return marks.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
}

/** Local bar index where a bounded segment's parenthetical starts: bars
 * after the last complete group of the highest tier (≥ 1) that completes
 * at least once in the segment; 0 (all parenthetical) when not even a
 * tier-1 group completes. */
function parentheticalCutoff(segmentBars: number, tierBars: readonly number[]): number {
  for (let k = tierBars.length - 1; k >= 1; k--) {
    if (tierBars[k] <= segmentBars) {
      return Math.floor(segmentBars / tierBars[k]) * tierBars[k];
    }
  }
  return 0;
}

/** Downbeat time → tier, keyed on the exact floats of `downbeat_times` —
 * for consumers that look downbeats up by time from the SAME array (the
 * editor lane guides). Empty map when the ladder is undefined. */
export function downbeatTierMap(
  grid: BeatgridData | null,
  persisted?: PersistedLadder | null,
): Map<number, number> {
  const proj = resolveLadder(grid, persisted);
  const map = new Map<number, number>();
  if (!proj || !grid) return map;
  for (let i = 0; i < proj.tiers.length; i++) {
    map.set(grid.downbeat_times[i], proj.tiers[i]);
  }
  return map;
}

/** Resolve a Track's Metric ladder projection — the default ladder when no
 * persisted deviation is passed, else with its Reset marks applied (each
 * mark resolves to the nearest downbeat; counting restarts there across
 * all tiers). Null when the ladder is undefined (no grid / no downbeats —
 * gridless Tracks have no ladder; persisted marks lie dormant). */
export function resolveLadder(
  grid: BeatgridData | null,
  persisted?: PersistedLadder | null,
): LadderProjection | null {
  if (!grid || grid.tempo_changes.length === 0 || grid.downbeat_times.length === 0) {
    return null;
  }
  const arities =
    persisted?.arities && persisted.arities.length > 0 ? persisted.arities : DEFAULT_ARITIES;
  const topTier = arities.length;
  const nDownbeats = grid.downbeat_times.length;

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

  // Reset marks → downbeat ordinals (nearest at read; dedup + sort).
  const markOrdinals = [
    ...new Set(
      (persisted?.reset_marks ?? []).map((m) =>
        nearestDownbeatOrdinal(grid.downbeat_times, m),
      ),
    ),
  ].sort((a, b) => a - b);
  const markedAtZero = markOrdinals[0] === 0;

  // Segment starts (ordinals): the origin segment plus each mark.
  const starts = [0, ...markOrdinals.filter((o) => o > 0)];

  const tiers = new Array<number>(nDownbeats);
  const barIndexes = new Array<number>(nDownbeats);
  const parentheticals = new Array<boolean>(nDownbeats).fill(false);
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : nDownbeats;
    // The pre-first-mark region counts from the Grid origin (phantom bars
    // included); marked segments count from their mark.
    const base = s === 0 && !markedAtZero ? barsOffset : 0;
    const bounded = s + 1 < starts.length;
    const segmentBars = base + (end - start);
    const cutoff = bounded ? parentheticalCutoff(segmentBars, tierBars) : Infinity;
    for (let i = start; i < end; i++) {
      const local = base + (i - start);
      barIndexes[i] = local;
      parentheticals[i] = local >= cutoff;
      let tier = 0;
      for (let k = 1; k <= topTier; k++) {
        if (local % tierBars[k] !== 0) break;
        tier = k;
      }
      tiers[i] = tier;
    }
  }
  return { tiers, barIndexes, parentheticals, tierBars, topTier, arities };
}
