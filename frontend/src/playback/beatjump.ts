/**
 * Beatjump size: per-deck, halve/double between 1 and 128 beats.
 * DeckProvider owns ONE size store per deck, shared by
 * every mode (library + Performance; the editor's gesture cluster joins
 * in slice 05).
 */

export const BEATJUMP_MIN = 1;
export const BEATJUMP_MAX = 128;
export const BEATJUMP_DEFAULT = 32;

/** Separate from deck addressing so size changes cannot invalidate library rows. */
export function createBeatjumpSize() {
  let beats = BEATJUMP_DEFAULT;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => beats,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (next: number) => {
      next = clampBeatjump(next);
      if (next === beats) return;
      beats = next;
      for (const listener of listeners) listener();
    },
  };
}

export type BeatjumpSize = ReturnType<typeof createBeatjumpSize>;

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

/** Four GRV6 Beat Jump pad-pair sizes, derived from the one Deck size. */
export function jumpWindow(beats: number): readonly [number, number, number, number] {
  return [beats / 8, beats / 4, beats / 2, beats];
}
