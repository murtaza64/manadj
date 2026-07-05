/**
 * Follow parameters store (follow-mode 05) — persistence face, tested
 * against a fake at the true seam (localStorage; ADR 0002), like the
 * follow-flags store tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'manadj-follow-params';

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

/** Fresh module instance per test (module-level singleton). */
async function loadStore(stored?: string) {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage(stored ? { [STORAGE_KEY]: stored } : {}));
  return await import('./paramsStore');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('paramsStore', () => {
  it('boots with defaults when nothing is stored', async () => {
    const store = await loadStore();
    expect(store.getFollowParams()).toMatchObject({
      harmonicKeys: true,
      bpm: true,
      bpmThresholdPercent: 5,
      knownOnly: false,
    });
  });

  it('restores stored params, clamping the BPM threshold into 0–15', async () => {
    const store = await loadStore('{"bpmThresholdPercent":40,"tags":true}');
    expect(store.getFollowParams()).toMatchObject({ bpmThresholdPercent: 15, tags: true });
    expect((await loadStore('garbage')).getFollowParams().bpmThresholdPercent).toBe(5);
  });

  it('setFollowParams merges, persists, and notifies — live, no Apply', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribeFollowParams(() => {
      calls += 1;
    });
    store.setFollowParams({ knownOnly: true });
    expect(store.getFollowParams().knownOnly).toBe(true);
    expect(store.getFollowParams().harmonicKeys).toBe(true); // merged, not replaced
    expect(calls).toBe(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ knownOnly: true });
  });
});
