/**
 * Beatjump size: per-deck, halve/double between 1 and 128 beats (pure —
 * the per-deck state lives in DeckContext). ONE size per deck, shared by
 * every mode (library + Performance; the editor's gesture cluster joins
 * in slice 05).
 */

export const BEATJUMP_MIN = 1;
export const BEATJUMP_MAX = 128;
export const BEATJUMP_DEFAULT = 32;

/**
 * @deprecated Alias for the Transition editor's gesture cluster, which is
 * rewired onto the shared per-deck size in slice 05 (deck-controls PRD).
 */
export const PERFORMANCE_BEATJUMP_DEFAULT = BEATJUMP_DEFAULT;

export function clampBeatjump(beats: number): number {
  return Math.max(BEATJUMP_MIN, Math.min(BEATJUMP_MAX, beats));
}

export function halveBeatjump(beats: number): number {
  return clampBeatjump(beats / 2);
}

export function doubleBeatjump(beats: number): number {
  return clampBeatjump(beats * 2);
}
