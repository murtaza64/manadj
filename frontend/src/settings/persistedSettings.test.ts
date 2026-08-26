/**
 * Persisted-settings seam (settings, #176): hydrate semantics.
 * - DB rows win: they overwrite the localStorage cache.
 * - Empty DB: one-time seed from this origin's inventoried localStorage.
 * - Local-only inventoried keys get pushed up after hydration.
 * - Backend down: no-op (cache serves).
 *
 * Fake localStorage at the true seam (the keyLockStore test idiom).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hydratePersistedSettings,
  writeSetting,
  removeSetting,
} from './persistedSettings';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return {
      ok: true,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hydratePersistedSettings', () => {
  it('writes DB rows into the localStorage cache (DB wins)', async () => {
    localStorage.setItem('manadj-quantize', 'true');
    mockFetch(() => ({ settings: { 'manadj-quantize': 'false' } }));

    await hydratePersistedSettings();

    expect(localStorage.getItem('manadj-quantize')).toBe('false');
  });

  it('seeds an empty DB from inventoried localStorage keys only', async () => {
    localStorage.setItem('manadj.waveformStyles', '{"version":1}');
    localStorage.setItem('manadj-visualizer-params:neon', '{"speed":2}');
    localStorage.setItem('manadj-last-pair', '12:34'); // ephemera: excluded
    const fetchMock = mockFetch((url) =>
      url.endsWith('/seed') ? { seeded: true } : { settings: {} },
    );

    await hydratePersistedSettings();

    const seedCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/seed'));
    expect(seedCall).toBeDefined();
    const payload = JSON.parse(seedCall![1]!.body as string);
    expect(payload.settings).toEqual({
      'manadj.waveformStyles': '{"version":1}',
      'manadj-visualizer-params:neon': '{"speed":2}',
    });
  });

  it('does not seed when there is nothing to send', async () => {
    const fetchMock = mockFetch(() => ({ settings: {} }));
    await hydratePersistedSettings();
    expect(fetchMock.mock.calls.every(([url]) => !url.endsWith('/seed'))).toBe(true);
  });

  it('pushes local-only inventoried keys up when the DB has rows', async () => {
    localStorage.setItem('manadj-quantize', 'false');
    const fetchMock = mockFetch((url) =>
      url.includes('/settings') ? { settings: { trackListSort: '{}' } } : {},
    );

    await hydratePersistedSettings();
    await vi.waitFor(() => {
      const push = fetchMock.mock.calls.find(
        ([url, init]) => init?.method === 'PUT' && url.endsWith('/manadj-quantize'),
      );
      expect(push).toBeDefined();
    });
  });

  it('is a no-op when the backend is unreachable', async () => {
    localStorage.setItem('manadj-quantize', 'false');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down');
    }));

    await expect(hydratePersistedSettings()).resolves.toBeUndefined();
    expect(localStorage.getItem('manadj-quantize')).toBe('false');
  });
});

describe('writeSetting / removeSetting', () => {
  it('writes the cache synchronously and PUTs through', async () => {
    const fetchMock = mockFetch(() => ({}));

    writeSetting('manadj-quantize', 'false');

    expect(localStorage.getItem('manadj-quantize')).toBe('false');
    await vi.waitFor(() => {
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/api/settings/manadj-quantize');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init!.body as string)).toEqual({ value: 'false' });
    });
  });

  it('removes from cache and DELETEs through', async () => {
    localStorage.setItem('manadj-keylock', '{}');
    const fetchMock = mockFetch(() => ({}));

    removeSetting('manadj-keylock');

    expect(localStorage.getItem('manadj-keylock')).toBeNull();
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(call?.[0]).toContain('/api/settings/manadj-keylock');
    });
  });

  it('survives fetch being unavailable (tests, offline)', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => writeSetting('manadj-quantize', 'true')).not.toThrow();
    expect(localStorage.getItem('manadj-quantize')).toBe('true');
  });
});
