/**
 * Decoded-audio cache (mix-editor 28): trackId → AudioBuffer, tiny LRU.
 *
 * Four entries covers both surfaces (shared decks A/B + the editor's
 * private pair), so mode-switching into the Transition editor reuses the
 * shared decks' decode instead of re-fetching and re-decoding both
 * tracks — the difference between seconds and instant. AudioBuffers are
 * not bound to the AudioContext that decoded them, so cross-surface reuse
 * is safe.
 *
 * Invalidation: replacing a Track's audio must call
 * `invalidateCachedBuffer` (hook for track-identity/02 replace-audio).
 */

const MAX_ENTRIES = 4;

/** Insertion-ordered Map as LRU: get refreshes, put evicts the oldest. */
const cache = new Map<number, AudioBuffer>();

export function getCachedBuffer(trackId: number): AudioBuffer | undefined {
  const buffer = cache.get(trackId);
  if (buffer !== undefined) {
    cache.delete(trackId);
    cache.set(trackId, buffer);
  }
  return buffer;
}

export function putCachedBuffer(trackId: number, buffer: AudioBuffer): void {
  cache.delete(trackId);
  cache.set(trackId, buffer);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Drop a track's cached decode (audio replaced / deleted). */
export function invalidateCachedBuffer(trackId: number): void {
  cache.delete(trackId);
}

/** Reset (tests only). */
export function _clearBufferCacheForTests(): void {
  cache.clear();
}
