/**
 * Pure window-fill for the stretch adapter (key-lock 03): copy the source's
 * slice [windowStart, windowStart + dest.length) into `dest`, zero-padding
 * everything outside the track — the read-ahead window regularly starts
 * before frame 0 (fresh starts) and runs past the end (track tail).
 * Extracted from the worklet adapter so the three-way fill is under vitest
 * (ADR 0002); the adapter only supplies heap-backed views.
 *
 * Reads go through the TrackSource seam (stems #209): a stem bank mixes its
 * sources with per-stem gains inside `fillWindow`, so the stretcher hears
 * the already-mixed composite and the one-stretcher-per-deck invariant
 * holds regardless of stems.
 *
 * Active loop (looping 03): with a `loop` region, read indices at/past the
 * region end fold back by the region length — the stretcher hears the
 * wrapped signal as if it were the track, so its own overlap-add smooths
 * the wrap and no voice splice is needed in stretch mode.
 */
import type { LoopFrames } from './protocol';
import type { TrackSource } from './trackSource';

export function fillStretchWindow(
  dest: Float32Array,
  source: TrackSource,
  channel: number,
  windowStart: number,
  loop?: LoopFrames | null
): void {
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
      source.fillWindow(dest.subarray(filled, filled + run), channel, readStart);
      filled += run;
      readStart += run;
    }
    return;
  }
  source.fillWindow(dest, channel, windowStart);
}
