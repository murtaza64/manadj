/**
 * Pure beat-domain snap math for Quantize (looping 01, CONTEXT.md).
 *
 * Snapping is evaluated client-side at gesture time; the backend stores what
 * it's told. Callers own the policy (the app-wide toggle, which gestures it
 * governs — quantizeStore.ts); this module owns only the projection onto the
 * Beatgrid's precomputed beat times.
 */

/**
 * Nearest gridline to `time`, in seconds. Gridless degradation: without a
 * grid (null/empty) the exact position comes back unchanged. Distance ties
 * break toward the earlier beat; positions outside the grid clamp to its
 * first/last beat.
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
 * Quantized trigger landing (looping 02): a phase-preserving jump. Executes
 * immediately; the landing is the cue's beat (nearest gridline — placement
 * usually put it there) plus the playhead's intra-beat phase, so the jump is
 * a whole-beat displacement and the groove never stumbles. Deliberately does
 * NOT land exactly on the cue unless the playhead was on a gridline (CDJ
 * convention — do not "fix").
 *
 * Degrades to the exact cue without a grid, or with the playhead before the
 * first beat (no phase to preserve).
 */
export function phasePreservingJumpTarget(
  cue: number,
  playhead: number,
  beatTimes: readonly number[] | null | undefined
): number {
  if (!beatTimes || beatTimes.length === 0) return cue;
  const lo = lowerBound(playhead, beatTimes);
  // Last beat at or before the playhead; on-gridline playheads have phase 0.
  const beforeIdx = lo < beatTimes.length && beatTimes[lo] === playhead ? lo : lo - 1;
  if (beforeIdx < 0) return cue;
  const phase = playhead - beatTimes[beforeIdx];
  return snapToNearestBeat(cue, beatTimes) + phase;
}
