// Favorite feeds (gh#342): which feeds pour into the "all sources" view.
// Persisted as a JSON array of feed ids (`items:soundcloud`,
// `spotify:liked`, `spotify:playlist:<id>`). SoundCloud likes by default.
import { useSyncExternalStore } from 'react';
import { writeSetting } from '../../settings/persistedSettings';

export const FAVORITE_FEEDS_KEY = 'manadj-acquisition-feeds';
export const DEFAULT_FAVORITE_FEEDS: readonly string[] = ['items:soundcloud'];

const listeners = new Set<() => void>();
// memoized on the raw stored string: settings hydrate from the server after
// first render (persistedSettings), so the cache must follow localStorage
let cacheRaw: string | null | undefined;
let cache: string[] = [...DEFAULT_FAVORITE_FEEDS];

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(FAVORITE_FEEDS_KEY);
  } catch {
    /* no storage */
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  try {
    const parsed: unknown = raw == null ? null : JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [...DEFAULT_FAVORITE_FEEDS];
  } catch {
    cache = [...DEFAULT_FAVORITE_FEEDS];
  }
  return cache;
}

export function favoriteFeeds(): readonly string[] {
  return read();
}

export function isFavoriteFeed(id: string): boolean {
  return read().includes(id);
}

export function toggleFavoriteFeed(id: string): void {
  const next = read().includes(id) ? read().filter(x => x !== id) : [...read(), id];
  writeSetting(FAVORITE_FEEDS_KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

export function useFavoriteFeeds(): readonly string[] {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
  );
}
