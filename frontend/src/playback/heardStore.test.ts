/**
 * Heard store (#382 desktop port) — boot restore, per-route override
 * resolution, nudge semantics, against a fake localStorage at the true
 * seam (quantizeStore.test idiom).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const MODE_KEY = 'manadj-heard';
const LATENCY_KEY = 'manadj-heard-latency';

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
async function loadStore(stored: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage(stored));
  return await import('./heardStore');
}

const BT = { key: 'bt-1', label: 'Big Speaker', reportedSeconds: 0.212 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('heardStore', () => {
  it('defaults OFF with nothing persisted; heardSeconds() is 0', async () => {
    const store = await loadStore();
    expect(store.isHeardOn()).toBe(false);
    expect(store.heardSeconds()).toBe(0);
  });

  it('restores a persisted ON on boot; garbage reads as OFF', async () => {
    expect((await loadStore({ [MODE_KEY]: 'true' })).isHeardOn()).toBe(true);
    expect((await loadStore({ [MODE_KEY]: 'not json' })).isHeardOn()).toBe(false);
  });

  it('setHeard persists and notifies; same-value writes are no-ops', async () => {
    const store = await loadStore();
    let calls = 0;
    store.subscribeHeard(() => {
      calls += 1;
    });
    store.setHeard(false); // already off
    expect(calls).toBe(0);
    store.setHeard(true);
    expect(calls).toBe(1);
    expect(localStorage.getItem(MODE_KEY)).toBe('true');
  });

  it('heardSeconds() is the reported latency when on, 0 when off', async () => {
    const store = await loadStore({ [MODE_KEY]: 'true' });
    store.registerHeardRouteProvider(() => BT);
    expect(store.heardSeconds()).toBeCloseTo(0.212);
    store.setHeard(false);
    expect(store.heardSeconds()).toBe(0);
  });

  it('a route override beats the report and is remembered per route', async () => {
    const store = await loadStore({ [MODE_KEY]: 'true' });
    store.registerHeardRouteProvider(() => BT);
    store.setRouteLatency(0.35);
    expect(store.heardSeconds()).toBeCloseTo(0.35);
    expect(store.heardRoute().overridden).toBe(true);
    // Another route keeps its own value (the report, until set).
    store.registerHeardRouteProvider(() => ({ key: 'wired', label: 'Wired', reportedSeconds: 0.02 }));
    expect(store.heardSeconds()).toBeCloseTo(0.02);
    // Persisted as JSON keyed by route.
    const saved = JSON.parse(localStorage.getItem(LATENCY_KEY)!) as Record<string, { seconds: number }>;
    expect(saved['bt-1'].seconds).toBeCloseTo(0.35);
    expect(saved['wired']).toBeUndefined();
  });

  it('an override survives reload; clearing it returns to the report', async () => {
    const stored = {
      [MODE_KEY]: 'true',
      [LATENCY_KEY]: JSON.stringify({ 'bt-1': { label: 'Big Speaker', seconds: 0.3 } }),
    };
    const store = await loadStore(stored);
    store.registerHeardRouteProvider(() => BT);
    expect(store.heardSeconds()).toBeCloseTo(0.3);
    store.setRouteLatency(null);
    expect(store.heardSeconds()).toBeCloseTo(0.212);
    expect(store.heardRoute().overridden).toBe(false);
  });

  it('nudge seeds an override from the effective value and clamps to 0..2 s', async () => {
    const store = await loadStore({ [MODE_KEY]: 'true' });
    store.registerHeardRouteProvider(() => BT);
    store.nudgeRouteLatency(0.005);
    expect(store.heardSeconds()).toBeCloseTo(0.217);
    store.setRouteLatency(0.001);
    store.nudgeRouteLatency(-0.005);
    expect(store.heardSeconds()).toBe(0);
    store.setRouteLatency(1.999);
    store.nudgeRouteLatency(0.005);
    expect(store.heardSeconds()).toBe(2);
  });

  it('drops malformed and out-of-range overrides on load', async () => {
    const store = await loadStore({
      [MODE_KEY]: 'true',
      [LATENCY_KEY]: JSON.stringify({
        good: { label: 'x', seconds: 0.1 },
        high: { label: 'x', seconds: 9 },
        junk: 'nope',
        nan: { label: 'x', seconds: 'lots' },
      }),
    });
    store.registerHeardRouteProvider(() => ({ key: 'good', label: 'x', reportedSeconds: 0.05 }));
    expect(store.heardSeconds()).toBeCloseTo(0.1);
    store.registerHeardRouteProvider(() => ({ key: 'high', label: 'x', reportedSeconds: 0.05 }));
    expect(store.heardSeconds()).toBeCloseTo(0.05);
    store.registerHeardRouteProvider(() => ({ key: 'junk', label: 'x', reportedSeconds: 0.05 }));
    expect(store.heardSeconds()).toBeCloseTo(0.05);
  });
  it('updates override status even when the override equals the reported value', async () => {
    const store = await loadStore();
    store.registerHeardRouteProvider(() => BT);
    expect(store.heardRoute().overridden).toBe(false);
    store.setRouteLatency(BT.reportedSeconds);
    expect(store.heardRoute().overridden).toBe(true);
    store.setRouteLatency(null);
    expect(store.heardRoute().overridden).toBe(false);
  });

});
