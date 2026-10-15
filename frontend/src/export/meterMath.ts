/** Meter mappings shared by the offline feed and the scene (#377). */

/** Mixxx-style mean-absolute level → 0..1 display level (−42 dB floor,
 * −6 dB pins). */
export function meterLevel(meanAbs: number): number {
  if (meanAbs <= 1e-6) return 0;
  const db = 20 * Math.log10(meanAbs);
  return Math.max(0, Math.min(1, (db + 42) / 36));
}

/** Meter ballistics for sequential frames: instant attack, exponential
 * release. */
export function stepMeter(prev: number, target: number, dt: number, releaseS = 0.22): number {
  if (target >= prev) return target;
  return target + (prev - target) * Math.exp(-dt / releaseS);
}
