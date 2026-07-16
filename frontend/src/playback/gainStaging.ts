/** Master gain-staging policy (ADR 0034, master-headroom 01). */

/** Live buses and file export share a -2 dBFS sample-peak ceiling. The 2 dB
 * reserve limits intersample/DAC overshoot without changing signals below
 * the ceiling. */
export const LIVE_OUTPUT_CEILING = Math.pow(10, -2 / 20);

/** Transfer curve for the final sample ceiling. Linear below ±ceiling;
 * excess is hard-bounded. The upstream -6 dB neutral trim makes this a
 * mistake/transient guard, not a loudness processor. */
export function samplePeakCeilingCurve(
  ceiling = LIVE_OUTPUT_CEILING,
  points = 65_537
): Float32Array<ArrayBuffer> {
  if (ceiling <= 0 || ceiling > 1) throw new RangeError('ceiling must be in (0, 1]');
  if (points < 3 || points % 2 === 0) throw new RangeError('points must be odd and >= 3');
  const curve = new Float32Array(new ArrayBuffer(points * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < points; i++) {
    const input = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.max(-ceiling, Math.min(ceiling, input));
  }
  return curve;
}
