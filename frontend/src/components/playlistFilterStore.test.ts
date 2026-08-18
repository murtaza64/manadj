/**
 * Per-playlist filter enablement store (playlist-editing 09) — persistence
 * face, tested against a fake at the true seam (localStorage), like the
 * follow-flags store tests: boot restore/validation, toggle persistence,
 * and per-playlist independence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-playlist-filter-enabled';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

/** Fresh module instance per test (the store is a module-level singleton). */
async function loadStore(stored?: string) {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage(stored ? { [STORAGE_KEY]: stored } : {}));
  return await import('./playlistFilterStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playlistFilterStore', () => {
  it('defaults every playlist to off', async () => {
    const store = await loadStore();
    expect(store.isPlaylistFilterEnabled(1)).toBe(false);
    expect(store.isPlaylistFilterEnabled(42)).toBe(false);
  });

  it('toggle flips one playlist without touching others, and persists', async () => {
    const store = await loadStore();
    store.togglePlaylistFilter(3);
    expect(store.isPlaylistFilterEnabled(3)).toBe(true);
    expect(store.isPlaylistFilterEnabled(4)).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([3]);

    store.togglePlaylistFilter(3);
    expect(store.isPlaylistFilterEnabled(3)).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it('restores persisted enablement on boot', async () => {
    const store = await loadStore(JSON.stringify([7, 9]));
    expect(store.isPlaylistFilterEnabled(7)).toBe(true);
    expect(store.isPlaylistFilterEnabled(9)).toBe(true);
    expect(store.isPlaylistFilterEnabled(8)).toBe(false);
  });

  it('ignores malformed or non-numeric stored state', async () => {
    const garbled = await loadStore('{not json');
    expect(garbled.isPlaylistFilterEnabled(1)).toBe(false);

    const wrongShape = await loadStore(JSON.stringify({ 1: true }));
    expect(wrongShape.isPlaylistFilterEnabled(1)).toBe(false);

    const mixed = await loadStore(JSON.stringify([2, 'x', null]));
    expect(mixed.isPlaylistFilterEnabled(2)).toBe(true);
  });

  it('notifies subscribers on toggle', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribePlaylistFilter(listener);
    store.togglePlaylistFilter(5);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.togglePlaylistFilter(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
