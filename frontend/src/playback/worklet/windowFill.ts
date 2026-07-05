/**
 * Pure window-fill for the stretch adapter (key-lock 03): copy the track
 * slice [windowStart, windowStart + dest.length) into `dest`, zero-padding
 * everything outside the track — the read-ahead window regularly starts
 * before frame 0 (fresh starts) and runs past the end (track tail).
 * Extracted from the worklet adapter so the three-way fill is under vitest
 * (ADR 0002); the adapter only supplies heap-backed views.
 */
export function fillStretchWindow(
  dest: Float32Array,
  data: Float32Array | undefined,
  windowStart: number
): void {
  if (!data) {
    dest.fill(0);
    return;
  }
  const windowEnd = windowStart + dest.length;
  const from = Math.max(0, windowStart);
  const to = Math.min(data.length, windowEnd);
  if (from > windowStart) dest.fill(0, 0, from - windowStart);
  if (to > from) dest.set(data.subarray(from, to), from - windowStart);
  if (to - windowStart < dest.length) dest.fill(0, Math.max(0, to - windowStart));
}
