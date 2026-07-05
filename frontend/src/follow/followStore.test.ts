/**
 * Follow flags store (follow-mode 02) — persistence face, tested against
 * a fake at the true seam (localStorage; ADR 0002), like the
 * transition-store tests. Reducer semantics live in model.test.ts; here we
 * pin boot restore/validation and dispatch's persist+notify behavior.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-follow-flags';

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
  return await import('./followStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('followStore', () => {
  it('restores persisted flags on boot', async () => {
    const store = await loadStore('{"A":true,"B":false}');
    expect(store.getFollowFlags()).toEqual({ A: true, B: false });
  });

  it('treats garbage and non-boolean values as off', async () => {
    expect((await loadStore('not json')).getFollowFlags()).toEqual({ A: false, B: false });
    expect((await loadStore('{"A":"yes","B":1}')).getFollowFlags()).toEqual({
      A: false,
      B: false,
    });
  });

  it('dispatch persists the new flags and notifies subscribers', async () => {
    const store = await loadStore();
    const seen: unknown[] = [];
    store.subscribeFollow(() => seen.push(store.getFollowFlags()));
    store.dispatchFollow({ type: 'toggle', deck: 'A', loaded: true });
    expect(store.getFollowFlags()).toEqual({ A: true, B: false });
    expect(seen).toEqual([{ A: true, B: false }]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ A: true, B: false });
  });

  it('a rejected event neither persists nor notifies', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribeFollow(() => {
      calls += 1;
    });
    store.dispatchFollow({ type: 'toggle', deck: 'A', loaded: false }); // enable-on-empty
    expect(calls).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
