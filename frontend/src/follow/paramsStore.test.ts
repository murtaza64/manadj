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
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('paramsStore', () => {
  it('boots with defaults when nothing is stored', async () => {
    const store = await loadStore();
    expect(store.getFollowParams()).toMatchObject({
      bpm: true,
      bpmThresholdPercent: 5,
      knownOnly: false,
      temperature: 0,
    });
  });

  it('restores stored params, clamping the BPM threshold into 0–15', async () => {
    // Stale keys from the retired axes (match-score PRD) ride along
    // harmlessly; the clamp still applies.
    const store = await loadStore('{"bpmThresholdPercent":40,"tags":true}');
    expect(store.getFollowParams()).toMatchObject({ bpmThresholdPercent: 15 });
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
    expect(store.getFollowParams().bpm).toBe(true); // merged, not replaced
    expect(calls).toBe(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ knownOnly: true });
  });

  it('restores temperature, defaulting missing/invalid values and clamping the range', async () => {
    expect((await loadStore('{"temperature":0.65}')).getFollowParams().temperature).toBe(0.65);
    expect((await loadStore('{"temperature":2}')).getFollowParams().temperature).toBe(1);
    expect((await loadStore('{"temperature":-1}')).getFollowParams().temperature).toBe(0);
    expect((await loadStore('{"temperature":"bad"}')).getFollowParams().temperature).toBe(0);
    expect((await loadStore('{"knownOnly":true}')).getFollowParams().temperature).toBe(0);
  });

  it('persists temperature but keeps rerolls session-only and stable across parameter edits', async () => {
    const store = await loadStore();
    const initialSeed = store.getFollowSeed();
    store.setFollowParams({ temperature: 0.5 });
    expect(store.getFollowSeed()).toBe(initialSeed);
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(stored!).temperature).toBe(0.5);
    const listener = vi.fn();
    const unsubscribe = store.subscribeFollowParams(listener);
    store.rerollFollow();
    expect(store.getFollowSeed()).not.toBe(initialSeed);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
    store.resetFollowParams();
    expect(store.getFollowParams().temperature).toBe(0);
    store.setFollowParams({ temperature: NaN });
    expect(store.getFollowParams().temperature).toBe(0);
    unsubscribe();
  });

  it('updates the fader immediately but commits ranking and persistence after 150ms idle', async () => {
    vi.useFakeTimers();
    const store = await loadStore();
    const original = store.getFollowParams();
    store.setFollowTemperature(0.2);
    expect(store.getFollowTemperature()).toBe(0.2);
    expect(store.getFollowParams()).toBe(original);
    vi.advanceTimersByTime(100);
    store.setFollowTemperature(0.65);
    vi.advanceTimersByTime(149);
    expect(store.getFollowParams()).toBe(original);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getFollowParams().temperature).toBe(0.65);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).temperature).toBe(0.65);
  });

  it('reset and direct temperature edits cancel pending drafts', async () => {
    vi.useFakeTimers();
    const store = await loadStore();
    store.setFollowTemperature(0.8);
    store.resetFollowParams();
    vi.advanceTimersByTime(200);
    expect(store.getFollowTemperature()).toBe(0);
    expect(store.getFollowParams().temperature).toBe(0);
    store.setFollowTemperature(0.8);
    store.setFollowParams({ temperature: 0.3 });
    vi.advanceTimersByTime(200);
    expect(store.getFollowTemperature()).toBe(0.3);
    expect(store.getFollowParams().temperature).toBe(0.3);
  });

  it('reroll commits the latest draft immediately without losing other parameter edits', async () => {
    vi.useFakeTimers();
    const store = await loadStore();
    const seed = store.getFollowSeed();
    store.setFollowTemperature(0.7);
    store.setFollowParams({ bpm: false });
    expect(store.getFollowTemperature()).toBe(0.7);
    store.rerollFollow();
    const committed = store.getFollowParams();
    expect(committed).toMatchObject({ temperature: 0.7, bpm: false });
    expect(store.getFollowSeed()).not.toBe(seed);
    vi.advanceTimersByTime(200);
    expect(store.getFollowParams()).toBe(committed);
  });
});
