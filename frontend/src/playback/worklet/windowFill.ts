/**
 * Pure window-fill for the stretch adapter (key-lock 03): copy the track
 * slice [windowStart, windowStart + dest.length) into `dest`, zero-padding
 * everything outside the track — the read-ahead window regularly starts
 * before frame 0 (fresh starts) and runs past the end (track tail).
 * Extracted from the worklet adapter so the three-way fill is under vitest
 * (ADR 0002); the adapter only supplies heap-backed views.
 *
 * Active loop (looping 03): with a `loop` region, read indices at/past the
 * region end fold back by the region length — the stretcher hears the
 * wrapped signal as if it were the track, so its own overlap-add smooths
 * the wrap and no voice splice is needed in stretch mode.
 */
import type { LoopFrames } from './protocol';

export function fillStretchWindow(
  dest: Float32Array,
  data: Float32Array | undefined,
  windowStart: number,
  loop?: LoopFrames | null
): void {
  if (!data) {
    dest.fill(0);
    return;
  }
  const loopLength = loop ? loop.endFrames - loop.startFrames : 0;
  if (loop && loopLength > 0) {
    // Segment-wise: linear runs up to the region end, folding each time.
    let filled = 0;
    let readStart = windowStart;
    while (filled < dest.length) {
      if (readStart >= loop.endFrames) {
        readStart = loop.startFrames + ((readStart - loop.endFrames) % loopLength);
      }
      const run = Math.min(dest.length - filled, loop.endFrames - readStart);
      fillLinear(dest.subarray(filled, filled + run), data, readStart);
      filled += run;
      readStart += run;
    }
    return;
  }
  fillLinear(dest, data, windowStart);
}

/** The plain three-way fill: zero-pad before 0 and past the track end. */
function fillLinear(dest: Float32Array, data: Float32Array, windowStart: number): void {
  const windowEnd = windowStart + dest.length;
  const from = Math.max(0, windowStart);
  const to = Math.min(data.length, windowEnd);
  if (from > windowStart) dest.fill(0, 0, from - windowStart);
  if (to > from) dest.set(data.subarray(from, to), from - windowStart);
  if (to - windowStart < dest.length) dest.fill(0, Math.max(0, to - windowStart));
}
