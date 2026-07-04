/**
 * Transition snapshot store (mix-editor 26 / ADR 0011): boot load, the
 * one-shot localStorage migration, and optimistic pair writes — against
 * fakes at the true seams (fetch, localStorage; ADR 0002).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultMix } from './mixModel';
import {
  _resetTransitionStoreForTests,
  initTransitionStore,
  savePairEntry,
  snapshotPairStore,
  subscribePairStore,
} from './pairStore';
import type { SavedTransition } from './pairStore';

// ── Seams ───────────────────────────────────────────────────────────────

function fakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    _data: data,
  };
}

type FetchCall = { url: string; method: string; body: unknown };

/** Fake backend: canned GET rows, records PUTs, optional failure. */
function fakeFetch(rows: unknown[], opts: { failPuts?: boolean; failGet?: boolean } = {}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (method === 'GET' && opts.failGet) throw new Error('backend down');
    if (method === 'PUT' && opts.failPuts) return { ok: false, status: 500 } as Response;
    return {
      ok: true,
      status: 200,
      json: async () => (method === 'GET' ? rows : []),
    } as unknown as Response;
  });
  return { fn, calls };
}

let storage: ReturnType<typeof fakeLocalStorage>;

beforeEach(() => {
  storage = fakeLocalStorage();
  vi.stubGlobal('localStorage', storage);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  _resetTransitionStoreForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const edited = (uuid: string, name = 'drop swap'): SavedTransition => ({
  uuid,
  name,
  transition: { ...defaultMix().transition, durationSec: 8 },
});

const row = (a: number, b: number, uuid: string, position: number, extra = {}) => ({
  a_track_id: a,
  b_track_id: b,
  uuid,
  position,
  name: 'drop swap',
  favorite: false,
  data: { ...defaultMix().transition, durationSec: 8 },
  ...extra,
});

// ── Boot load ───────────────────────────────────────────────────────────

describe('init from DB rows', () => {
  it('groups rows into pairs, position-ordered, active from localStorage', async () => {
    storage.setItem('manadj-transition-active', JSON.stringify({ '1:2': 1 }));
    const { fn } = fakeFetch([
      row(1, 2, 'u1', 0),
      row(1, 2, 'u2', 1, { favorite: true }),
      row(3, 4, 'u3', 0),
    ]);
    vi.stubGlobal('fetch', fn);

    await initTransitionStore();
    const store = snapshotPairStore();
    expect(Object.keys(store).sort()).toEqual(['1:2', '3:4']);
    expect(store['1:2'].items.map((i) => i.uuid)).toEqual(['u1', 'u2']);
    expect(store['1:2'].active).toBe(1);
    expect(store['1:2'].items[1].favorite).toBe(true);
    expect(store['3:4'].active).toBe(0);
    expect(store['1:2'].items[0].transition.durationSec).toBe(8);
  });

  it('clamps a stale active index', async () => {
    storage.setItem('manadj-transition-active', JSON.stringify({ '1:2': 7 }));
    const { fn } = fakeFetch([row(1, 2, 'u1', 0)]);
    vi.stubGlobal('fetch', fn);

    await initTransitionStore();
    expect(snapshotPairStore()['1:2'].active).toBe(0);
  });

  it('is idempotent (one GET) and notifies subscribers once loaded', async () => {
    const { fn } = fakeFetch([row(1, 2, 'u1', 0)]);
    vi.stubGlobal('fetch', fn);
    const seen: string[][] = [];
    subscribePairStore((s) => seen.push(Object.keys(s)));

    await Promise.all([initTransitionStore(), initTransitionStore()]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([['1:2']]);
  });

  it('a dead backend degrades to an empty store without rejecting', async () => {
    const { fn } = fakeFetch([], { failGet: true });
    vi.stubGlobal('fetch', fn);

    await expect(initTransitionStore()).resolves.toBeUndefined();
    expect(snapshotPairStore()).toEqual({});
  });
});

// ── One-shot migration ──────────────────────────────────────────────────

describe('legacy localStorage migration', () => {
  const legacyStore = () => ({
    '1:2': { items: [{ name: 'drop swap', transition: { ...defaultMix().transition, durationSec: 8 } }], active: 0 },
  });

  it('DB empty + legacy key: pushes pairs with fresh uuids, renames key to backup', async () => {
    storage.setItem('manadj-transition-pairs', JSON.stringify(legacyStore()));
    const { fn, calls } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);

    await initTransitionStore();

    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toContain('/transitions/pair/1/2');
    const items = (puts[0].body as { items: { uuid: string; name: string }[] }).items;
    expect(items[0].name).toBe('drop swap');
    expect(items[0].uuid).toBeTruthy();

    expect(storage.getItem('manadj-transition-pairs')).toBeNull();
    expect(storage.getItem('manadj-transition-pairs-pre-db-backup')).toContain('drop swap');
    expect(snapshotPairStore()['1:2'].items[0].uuid).toBe(items[0].uuid);
  });

  it('prunes pristine-shaped legacy saves before pushing', async () => {
    storage.setItem(
      'manadj-transition-pairs',
      JSON.stringify({
        ...legacyStore(),
        '3:4': { items: [{ name: 'Transition 1', transition: defaultMix().transition }], active: 0 },
      })
    );
    const { fn, calls } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);

    await initTransitionStore();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(snapshotPairStore()['3:4']).toBeUndefined();
  });

  it('keeps the legacy key when a push fails (next boot retries)', async () => {
    storage.setItem('manadj-transition-pairs', JSON.stringify(legacyStore()));
    const { fn } = fakeFetch([], { failPuts: true });
    vi.stubGlobal('fetch', fn);

    await initTransitionStore();
    expect(storage.getItem('manadj-transition-pairs')).not.toBeNull();
    expect(storage.getItem('manadj-transition-pairs-pre-db-backup')).toBeNull();
    // Editing still works off the local snapshot meanwhile.
    expect(snapshotPairStore()['1:2']).toBeDefined();
  });

  it('DB non-empty: legacy data is ignored, never merged', async () => {
    storage.setItem(
      'manadj-transition-pairs',
      JSON.stringify({ '9:9': legacyStore()['1:2'] })
    );
    const { fn, calls } = fakeFetch([row(1, 2, 'u1', 0)]);
    vi.stubGlobal('fetch', fn);

    await initTransitionStore();
    expect(snapshotPairStore()['9:9']).toBeUndefined();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(storage.getItem('manadj-transition-pairs')).not.toBeNull(); // untouched
  });

  it('migrates the PROTOTYPE-era keys through to the push', async () => {
    storage.setItem('PROTOTYPE-transition-editor-pairs', JSON.stringify(legacyStore()));
    storage.setItem('PROTOTYPE-transition-editor-last', '1:2');
    const { fn, calls } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);

    await initTransitionStore();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(storage.getItem('manadj-last-pair')).toBe('1:2');
    expect(storage.getItem('PROTOTYPE-transition-editor-pairs')).toBeNull();
  });
});

