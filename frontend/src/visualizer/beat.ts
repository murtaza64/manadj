/**
 * Beat position for the visualizer (realtime-visualization 02). Wraps the
 * grid-first fractional-beat mapping (editor/beatReadout.ts beatIndexAt —
 * the beatgrid is authoritative, BPM is a projection: ADR 0016/0027) into
 * the beat/bar phases the beat-locked presets consume. Pure.
 *
 * `barIndex` is the raw first-downbeat count (kept for lead-in tiers and
 * gridless fallback); `ladderBarIndex` is the metric-ladder-correct ordinal
 * that respects Reset marks — the number phrase/section tiers must derive
 * from (realtime-visualization 08). It comes from the ONE canonical
 * resolver (meter/ladder.ts), so the HUD, Ladder preset, and Odyssey genome
 * agree with the editor's bar readout across a reset boundary.
 */

import type { BeatgridData } from '../types';
import { beatIndexAt } from '../editor/beatReadout';
import { resolveLadder, type LadderProjection, type PersistedLadder } from '../meter/ladder';

export interface BeatPosition {
  /** Phase within the current beat: 0 = on the beat, 0.5 = the offbeat. */
  phase: number;
  /** Phase within the current bar: 0 = the downbeat. */
  barPhase: number;
  /** Whole beat within the bar, 0-based (0 = the downbeat, 0..beatsPerBar-1). */
  beatInBar: number;
  beatsPerBar: number;
  /** Absolute bar index from the first downbeat (negative in lead-ins) —
   * the raw first-downbeat count. Phrase/section tiers should read
   * `ladderBarIndex` instead (reset-mark-aware); this is the fallback. */
  barIndex: number;
  /** Ladder-correct bar ordinal within the governing metric-ladder segment
   * (restarts at each Reset mark / the anchor). Null when there is no
   * ladder to consult (no grid passed, or before the first downbeat) — the
   * caller falls back to `barIndex`. */
  ladderBarIndex: number | null;
}

/**
 * Beat/bar position at track-time `t`. Bars anchor to the first downbeat
 * and size from the first downbeat interval (beatReadout barLength logic);
 * without downbeats, 4/4 from the first beat is assumed. Null when the
 * grid is unusable (< 2 beats). Lead-in extrapolation wraps into [0, 1).
 *
 * Pass `grid` (+ optional persisted Reset marks) to fill `ladderBarIndex`
 * with the metric-ladder-correct ordinal; omit them and it stays null.
 */
export function beatPositionAt(
  beatTimes: readonly number[],
  downbeatTimes: readonly number[],
  t: number,
  grid?: BeatgridData | null,
  persisted?: PersistedLadder | null
): BeatPosition | null {
  const times = beatTimes as number[];
  const index = beatIndexAt(times, t);
  if (index === null) return null;

  let origin = 0;
  if (downbeatTimes.length > 0) {
    origin = beatIndexAt(times, downbeatTimes[0]) ?? 0;
  }
  let beatsPerBar = 4;
  if (downbeatTimes.length >= 2) {
    const a = beatIndexAt(times, downbeatTimes[0]);
    const b = beatIndexAt(times, downbeatTimes[1]);
    if (a !== null && b !== null) {
      const beats = Math.round(b - a);
      if (beats > 0) beatsPerBar = beats;
    }
  }

  const fromOrigin = index - origin;
  const phase = mod1(fromOrigin);
  const barPosition = mod(fromOrigin, beatsPerBar);
  return {
    phase,
    barPhase: barPosition / beatsPerBar,
    beatInBar: Math.min(beatsPerBar - 1, Math.floor(barPosition)),
    beatsPerBar,
    barIndex: Math.floor(fromOrigin / beatsPerBar),
    ladderBarIndex: ladderBarIndexAt(grid ?? null, persisted ?? null, t),
  };
}

/**
 * The metric-ladder-correct bar ordinal at track-time `t`: the governing
 * segment's `barIndexes[ordinal]` from the canonical resolver, keyed on the
 * downbeat the playhead currently sits in (last downbeat ≤ t — same rule as
 * the editor's playhead bar readout). Null when the ladder is undefined
 * (gridless) or the playhead is before the first downbeat. Pure.
 */
// Single-entry memo: the bridge calls this once per animation frame with
// the SAME react-query cache objects (staleTime Infinity — replaced only on
// invalidation), so resolve once per (grid, marks) identity, not per frame.
// A dominant-deck switch mid-transition is just a different key: miss, one
// resolve, then steady-state hits on the new deck.
let memoGrid: BeatgridData | null = null;
let memoPersisted: PersistedLadder | null = null;
let memoProj: LadderProjection | null = null;

export function ladderBarIndexAt(
  grid: BeatgridData | null,
  persisted: PersistedLadder | null,
  t: number
): number | null {
  if (!grid) return null;
  if (grid !== memoGrid || persisted !== memoPersisted) {
    memoGrid = grid;
    memoPersisted = persisted;
    memoProj = resolveLadder(grid, persisted);
  }
  const proj = memoProj;
  if (!proj) return null;
  const downbeats = grid.downbeat_times;
  const ordinal = currentDownbeatOrdinal(downbeats, t);
  if (ordinal === null) return null;
  return proj.barIndexes[ordinal] ?? null;
}

/** Ordinal of the downbeat the playhead sits in: the last downbeat with
 * time ≤ t. Null before the first downbeat (no bar to count yet). */
function currentDownbeatOrdinal(downbeats: readonly number[], t: number): number | null {
  if (downbeats.length === 0 || t < downbeats[0]) return null;
  let lo = 0;
  let hi = downbeats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (downbeats[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Beat-only phase (no downbeat data needed); see beatPositionAt. */
export function beatPhaseAt(beatTimes: readonly number[], t: number): number | null {
  const index = beatIndexAt(beatTimes as number[], t);
  if (index === null) return null;
  return mod1(index);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function mod1(n: number): number {
  return mod(n, 1);
}
