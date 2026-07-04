/**
 * Template snapshot store (mix-editor issue 03): boot load, optimistic
 * CRUD write-through — against a fake at the true seam (fetch; ADR 0002).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransitionTemplate } from './templateModel';
import {
  _resetTemplateStoreForTests,
  deleteTemplate,
  initTemplateStore,
  saveTemplate,
  snapshotTemplates,
  subscribeTemplates,
} from './templateStore';

type FetchCall = { url: string; method: string; body: unknown };

function fakeFetch(rows: unknown[], opts: { failWrites?: boolean; failGet?: boolean } = {}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (method === 'GET' && opts.failGet) throw new Error('backend down');
    if (method !== 'GET' && opts.failWrites) return { ok: false, status: 500 } as Response;
    return {
      ok: true,
      status: method === 'POST' ? 201 : 200,
      json: async () => (method === 'GET' ? rows : (calls.at(-1)!.body as unknown)),
    } as unknown as Response;
  });
  return { fn, calls };
}

const wireRow = {
  uuid: 't1',
  name: 'bass swap',
  align_a_base: 'cue_4',
  align_delta_beats: 64,
  align_b_base: 'cue_4',
  before_beats: 32,
  after_beats: 32,
  scalable: true,
  lanes: { eqLowA: [{ x: 0, y: 0.5 }] },
};

const domain = (uuid = 't2', name = 'drop cut'): TransitionTemplate => ({
  uuid,
  name,
  alignABase: 'cue_4',
  deltaBeats: 0,
  alignBBase: 'grid_origin',
  beforeBeats: 0,
  afterBeats: 32,
  scalable: false,
  lanes: {},
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  _resetTemplateStoreForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initTemplateStore', () => {
  it('loads and maps wire rows to the domain shape', async () => {
    vi.stubGlobal('fetch', fakeFetch([wireRow]).fn);
    await initTemplateStore();
    expect(snapshotTemplates()).toEqual([
      {
        uuid: 't1',
        name: 'bass swap',
        alignABase: 'cue_4',
        deltaBeats: 64,
        alignBBase: 'cue_4',
        beforeBeats: 32,
        afterBeats: 32,
        scalable: true,
        lanes: { eqLowA: [{ x: 0, y: 0.5 }] },
      },
    ]);
  });

  it('degrades to empty on a dead backend (never rejects)', async () => {
    vi.stubGlobal('fetch', fakeFetch([], { failGet: true }).fn);
    await expect(initTemplateStore()).resolves.toBeUndefined();
    expect(snapshotTemplates()).toEqual([]);
  });
});

describe('saveTemplate / deleteTemplate', () => {
  it('creates new uuids via POST, optimistically', async () => {
    const { fn, calls } = fakeFetch([]);
    vi.stubGlobal('fetch', fn);
    await initTemplateStore();

    const seen: number[] = [];
    subscribeTemplates((t) => seen.push(t.length));
    saveTemplate(domain());
    expect(snapshotTemplates().map((t) => t.uuid)).toEqual(['t2']); // sync
    expect(seen).toEqual([1]);
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ uuid: 't2', align_b_base: 'grid_origin' });
  });

  it('updates known uuids via PUT', async () => {
    const { fn, calls } = fakeFetch([wireRow]);
    vi.stubGlobal('fetch', fn);
    await initTemplateStore();

    saveTemplate({ ...snapshotTemplates()[0], name: 'renamed' });
    expect(snapshotTemplates()[0].name).toBe('renamed');
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/t1'))).toBe(true);
    });
  });

  it('deletes optimistically via DELETE', async () => {
    const { fn, calls } = fakeFetch([wireRow]);
    vi.stubGlobal('fetch', fn);
    await initTemplateStore();

    deleteTemplate('t1');
    expect(snapshotTemplates()).toEqual([]);
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/t1'))).toBe(true);
    });
  });

  it('write failures keep the optimistic snapshot and only log', async () => {
    const { fn } = fakeFetch([], { failWrites: true });
    vi.stubGlobal('fetch', fn);
    await initTemplateStore();

    saveTemplate(domain());
    await Promise.resolve();
    expect(snapshotTemplates()).toHaveLength(1);
    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalled();
    });
  });
});
