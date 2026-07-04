/**
 * Beat-domain readouts (mix-editor 18): pure conversions from the seconds
 * model (ADR 0010 — the model stays seconds, beats are display) to
 * musical labels. Display-only — the editor has no typed entry; the
 * timeline gestures are the manipulation surface.
 *
 * All positions are in the OWNING track's time: start/length on the
 * outgoing track's grid (mix time ≡ A track time — sketch origin), B
 * entry on the incoming track's own grid (correct with tempo match off).
 */
import type { BeatgridData } from '../types';

/** Off-grid tolerance in beats: within this of a whole beat reads clean. */
const WHOLE_BEAT_EPS = 0.05;

/** Continuous (fractional) beat index of time `t` on a grid; the edge
 * intervals extrapolate. Null when the grid can't support it. */
export function beatIndexAt(beatTimes: number[], t: number): number | null {
  const n = beatTimes.length;
  if (n < 2) return null;
  if (t < beatTimes[0]) {
    return (t - beatTimes[0]) / (beatTimes[1] - beatTimes[0]);
  }
  if (t >= beatTimes[n - 1]) {
    return n - 1 + (t - beatTimes[n - 1]) / (beatTimes[n - 1] - beatTimes[n - 2]);
  }
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beatTimes[lo]) / (beatTimes[lo + 1] - beatTimes[lo]);
}

/** Beats between two times on one grid (fractional, variable-grid-aware). */
export function beatsBetween(beatTimes: number[], t0: number, t1: number): number | null {
  const a = beatIndexAt(beatTimes, t0);
  const b = beatIndexAt(beatTimes, t1);
  return a === null || b === null ? null : b - a;
}

/** Beats per bar inferred from the first downbeat interval (fallback 4). */
export function barLength(grid: BeatgridData): number {
  const db = grid.downbeat_times;
  if (db.length >= 2) {
    const beats = beatsBetween(grid.beat_times, db[0], db[1]);
    if (beats !== null && beats > 0) return Math.round(beats);
  }
  return 4;
}

/** Format a beat count: whole beats read clean ("3"), off-grid to one
 * decimal ("3.4"). */
function fmtBeats(n: number): string {
  const whole = Math.round(n);
  return Math.abs(n - whole) < WHOLE_BEAT_EPS ? String(whole) : n.toFixed(1);
}

/**
 * Musical position label `bar.beat` (both 1-based from the first
 * downbeat; positions before it go negative — pickups read as bar ≤ 0).
 * Off-grid positions round to the nearest beat with a `~` prefix — the
 * readout is for orientation, the timeline shows the exact position.
 * Null when the grid is unusable.
 */
export function barBeatLabel(grid: BeatgridData, t: number): string | null {
  const idx = beatIndexAt(grid.beat_times, t);
  const origin =
    grid.downbeat_times.length > 0
      ? beatIndexAt(grid.beat_times, grid.downbeat_times[0])
      : 0;
  if (idx === null || origin === null) return null;
  const beatsFromOrigin = idx - origin;
  const nearest = Math.round(beatsFromOrigin);
  const offGrid = Math.abs(beatsFromOrigin - nearest) >= WHOLE_BEAT_EPS;
  const perBar = barLength(grid);
  const bar = Math.floor(nearest / perBar);
  const beatInBar = nearest - bar * perBar + 1;
  return `${offGrid ? '~' : ''}${bar + 1}.${beatInBar}`;
}

/** Window length label: "32 beats (8 bars)" for whole bar multiples,
 * "12.5 beats" off-grid. */
export function lengthBeatsLabel(
  grid: BeatgridData,
  startSec: number,
  durationSec: number
): string | null {
  const beats = beatsBetween(grid.beat_times, startSec, startSec + durationSec);
  if (beats === null) return null;
  const whole = Math.round(beats);
  const isWhole = Math.abs(beats - whole) < WHOLE_BEAT_EPS;
  const perBar = barLength(grid);
  if (isWhole && whole > 0 && whole % perBar === 0) {
    return `${whole} beats (${whole / perBar} bars)`;
  }
  return `${isWhole ? whole : beats.toFixed(1)} beats`;
}

/**
 * B-entry label on the INCOMING track's grid. Non-negative anchors read
 * as the grid position where B enters; a negative anchor is the silent
 * lead gap, read in B beats.
 */
export function bEntryLabel(grid: BeatgridData, bInSec: number): string | null {
  if (bInSec < 0) {
    const beats = beatsBetween(grid.beat_times, grid.beat_times[0] + bInSec, grid.beat_times[0]);
    return beats === null ? null : `gap ${fmtBeats(beats)} beats`;
  }
  return barBeatLabel(grid, bInSec);
}
