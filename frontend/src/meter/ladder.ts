/**
 * METRIC LADDER resolver (glossary; ADRs 0029, 0030) — the one seam every display
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
  /** Bar ordinal within the governing forward segment, or within the
   * derived complete group before the anchor. */
  barIndexes: number[];
  /** parentheticals[i] = this bar is "extra" (ADR 0029): in a segment
   * BOUNDED by a next Reset mark, the trailing bars after the last
   * complete group of the segment's highest completed tier. Before the
   * anchor, the mirrored rule leaves only a LEADING incomplete remainder.
   * The final open segment is never parenthetical. */
  parentheticals: boolean[];
  /** Parenthetical ordinal including inferred bars before the first stored
   * downbeat. Zero for ordinary bars. */
  parentheticalCounts: number[];
  /** tierBars[k] = bars per tier-k group ([1, 2, 4, 8, 16] under the duple
   * default) — consumers read spacing from HERE, never from `1 << k`. */
  tierBars: number[];
  /** topBars[i] = the group size governing this bar's readout denominator
   * ("N of topBars[i]"). The top tier everywhere EXCEPT the pre-anchor
   * region, where each backward-peeled group governs its own denominator,
   * so a short intro reads "of 8" not "of 16" (ADR 0030). */
  topBars: number[];
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

/** Readout for the bar at a downbeat ordinal (metric-ladder 03): position
 * in the top tier counted from the governing reset — "13 of 16" — or the
 * parenthetical count, "+1, +2…". The number a DJ holds in their head. */
