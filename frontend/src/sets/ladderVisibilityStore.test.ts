/**
 * Set-timeline visibility store (sets #161): toggle + persistence, the
 * #68 perf-section idiom (fake localStorage at the true seam). View-only
 * — no plan/Conductor coupling to test by construction (the ladder
 * unmounts; nothing else reads the store).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-set-ladder';

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
  return await import('./ladderVisibilityStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ladderVisibilityStore', () => {
  it('defaults shown; toggle hides, notifies, persists', async () => {
    const store = await loadStore();
    expect(store.isLadderShown()).toBe(true);
    let notified = 0;
    const un = store.subscribeLadderShown(() => notified++);
    store.toggleLadderShown();
    expect(store.isLadderShown()).toBe(false);
    expect(notified).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('hidden');
    un();
  });

  it('boot-restores hidden; toggling back persists shown', async () => {
    const store = await loadStore('hidden');
    expect(store.isLadderShown()).toBe(false);
    store.toggleLadderShown();
    expect(store.isLadderShown()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('shown');
  });

  it('garbage storage falls back to shown', async () => {
    const store = await loadStore('wat');
    expect(store.isLadderShown()).toBe(true);
  });
});
