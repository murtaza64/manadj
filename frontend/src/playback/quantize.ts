/**
 * Pure beat-domain snap math for Quantize (looping 01, CONTEXT.md).
 *
 * Snapping is evaluated client-side at gesture time; the backend stores what
 * it's told. Callers own the policy (the app-wide toggle, which gestures it
 * governs — quantizeStore.ts); this module owns only the projection onto the
 * Beatgrid's precomputed beat times.
 */

/** Index of the first beat >= time (beat_times are sorted). */
function lowerBound(time: number, beatTimes: readonly number[]): number {
  let lo = 0;
  let hi = beatTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Nearest gridline to `time`, in seconds. Gridless degradation: without a
 * grid (null/empty) the exact position comes back unchanged. Distance ties
 * break toward the earlier beat; positions outside the grid clamp to its
 * first/last beat.
 */
export function snapToNearestBeat(
  time: number,
  beatTimes: readonly number[] | null | undefined
): number {
  if (!beatTimes || beatTimes.length === 0) return time;
  const lo = lowerBound(time, beatTimes);
  if (lo === 0) return beatTimes[0];
  if (lo === beatTimes.length) return beatTimes[beatTimes.length - 1];
  const before = beatTimes[lo - 1];
  const after = beatTimes[lo];
  return time - before <= after - time ? before : after;
}

/**
 * Advance a position by a (possibly fractional, possibly negative) number
 * of beats, projected through the Beatgrid (looping 03). The position maps
 * to a beat coordinate (interval index + fraction), the count is added in
 * beat space, and the result maps back to seconds — so beat-domain
 * semantics hold on any constant or piecewise grid; positions beyond the
 * grid extrapolate linearly at the edge interval's beat length.
 *
 * Callers must ensure the grid has at least two beats (no interval to
 * measure otherwise).
 */
export function addBeats(
  position: number,
  beats: number,
  beatTimes: readonly number[]
): number {
  const n = beatTimes.length;
  const clampInterval = (i: number) => Math.max(0, Math.min(i, n - 2));
  // Seconds → beat coordinate.
  const at = clampInterval(lowerBound(position, beatTimes) - 1);
  const coord =
    at + (position - beatTimes[at]) / (beatTimes[at + 1] - beatTimes[at]) + beats;
  // Beat coordinate → seconds.
  const to = clampInterval(Math.floor(coord));
  return beatTimes[to] + (coord - to) * (beatTimes[to + 1] - beatTimes[to]);
}

/**
 * Beat span between two positions, projected through the grid — the inverse
 * of addBeats (ADR 0027 §6: a loop's displayed beat count is a projection
 * of its seconds region through the LIVE grid). Positions beyond the grid
 * extrapolate linearly at the edge interval's beat length.
 *
 * Callers must ensure the grid has at least two beats.
 */
export function beatsBetween(
  start: number,
  end: number,
  beatTimes: readonly number[]
): number {
  const n = beatTimes.length;
  const clampInterval = (i: number) => Math.max(0, Math.min(i, n - 2));
  const coord = (position: number) => {
    const at = clampInterval(lowerBound(position, beatTimes) - 1);
    return at + (position - beatTimes[at]) / (beatTimes[at + 1] - beatTimes[at]);
  };
  return coord(end) - coord(start);
}

/**
 * Quantized trigger landing (looping 02): a phase-preserving jump. Executes
 * immediately; the landing is the cue's beat (nearest gridline — placement
 * usually put it there) plus the playhead's signed phase from its nearest
 * beat. Pressing just before a beat starts before the cue, so the cue lands
 * on the approaching beat; pressing just after starts after the cue, aligned
 * with the beat that just passed. The displacement is whole-beat, so the
 * groove never stumbles. Deliberately does NOT land exactly on the cue unless
 * the playhead was on a gridline (CDJ convention — do not "fix").
 *
 * Degrades to the exact cue without a grid.
 */
export function phasePreservingJumpTarget(
  cue: number,
  playhead: number,
  beatTimes: readonly number[] | null | undefined
): number {
  if (!beatTimes || beatTimes.length === 0) return cue;
  const nearest = snapToNearestBeat(playhead, beatTimes);
  const phase = playhead - nearest;
  return snapToNearestBeat(cue, beatTimes) + phase;
}
