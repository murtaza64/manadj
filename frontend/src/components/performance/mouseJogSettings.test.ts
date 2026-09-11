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
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 2, acceleration: 1.8, smoothingMs: 50 });
    const initial = store.getMouseJogSettings();
    expect(store.getMouseJogSettings()).toBe(initial);
    store.setMouseJogSettings({ sensitivity: 2 });
    expect(store.getMouseJogSettings()).toBe(initial);
  });

  it('merges patches, clamps bounds, and replaces nonfinite values with defaults', async () => {
    const store = await import('./mouseJogSettings');
    store.setMouseJogSettings({ sensitivity: 20, acceleration: 0, smoothingMs: -1 });
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 12, acceleration: 1, smoothingMs: 0 });
    store.setMouseJogSettings({ sensitivity: -2, acceleration: 9, smoothingMs: 500 });
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 0.25, acceleration: 3, smoothingMs: 200 });
    store.setMouseJogSettings({ sensitivity: 4 });
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 4, acceleration: 3, smoothingMs: 200 });
    store.setMouseJogSettings({ sensitivity: NaN, acceleration: Infinity, smoothingMs: -Infinity });
    expect(store.getMouseJogSettings()).toEqual(store.DEFAULT_MOUSE_JOG_SETTINGS);
  });

  it('writes through the inventoried key and removes it on reset', async () => {
    const store = await import('./mouseJogSettings');
    expect(PERSISTED_SETTING_KEYS).toContain(key);
    store.setMouseJogSettings({ sensitivity: 12 });
    const value = JSON.stringify({ version: 1, settings: store.getMouseJogSettings() });
    expect(storage.getItem(key)).toBe(value);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/settings/${key}`), expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ value }),
    }));
    store.resetMouseJogSettings();
    expect(store.getMouseJogSettings()).toEqual(store.DEFAULT_MOUSE_JOG_SETTINGS);
    expect(storage.getItem(key)).toBeNull();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/settings/${key}`), expect.objectContaining({ method: 'DELETE' })));
  });

  it('restores the cached preference once at boot, sanitizing partial JSON', async () => {
    storage.setItem(key, JSON.stringify({ version: 1, settings: { sensitivity: 6, acceleration: 9, smoothingMs: 'bad' } }));
    const store = await import('./mouseJogSettings');
    expect(store.getMouseJogSettings()).toEqual({ sensitivity: 6, acceleration: 3, smoothingMs: 50 });
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

  it('matches the chosen response, direction, full-scale reach, and fine control', async () => {
    const { mouseJogBendTarget: target, DEFAULT_MOUSE_JOG_SETTINGS: baseline } = await import('./mouseJogSettings');
    expect(target(200, baseline).toFixed(2)).toBe('0.06');
    expect(target(600, baseline).toFixed(2)).toBe('0.44');
    expect(target(1200, baseline).toFixed(2)).toBe('1.54');
    expect(target(-600, baseline)).toBe(-target(600, baseline));
    expect(target(500, { ...baseline, sensitivity: 12 })).toBe(8);
    expect(target(3000, baseline)).toBe(8);
    expect(target(600, { ...baseline, acceleration: 3 })).toBeLessThan(target(600, baseline));
    expect(target(6000, { ...baseline, acceleration: 3 })).toBe(8);
    expect(target(600, { ...baseline, smoothingMs: 200 })).toBe(target(600, baseline));
  });

  it('never emits NaN or overshoots, including malformed numeric inputs', async () => {
    const { mouseJogBendTarget: target } = await import('./mouseJogSettings');
    for (const velocity of [0, -0, NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, 200, -1200]) {
      for (const sensitivity of [0.25, 12, NaN, Infinity]) {
        for (const acceleration of [1, 3, NaN, -Infinity]) {
          const value = target(velocity, { sensitivity, acceleration, smoothingMs: 0 });
          expect(Number.isFinite(value)).toBe(true);
          expect(Math.abs(value)).toBeLessThanOrEqual(8);
        }
      }
    }
  });
});
