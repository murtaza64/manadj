/**
 * Quantize toggle store (looping 01) — boot restore and persist+notify,
 * against a fake localStorage at the true seam (keyLockStore test idiom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-quantize';

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
  return await import('./quantizeStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quantizeStore', () => {
  it('defaults ON with nothing persisted', async () => {
    expect((await loadStore()).isQuantizeOn()).toBe(true);
  });

  it('restores a persisted OFF on boot', async () => {
    expect((await loadStore('false')).isQuantizeOn()).toBe(false);
  });

  it('treats garbage as the default (ON) — only explicit false is off', async () => {
    expect((await loadStore('not json')).isQuantizeOn()).toBe(true);
    expect((await loadStore('0')).isQuantizeOn()).toBe(true);
  });

  it('setQuantize persists and notifies; same-value writes are no-ops', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribeQuantize(() => {
      calls += 1;
    });
    store.setQuantize(true); // already on
    expect(calls).toBe(0);
    store.setQuantize(false);
    expect(calls).toBe(1);
    expect(store.isQuantizeOn()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });
});
