import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'manadj-cue-mode';

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

async function loadStore(stored?: string) {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage(stored ? { [KEY]: stored } : {}));
  return await import('./cueModeStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cueModeStore', () => {
  it('defaults to gated', async () => {
    expect((await loadStore()).getCueMode()).toBe('gated');
    expect((await loadStore('garbage')).getCueMode()).toBe('gated');
  });

  it('restores trigger on boot', async () => {
    expect((await loadStore('trigger')).getCueMode()).toBe('trigger');
  });

  it('setCueMode persists and notifies; same-value writes are no-ops', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribeCueMode(() => {
      calls += 1;
    });
    store.setCueMode('gated');
    expect(calls).toBe(0);
    store.setCueMode('trigger');
    expect(calls).toBe(1);
    expect(store.getCueMode()).toBe('trigger');
    expect(localStorage.getItem(KEY)).toBe('trigger');
  });
});
