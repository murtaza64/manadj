/** Past-EOF beat lattice for transport math (gh#424).
 *
 * Stored beat arrays stop at the last audible sample. The silence loop and
 * any quantize/jump/loop-engage gesture near EOF need the lattice to
 * continue past EOF on the FINAL interval - the same edge extrapolation
 * addBeats already applies beyond the grid (quantize.ts), made explicit so
 * region math (snap + addBeats) sees real entries instead of clamping at
 * the array end.
 *
 * Engine-internal only: the stored array is never mutated (the waveform
 * renderer matches downbeats by exact float equality); this returns a new
 * array, and only when the grid actually falls short of the horizon. */
export function extendBeatTimesPastEof(
  beatTimes: readonly number[],
  horizonSec: number
): number[] {
  const n = beatTimes.length;
  if (n < 2) return beatTimes.slice();
  const last = beatTimes[n - 1];
  if (last >= horizonSec) return beatTimes.slice();
  const interval = last - beatTimes[n - 2];
  if (!(interval > 0)) return beatTimes.slice();
  const out = beatTimes.slice();
  let t = last;
  // Pathological-grid guard mirrors gridProjection's.
  while (t <= horizonSec && out.length - n < 100000) {
    t += interval;
    out.push(t);
  }
  return out;
}
