// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { Track } from '../types';
import { api } from '../api/client';
import { dispatchFollow, getFollowFlags, useFollowFlags } from './followStore';
import { useRankedFollow } from './useRankedFollow';

vi.mock('../api/client', () => ({ api: { tracks: { get: vi.fn(), list: vi.fn() } } }));
vi.mock('../settings/persistedSettings', () => ({ writeSetting: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  for (const deck of ['A', 'B', 'C', 'D'] as const) {
    if (getFollowFlags()[deck]) dispatchFollow({ type: 'toggle', deck, loaded: true });
  }
  vi.clearAllMocks();
});

it('joins query results by reference identity when Follow drops, switches and spreads', async () => {
  const a = { id: 1, tags: [], key: 19, artist: '', bpm: 120, energy: 3 } as unknown as Track;
  const b = { ...a, id: 2, key: 9 };
  const candidate = { ...a, id: 3 };
  const source = [a, b, candidate];
  const loaded = { A: a, B: b, C: null, D: null };
  const transitions = { from: new Map(), into: new Map() };
  const links = new Set<string>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['track', 1], a);
  client.setQueryData(['track', 2], b);
  vi.mocked(api.tracks.list).mockResolvedValue({ items: source } as never);
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  dispatchFollow({ type: 'toggle', deck: 'B', loaded: true });
  function View() {
    const follow = useRankedFollow(loaded, transitions, links, false);
    const flags = useFollowFlags();
    const pins = source.filter(t => follow.groupLabelFor?.(t) === 'Following').map(t => t.id);
    useEffect(() => {
      expect(pins).toEqual([...(flags.A ? [1] : []), ...(flags.B ? [2] : [])]);
    });
    return <span>{follow.project(source, true).map(t => t.id).join(',')}</span>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><View /></QueryClientProvider>));
    await settle();
    expect(container.textContent).toBe('2');
    for (let i = 0; i < 3; i++) {
      act(() => dispatchFollow({ type: 'play', deck: 'A', playing: { A: true, B: false, C: false, D: false } }));
      await settle();
      expect(container.textContent).toBe('1,3');
      act(() => dispatchFollow({ type: 'play', deck: 'B', playing: { A: true, B: true, C: false, D: false } }));
      await settle();
      expect(container.textContent).toBe('1,2,3');
      act(() => dispatchFollow({ type: 'pause', deck: 'A', playing: { A: false, B: true, C: false, D: false } }));
      await settle();
      expect(container.textContent).toBe('2');
    }
    expect(warnings.mock.calls.flat().join(' ')).not.toContain('Duplicate Queries');
  } finally {
    act(() => root.unmount());
    client.clear();
    warnings.mockRestore();
  }
});

it('reuses projections across UI renders and observes fresh same-ID reference facts', async () => {
  const reference = { id: 1, tags: [], key: 19, artist: '', bpm: 120, energy: 3 } as unknown as Track;
  const candidate = { ...reference, id: 2 };
  const source = [candidate];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['track', 1], reference);
  vi.mocked(api.tracks.list).mockResolvedValue({ items: source } as never);
  dispatchFollow({ type: 'toggle', deck: 'A', loaded: true });
  dispatchFollow({ type: 'toggle', deck: 'B', loaded: true });
  const loaded = { A: reference, B: reference, C: null, D: null };
  const transitions = { from: new Map(), into: new Map() };
  const links = new Set<string>();
  let value: ReturnType<typeof useRankedFollow> | undefined;
  function View() {
    const current = useRankedFollow(loaded, transitions, links, false);
    useEffect(() => { value = current; });
    return <span>{current.project(source, true).map(t => t.id).join(',')}</span>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = () => act(async () => { root.render(<QueryClientProvider client={client}><View /></QueryClientProvider>); });
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  try {
    await render();
    await settle();
    expect(container.textContent).toBe('2');
    expect(api.tracks.list).toHaveBeenCalledTimes(1); // Same Track on A/B is one query.
    const before = value!;
    const projection = value!.project(source, true);
    await render();
    expect(value).toBe(before);
    expect(value!.project(source, true)).toBe(projection);
    act(() => client.setQueryData(['track', 1], { ...reference, key: 9 }));
    await settle();
    expect(container.textContent).toBe('');
    expect(value).not.toBe(before);
    expect(api.tracks.list).toHaveBeenCalledTimes(1); // Key changed, not the BPM gate.
    act(() => client.setQueryData(['track', 1], { ...reference, bpm: 130 }));
    await settle();
    expect(api.tracks.list).toHaveBeenLastCalledWith(1, 10000, {
      bpmCenter: 130, bpmThresholdPercent: 5, archived: undefined,
    });
  } finally {
    act(() => root.unmount());
    client.clear();
  }
});
