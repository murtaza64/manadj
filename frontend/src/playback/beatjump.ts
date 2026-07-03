/**
 * Beatjump size for the Performance view: per-deck, halve/double between
 * 1 and 128 beats (pure — state lives in the deck scope). The library view
 * keeps its fixed constant (constants.ts).
 */

export const BEATJUMP_MIN = 1;
export const BEATJUMP_MAX = 128;
export const PERFORMANCE_BEATJUMP_DEFAULT = 32;

export function clampBeatjump(beats: number): number {
  return Math.max(BEATJUMP_MIN, Math.min(BEATJUMP_MAX, beats));
}

export function halveBeatjump(beats: number): number {
  return clampBeatjump(beats / 2);
}

export function doubleBeatjump(beats: number): number {
  return clampBeatjump(beats * 2);
}
