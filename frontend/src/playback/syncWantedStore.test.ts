/**
 * Remembered SYNC membership store (#399 desktop port) — boot restore and
 * persist+notify, against a fake localStorage at the true seam
 * (quantizeStore.test idiom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-sync-wanted';

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
  return await import('./syncWantedStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncWantedStore', () => {
  it('wants nothing with nothing persisted (desktop default — #399 Port note)', async () => {
    const store = await loadStore();
    for (const deck of ['A', 'B', 'C', 'D'] as const) {
      expect(store.isSyncWanted(deck)).toBe(false);
    }
  });

  it('restores remembered decks on boot; unknown decks and garbage are dropped', async () => {
    const store = await loadStore('["A","D","X",4]');
    expect(store.isSyncWanted('A')).toBe(true);
    expect(store.isSyncWanted('B')).toBe(false);
    expect(store.isSyncWanted('D')).toBe(true);
    expect((await loadStore('not json')).isSyncWanted('A')).toBe(false);
  });

  it('setSyncWanted persists and notifies; same-value writes are no-ops', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribeSyncWanted(() => {
      calls += 1;
    });
    store.setSyncWanted('A', false); // already unwanted
    expect(calls).toBe(0);
    store.setSyncWanted('A', true);
    expect(calls).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["A"]');
    store.setSyncWanted('A', false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
  });

  it('test reset clears membership without touching storage', async () => {
    const store = await loadStore('["B"]');
    expect(store.isSyncWanted('B')).toBe(true);
    store._resetSyncWantedForTests();
    expect(store.isSyncWanted('B')).toBe(false);
  });
});
