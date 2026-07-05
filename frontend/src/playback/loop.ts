/**
 * Active-loop vocabulary and pure math (looping 03, CONTEXT.md).
 *
 * The loop is Deck transport state: a beat-domain region the playhead wraps
 * in. Lengths are powers of two, 1/8–32 beats; seconds are a projection
 * through the Beatgrid at gesture time (transport.ts owns the state, the
 * worklet kernel owns the sample-accurate wrap, this module owns the shared
 * constants and clock math).
 */

/** The Active loop region: seconds projected at gesture time, plus the
 * beat-domain length the seconds were derived from (drives the button
 * label and resize math). */
export interface LoopRegion {
  /** Region start in seconds. */
  start: number;
  /** Region end in seconds. */
  end: number;
  /** Region length in beats (power of two, LOOP_MIN..LOOP_MAX). */
  lengthBeats: number;
}

export const LOOP_MIN_BEATS = 0.125;
export const LOOP_MAX_BEATS = 32;
export const LOOP_DEFAULT_BEATS = 4;

/** Loop-size label: sub-beat sizes read as fractions (1/8, 1/4, 1/2). */
export function formatLoopBeats(beats: number): string {
  return beats < 1 ? `1/${Math.round(1 / beats)}` : String(beats);
}

/**
 * Fold a monotonically advancing clock estimate into an active loop region
 * — the engine-side mirror of the kernel's sample wrap, so the reported
 * playhead stays correct across arbitrarily many wraps (modulo, no drift).
 *
 * `anchor` is the clock's anchor position: an anchor at/past the region end
 * means the voice is beyond the loop (it never re-enters on its own), so
 * the estimate must NOT fold.
 */
export function foldLoopPlayhead(
  position: number,
  start: number,
  end: number,
  anchor: number
): number {
  const length = end - start;
  if (length <= 0) return position;
  if (anchor >= end) return position;
  if (position < end) return position;
  return start + ((position - end) % length);
}
