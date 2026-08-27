/**
 * Decoded-audio cache (mix-editor 28; byte-budget + stems: stems #211):
 * trackId → { single?, stems? }, LRU by BYTES, not entry count.
 *
 * A most-recent LRU across all surfaces (the shared Decks A–D and the
 * editor's private pair), so mode-switching into the Transition editor —
 * or a Set handover onto a prefetched track — reuses a recent decode
 * instead of re-fetching and re-decoding. AudioBuffers are not bound to
 * the AudioContext that decoded them, so cross-surface reuse is safe.
 *
 * Why bytes: a stems entry is ~4× a single decode (~320 MB vs ~80 MB for
 * a long track); an entry-count budget would silently quadruple memory
 * the moment stems tracks dominate. The budget matches the old ceiling
 * (4 entries × ~80 MB) × the stems factor — roughly four stems tracks or
 * sixteen singles; tune by ear/Activity Monitor, it is one constant.
 *
 * One entry per track holds BOTH shapes: the deck plays stems while the
 * editor decodes the single file — same key, no eviction fight between
 * kinds. Eviction and invalidation drop the whole entry.
 *
 * Invalidation: replacing a Track's audio must call
 * `invalidateCachedBuffer` (hook for track-identity/02 replace-audio) —
 * it drops stems too (stale stems are absent, #149).
 */

interface CacheEntry {
  single?: AudioBuffer;
  stems?: AudioBuffer[];
}

/** ~1.25 GiB: old 4-entry ceiling × the 4-stem factor (see header). */
const BYTE_BUDGET = 1.25 * 2 ** 30;

/** Insertion-ordered Map as LRU: get refreshes, put evicts oldest-first. */
const cache = new Map<number, CacheEntry>();

function bytesOfBuffer(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

function bytesOfEntry(entry: CacheEntry): number {
  let bytes = entry.single ? bytesOfBuffer(entry.single) : 0;
  for (const stem of entry.stems ?? []) bytes += bytesOfBuffer(stem);
  return bytes;
}

function totalBytes(): number {
  let bytes = 0;
  for (const entry of cache.values()) bytes += bytesOfEntry(entry);
  return bytes;
}

function touch(trackId: number): CacheEntry | undefined {
  const entry = cache.get(trackId);
  if (entry !== undefined) {
    cache.delete(trackId);
    cache.set(trackId, entry);
  }
  return entry;
}

function evictToBudget(): void {
  // Keep at least the newest entry even when it alone exceeds the budget —
  // an empty cache would just re-decode it immediately.
  while (cache.size > 1 && totalBytes() > BYTE_BUDGET) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function getCachedBuffer(trackId: number): AudioBuffer | undefined {
  return touch(trackId)?.single;
}

export function putCachedBuffer(trackId: number, buffer: AudioBuffer): void {
  const entry = touch(trackId) ?? {};
  entry.single = buffer;
  cache.delete(trackId);
  cache.set(trackId, entry);
  evictToBudget();
}

/** The track's decoded stems (STEM_NAMES order), if cached (stems #211). */
export function getCachedStems(trackId: number): AudioBuffer[] | undefined {
  return touch(trackId)?.stems;
}

export function putCachedStems(trackId: number, stems: AudioBuffer[]): void {
  const entry = touch(trackId) ?? {};
  entry.stems = stems;
  cache.delete(trackId);
  cache.set(trackId, entry);
  evictToBudget();
}

/** Drop a track's cached decodes (audio replaced / deleted) — both shapes. */
export function invalidateCachedBuffer(trackId: number): void {
  cache.delete(trackId);
}

/** Total resident bytes (tests / diagnostics). */
export function _cachedBytesForTests(): number {
  return totalBytes();
}

/** Reset (tests only). */
export function _clearBufferCacheForTests(): void {
  cache.clear();
}
