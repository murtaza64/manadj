/**
 * Beat position for the visualizer (realtime-visualization 02). Wraps the
 * grid-first fractional-beat mapping (editor/beatReadout.ts beatIndexAt —
 * the beatgrid is authoritative, BPM is a projection: ADR 0016/0027) into
 * the beat/bar phases the beat-locked presets consume. Pure.
 */

import { beatIndexAt } from '../editor/beatReadout';

export interface BeatPosition {
  /** Phase within the current beat: 0 = on the beat, 0.5 = the offbeat. */
  phase: number;
  /** Phase within the current bar: 0 = the downbeat. */
  barPhase: number;
  /** Whole beat within the bar, 0-based (0 = the downbeat, 0..beatsPerBar-1). */
  beatInBar: number;
  beatsPerBar: number;
}

/**
 * Beat/bar position at track-time `t`. Bars anchor to the first downbeat
 * and size from the first downbeat interval (beatReadout barLength logic);
 * without downbeats, 4/4 from the first beat is assumed. Null when the
 * grid is unusable (< 2 beats). Lead-in extrapolation wraps into [0, 1).
 */
export function beatPositionAt(
  beatTimes: readonly number[],
  downbeatTimes: readonly number[],
  t: number
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
  };
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