export function barCountLabel(
  proj: {
    barIndexes: readonly number[];
    parentheticals: readonly boolean[];
    parentheticalCounts?: readonly number[];
    tierBars: readonly number[];
    topBars?: readonly number[];
  },
  ordinal: number,
): string {
  if (proj.parentheticals[ordinal]) {
    const explicit = proj.parentheticalCounts?.[ordinal];
    if (explicit) return `+${explicit}`;
    let k = 1;
    for (let i = ordinal - 1; i >= 0 && proj.parentheticals[i]; i--) k++;
    return `+${k}`;
  }
  // The governing group size: the top tier, unless the pre-anchor region
  // peeled a smaller group backward ("of 8" for a short intro; ADR 0030).
  const top = proj.topBars?.[ordinal] ?? proj.tierBars[proj.tierBars.length - 1];
  return `${(proj.barIndexes[ordinal] % top) + 1} of ${top}`;
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

/** The largest tier (≥ 1) whose group fits within `bars`; 0 when not even
 * a tier-1 group fits (an all-parenthetical remainder). The group size that
 * peels off the anchor and governs the pre-anchor readout ("of 8"). */
function largestTierThatFits(bars: number, tierBars: readonly number[]): number {
  for (let k = tierBars.length - 1; k >= 1; k--) {
    if (tierBars[k] <= bars) return k;
  }
  return 0;
}

/** Downbeat time → { tier, parenthetical }, keyed on the exact floats of
 * `downbeat_times` — for consumers that look downbeats up by time from the
 * SAME array (the editor lane guides). Empty map when the ladder is
 * undefined. */
export function downbeatLadderMap(
  grid: BeatgridData | null,
  persisted?: PersistedLadder | null,
): Map<number, { tier: number; parenthetical: boolean }> {
  const proj = resolveLadder(grid, persisted);
  const map = new Map<number, { tier: number; parenthetical: boolean }>();
  if (!proj || !grid) return map;
  for (let i = 0; i < proj.tiers.length; i++) {
    map.set(grid.downbeat_times[i], {
      tier: proj.tiers[i],
      parenthetical: proj.parentheticals[i],
    });
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
  const topBarsFull = tierBars[topTier];

  const tiers = new Array<number>(nDownbeats);
  const barIndexes = new Array<number>(nDownbeats);
  const parentheticals = new Array<boolean>(nDownbeats).fill(false);
  const parentheticalCounts = new Array<number>(nDownbeats).fill(0);
  const topBars = new Array<number>(nDownbeats).fill(topBarsFull);

  // The LADDER ANCHOR is the earliest mark (ADR 0030); the region before it
  // is a bounded segment counted BACKWARD, right-aligned to the anchor, with
  // the parenthetical rules mirrored (complete groups peel from the anchor
  // toward the track start; a LEADING incomplete remainder is the pickup).
  // With no anchor (no marks, or a mark at the very origin) the pre-region
  // counts FORWARD from the Grid origin as ever — gridOriginSec's backward
  // extension corrects a LATE first mark, but an EARLY grid (a missing first
  // downbeat) is uncorrectable without the anchor: that is what a mark cures.
  const hasAnchor = markOrdinals.length > 0;
  const anchorOrdinal = hasAnchor ? markOrdinals[0] : 0;

  if (hasAnchor) {
    // Right-align to the anchor: phantom bars (Grid-origin offset) sit at the
    // very start, so the region spans `barsOffset + anchorOrdinal` bars.
    const preBars = barsOffset + anchorOrdinal;
    // Peel greedily and recursively from the anchor. Under the duple default,
    // 24 becomes 8 + 16, 20 becomes 4 + 16, and 9 leaves +1 then 8.
    const groups: Array<{ start: number; end: number; tier: number; bars: number }> = [];
    let lead = preBars;
    while (true) {
      const tier = largestTierThatFits(lead, tierBars);
      if (tier === 0) break;
      const bars = tierBars[tier];
      groups.push({ start: lead - bars, end: lead, tier, bars });
      lead -= bars;
    }

    for (let i = 0; i < anchorOrdinal; i++) {
      const pos = barsOffset + i; // position from the region start
      if (pos < lead) {
        parentheticals[i] = true;
        parentheticalCounts[i] = pos + 1; // includes inferred phantom bars
        barIndexes[i] = pos;
        tiers[i] = 0;
      }
    }
    for (const group of groups) {
      const firstVisible = Math.max(group.start, barsOffset);
      const endVisible = Math.min(group.end, preBars);
      for (let pos = firstVisible; pos < endVisible; pos++) {
        const i = pos - barsOffset;
        if (i < 0 || i >= anchorOrdinal) continue;
        const local = pos - group.start;
        barIndexes[i] = local;
        topBars[i] = group.bars;
        let tier = 0;
        for (let k = 1; k <= group.tier; k++) {
          if (local % tierBars[k] !== 0) break;
          tier = k;
        }
        tiers[i] = tier;
      }
    }
  }

  // Forward segments: the origin segment (only when there is no anchor) plus
  // each mark. When anchored, the first forward segment starts AT the anchor.
  const forwardStart = anchorOrdinal;
  const starts = [forwardStart, ...markOrdinals.filter((o) => o > forwardStart)];

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : nDownbeats;
    // A pre-first-mark forward region (no anchor) counts from the Grid origin
    // (phantom bars included); anchored/marked segments count from bar 0.
    const base = s === 0 && !hasAnchor ? barsOffset : 0;
    const bounded = s + 1 < starts.length;
    const segmentBars = base + (end - start);
    const cutoff = bounded ? parentheticalCutoff(segmentBars, tierBars) : Infinity;
    for (let i = start; i < end; i++) {
      const local = base + (i - start);
      barIndexes[i] = local;
      parentheticals[i] = local >= cutoff;
      if (parentheticals[i]) parentheticalCounts[i] = local - cutoff + 1;
      let tier = 0;
      for (let k = 1; k <= topTier; k++) {
        if (local % tierBars[k] !== 0) break;
        tier = k;
      }
      tiers[i] = tier;
    }
  }
  return {
    tiers,
    barIndexes,
    parentheticals,
    parentheticalCounts,
    tierBars,
    topBars,
    topTier,
    arities,
  };
}
