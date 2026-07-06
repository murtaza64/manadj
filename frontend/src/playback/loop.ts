/**
 * Active-loop vocabulary and pure math (looping 03, midi-performance-ops 01,
 * CONTEXT.md).
 *
 * The loop is Deck transport state: a beat-domain region the playhead wraps
 * in. Lengths are dyadic beat counts within 1/8–128; preset ladders (the
 * on-screen row, Controller pads) are entry points over the domain, not the
 * domain. Seconds are a projection through the Beatgrid at gesture time
 * (transport.ts owns the state, the worklet kernel owns the sample-accurate
 * wrap, this module owns the shared constants and clock math).
 */

/** The Active loop region: seconds projected at gesture time, plus the
 * beat-domain length the seconds were derived from (drives the button
 * label and resize math). */
export interface LoopRegion {
  /** Region start in seconds. */
  start: number;
  /** Region end in seconds. */
  end: number;
  /** Region length in beats (dyadic, LOOP_MIN..LOOP_MAX). */
  lengthBeats: number;
}

export const LOOP_MIN_BEATS = 0.125;
export const LOOP_MAX_BEATS = 128;
export const LOOP_DEFAULT_BEATS = 4;

/** Loop-size label: whole sizes plain, dyadic sub-multiples as reduced
 * fractions over a power-of-two denominator (1/8, 1/2, 3/4, 3/2). */
export function formatLoopBeats(beats: number): string {
  if (Number.isInteger(beats)) return String(beats);
  let den = 2;
  while (!Number.isInteger(beats * den) && den < 64) den *= 2;
  return `${beats * den}/${den}`;
}

/** Clamp a loop size to the legal range (dyadic lengths stay dyadic:
 * ×2/÷2 from an in-range dyadic can only hit the bounds). */
export function clampLoopBeats(beats: number): number {
  return Math.max(LOOP_MIN_BEATS, Math.min(LOOP_MAX_BEATS, beats));
}

/** A loop-size change: ×2/÷2 ladder steps, or an absolute target length
 * (midi-performance-ops 01 — one code path serving pads and halve/double). */
export type LoopResize = 'halve' | 'double' | { beats: number };

/** The length a resize lands on, clamped to the dyadic domain. */
export function resizeLoopBeats(current: number, change: LoopResize): number {
  if (change === 'halve') return clampLoopBeats(current / 2);
  if (change === 'double') return clampLoopBeats(current * 2);
  return clampLoopBeats(change.beats);
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
