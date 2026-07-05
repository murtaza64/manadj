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
export function snapToNearestBeat(
  time: number,
  beatTimes: readonly number[] | null | undefined
): number {
  if (!beatTimes || beatTimes.length === 0) return time;

  // Binary search for the first beat >= time (beat_times are sorted).
  let lo = 0;
  let hi = beatTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return beatTimes[0];
  if (lo === beatTimes.length) return beatTimes[beatTimes.length - 1];
  const before = beatTimes[lo - 1];
  const after = beatTimes[lo];
  return time - before <= after - time ? before : after;
}