// ── Writes ──────────────────────────────────────────────────────────────

describe('savePairEntry', () => {
  beforeEach(async () => {
    const { fn } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);
    await initTransitionStore();
  });

  it('updates the snapshot synchronously, notifies, PUTs in background', async () => {
    const { fn, calls } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);
    const seen: string[][] = [];
    subscribePairStore((s) => seen.push(Object.keys(s)));

    savePairEntry('1:2', { items: [edited('u1')], active: 0 });
    expect(snapshotPairStore()['1:2'].items[0].uuid).toBe('u1'); // sync
    expect(seen).toEqual([['1:2']]);

    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/transitions/pair/1/2');
    expect((put.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('persists active per pair in localStorage, not in the PUT payload', async () => {
    const { fn, calls } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);

    savePairEntry('1:2', { items: [edited('u1'), edited('u2', 'other')], active: 1 });
    expect(JSON.parse(storage.getItem('manadj-transition-active')!)).toEqual({ '1:2': 1 });
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(JSON.stringify(put.body)).not.toContain('"active"');
  });

  it('null deletes the pair (empty-items PUT) and clears its active', async () => {
    savePairEntry('1:2', { items: [edited('u1')], active: 0 });
    const { fn, calls } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);

    savePairEntry('1:2', null);
    expect(snapshotPairStore()['1:2']).toBeUndefined();
    expect(JSON.parse(storage.getItem('manadj-transition-active')!)).toEqual({});
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect((calls.find((c) => c.method === 'PUT')!.body as { items: unknown[] }).items).toEqual([]);
  });

  it('a failed PUT keeps the optimistic snapshot and logs', async () => {
    const { fn, calls } = fakeFetch([], { failPuts: true });
    vi.stubGlobal('fetch', fn);

    savePairEntry('1:2', { items: [edited('u1')], active: 0 });
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(snapshotPairStore()['1:2']).toBeDefined();
  });
});
