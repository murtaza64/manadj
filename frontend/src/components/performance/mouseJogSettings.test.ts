// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSISTED_SETTING_KEYS } from '../../settings/persistedSettings';

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
});
const key = 'manadj-mouse-jog';

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  vi.resetModules();
});

describe('mouse jog settings', () => {
  it('starts with the chosen defaults and caches a stable snapshot', async () => {
    const store = await import('./mouseJogSettings');
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 2, acceleration: 1.8, smoothingMs: 50, maxBendPercent: 25 });
    const initial = store.getMouseJogSettings();
    expect(store.getMouseJogSettings()).toBe(initial);
    store.setMouseJogSettings({ sensitivity: 2 });
    expect(store.getMouseJogSettings()).toBe(initial);
  });

  it('merges patches, clamps bounds, and replaces nonfinite values with defaults', async () => {
    const store = await import('./mouseJogSettings');
    store.setMouseJogSettings({ sensitivity: 20, acceleration: 0, smoothingMs: -1 });
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 12, acceleration: 1, smoothingMs: 0, maxBendPercent: 25 });
    store.setMouseJogSettings({ sensitivity: -2, acceleration: 9, smoothingMs: 500 });
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 0.25, acceleration: 3, smoothingMs: 200, maxBendPercent: 25 });
    store.setMouseJogSettings({ sensitivity: 4 });
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 4, acceleration: 3, smoothingMs: 200, maxBendPercent: 25 });
    store.setMouseJogSettings({ sensitivity: NaN, acceleration: Infinity, smoothingMs: -Infinity });
    expect(store.getMouseJogSettings()).toEqual(store.DEFAULT_MOUSE_JOG_SETTINGS);
  });

  it('writes through the inventoried key and removes it on reset', async () => {
    const store = await import('./mouseJogSettings');
    expect(PERSISTED_SETTING_KEYS).toContain(key);
    store.setMouseJogSettings({ sensitivity: 12, maxBendPercent: 50 });
    const value = JSON.stringify({ version: 1, settings: store.getMouseJogSettings() });
    expect(storage.getItem(key)).toBe(value);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/settings/${key}`), expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ value }),
    }));
    store.resetMouseJogSettings();
    expect(store.getMouseJogSettings()).toEqual(store.DEFAULT_MOUSE_JOG_SETTINGS);
    expect(store.getMouseJogSettings().maxBendPercent).toBe(25);
    expect(storage.getItem(key)).toBeNull();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/settings/${key}`), expect.objectContaining({ method: 'DELETE' })));
  });

  it('restores the cached preference once at boot, sanitizing partial JSON', async () => {
    storage.setItem(key, JSON.stringify({ version: 1, settings: { sensitivity: 6, acceleration: 9, smoothingMs: 'bad' } }));
    const store = await import('./mouseJogSettings');
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 6, acceleration: 3, smoothingMs: 50, maxBendPercent: 25 });
    storage.setItem(key, '{}');
    expect(store.getMouseJogSettings().sensitivity).toBe(6);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['broken', 'null', '[]', '{"version":2}', '{"version":1,"settings":null}'])(
    'uses defaults for invalid cache %s', async (value) => {
      storage.setItem(key, value);
      const store = await import('./mouseJogSettings');
      expect(store.getMouseJogSettings()).toEqual(store.DEFAULT_MOUSE_JOG_SETTINGS);
    },
  );

  it('preserves all existing v1 preferences when the maximum bend is missing', async () => {
    storage.setItem(key, JSON.stringify({ version: 1, settings: { sensitivity: 6, acceleration: 2.5, smoothingMs: 125 } }));
    const store = await import('./mouseJogSettings');
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 6, acceleration: 2.5, smoothingMs: 125, maxBendPercent: 25 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('publishes cap-only changes, preserves equal snapshots and restores the saved maximum', async () => {
    const store = await import('./mouseJogSettings');
    const initial = store.getMouseJogSettings();
    store.setMouseJogSettings({ maxBendPercent: 42 });
    const changed = store.getMouseJogSettings();
    expect(changed).not.toBe(initial);
    expect(changed).toEqual({ ...initial, maxBendPercent: 42 });
    store.setMouseJogSettings({ maxBendPercent: 42 });
    expect(store.getMouseJogSettings()).toBe(changed);
    vi.resetModules();
    const restored = await import('./mouseJogSettings');
    expect(restored.getMouseJogSettings()).toEqual(changed);
  });

  it.each([
    [-100, 8], [0, 8], [7.9, 8], [8, 8], [25, 25], [42.5, 42.5], [50, 50], [51, 50],
    [NaN, 25], [Infinity, 25], [-Infinity, 25], [undefined, 25],
  ])('sanitizes a maximum bend patch of %s to %s', async (maxBendPercent, expected) => {
    const store = await import('./mouseJogSettings');
    store.setMouseJogSettings({ maxBendPercent: 40 });
    store.setMouseJogSettings({ maxBendPercent });
    expect(store.getMouseJogSettings()).toEqual({ ...store.DEFAULT_MOUSE_JOG_SETTINGS, maxBendPercent: expected });
  });

  it.each([['50', 25], [null, 25], [{}, 25], [-1, 8], [100, 50]])(
    'sanitizes a cached maximum bend of %j to %s', async (maxBendPercent, expected) => {
      storage.setItem(key, JSON.stringify({ version: 1, settings: { maxBendPercent } }));
      const store = await import('./mouseJogSettings');
      expect(store.getMouseJogSettings().maxBendPercent).toBe(expected);
    },
  );

  it('matches the chosen response, direction, full-scale reach, and fine control', async () => {
    const { mouseJogBendTarget: target, DEFAULT_MOUSE_JOG_SETTINGS: baseline } = await import('./mouseJogSettings');
    expect(target(200, baseline).toFixed(2)).toBe('0.06');
    expect(target(600, baseline).toFixed(2)).toBe('0.44');
    expect(target(1200, baseline).toFixed(2)).toBe('1.54');
    expect(target(-600, baseline)).toBe(-target(600, baseline));
    expect(target(500, { ...baseline, sensitivity: 12 })).toBe(8);
    expect(target(3000, baseline)).toBe(8);
    expect(target(600, { ...baseline, acceleration: 3 })).toBeLessThan(target(600, baseline));
    expect(target(6000, { ...baseline, acceleration: 3 })).toBe(25);
    expect(target(600, { ...baseline, smoothingMs: 200 })).toBe(target(600, baseline));
  });

  it.each([8, 25, 50])('retains the original gain with a %s percent ceiling and reaches the configured full-bend speed', async maxBendPercent => {
    const { mouseJogBendTarget: target, DEFAULT_MOUSE_JOG_SETTINGS: baseline } = await import('./mouseJogSettings');
    for (const sensitivity of [0.25, 2, 12]) {
      for (const acceleration of [1, 1.8, 3]) {
        const settings = { ...baseline, sensitivity, acceleration, maxBendPercent };
        for (const fraction of [0, 0.01, 0.1, 0.5, 0.99, 1]) {
          const velocity = 6000 / sensitivity * fraction;
          const original = 8 * (velocity * sensitivity / 6000) ** acceleration;
          expect(target(velocity, settings)).toBe(original);
          expect(target(velocity, settings)).toBe(target(velocity, { ...settings, maxBendPercent: 8 }));
          expect(target(-velocity, settings)).toBe(velocity === 0 ? 0 : -original);
        }
        const fullSpeed = 6000 / sensitivity * (maxBendPercent / 8) ** (1 / acceleration);
        expect(target(fullSpeed, settings)).toBeCloseTo(maxBendPercent, 10);
        expect(target(fullSpeed * 0.9, settings)).toBeLessThan(maxBendPercent);
        expect(target(fullSpeed * 2, settings)).toBe(maxBendPercent);
        expect(target(-fullSpeed * 2, settings)).toBe(-maxBendPercent);
      }
    }
  });

  it('allows coarse default bends above 8, reaches 50 at high speed and restores the old limit at 8', async () => {
    const { mouseJogBendTarget: target, DEFAULT_MOUSE_JOG_SETTINGS: baseline } = await import('./mouseJogSettings');
    expect(target(4000, baseline)).toBeGreaterThan(8);
    expect(target(4000, baseline)).toBeLessThan(25);
    expect(target(12000, baseline)).toBe(25);
    expect(target(12000, { ...baseline, maxBendPercent: 50 })).toBe(50);
    expect(target(12000, { ...baseline, maxBendPercent: 8 })).toBe(8);
  });

  it('never emits NaN or overshoots, including malformed numeric inputs', async () => {
    const { mouseJogBendTarget: target } = await import('./mouseJogSettings');
    for (const velocity of [0, -0, NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, 200, -1200]) {
      for (const sensitivity of [0.25, 12, NaN, Infinity]) {
        for (const acceleration of [1, 3, NaN, -Infinity]) {
          for (const maxBendPercent of [8, 25, 50, -1, 100, NaN, Infinity]) {
            const value = target(velocity, { sensitivity, acceleration, smoothingMs: 0, maxBendPercent });
            const cap = Number.isFinite(maxBendPercent) ? Math.max(8, Math.min(50, maxBendPercent)) : 25;
            expect(Number.isFinite(value)).toBe(true);
            expect(Math.abs(value)).toBeLessThanOrEqual(cap);
            if (!Number.isFinite(velocity) || velocity === 0) expect(value).toBe(0);
          }
        }
      }
    }
  });
});
