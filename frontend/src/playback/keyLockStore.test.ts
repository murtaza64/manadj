/**
 * Key Lock store (key-lock 03) — boot restore/validation and
 * persist+notify, against a fake localStorage at the true seam (ADR 0002;
 * followStore test idiom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-keylock';

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
  return await import('./keyLockStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keyLockStore', () => {
  it('defaults both decks ON with nothing persisted', async () => {
    const store = await loadStore();
    expect(store.getKeyLockFlags()).toEqual({ A: true, B: true });
  });

  it('restores persisted flags on boot', async () => {
    const store = await loadStore('{"A":false,"B":true}');
    expect(store.getKeyLockFlags()).toEqual({ A: false, B: true });
  });

  it('treats garbage as the default (ON) — only explicit false is off', async () => {
    expect((await loadStore('not json')).getKeyLockFlags()).toEqual({ A: true, B: true });
    expect((await loadStore('{"A":"no","B":0}')).getKeyLockFlags()).toEqual({
      A: true,
      B: true,
    });
  });

  it('setKeyLockFlag persists and notifies; same-value writes are no-ops', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribeKeyLock(() => {
      calls += 1;
    });
    store.setKeyLockFlag('A', true); // already true
    expect(calls).toBe(0);
    store.setKeyLockFlag('A', false);
    expect(calls).toBe(1);
    expect(store.getKeyLockFlags()).toEqual({ A: false, B: true });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ A: false, B: true });
  });
});
