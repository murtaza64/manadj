// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { FilterProvider, useFilters } from '../contexts/FilterContext';
import { notePlayedEvent, playedTracks, resetPlayed } from '../sessions/playedStore';
import { dispatchFollow, getFollowFlags } from '../follow/followStore';
import { CHANNEL_IDS } from '../playback/mixer';
import FilterBar from './FilterBar';

vi.mock('../settings/persistedSettings', () => ({ writeSetting: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('Clear All resets filters and Follow; Clear played only resets played marks', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  resetPlayed();
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['tags'], []);
  const container = document.createElement('div');
  const root = createRoot(container);
  let filters: ReturnType<typeof useFilters>;
  function Probe() {
    const current = useFilters();
    useEffect(() => { filters = current; });
    return <FilterBar totalTracks={10} filteredCount={3} loadedByDeck={{ A: null, B: null, C: null, D: null }} />;
  }
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}><FilterProvider><Probe /></FilterProvider></QueryClientProvider>
    ));
    const clearPlayed = container.querySelector<HTMLButtonElement>('.filter-bar-clear-played-btn')!;
    const clearFilters = container.querySelector<HTMLButtonElement>('.filter-bar-clear-all-btn')!;
    expect(clearPlayed.disabled).toBe(true);
    expect(clearFilters.disabled).toBe(true);
    act(() => {
      for (const deck of CHANNEL_IDS) dispatchFollow({ type: 'toggle', deck, loaded: true });
    });
    expect(clearFilters.disabled).toBe(false); // Follow alone enables Clear All.
    act(() => clearFilters.click());
    expect(getFollowFlags()).toEqual({ A: false, B: false, C: false, D: false });
    expect(clearFilters.disabled).toBe(true);
    act(() => {
      filters.setFilters({ ...filters.filters, search: 'test', energyMin: 3 });
      notePlayedEvent({ t: 0, kind: 'load', channel: 'A', trackId: 7, bpm: 174 });
      notePlayedEvent({ t: 0, kind: 'transport', channel: 'A', action: 'play', playhead: 0 });
      notePlayedEvent({ t: 21, kind: 'tick', playheads: {} });
    });
    expect(clearPlayed.disabled).toBe(false);
    act(() => clearFilters.click());
    expect(playedTracks().has(7)).toBe(true);
    act(() => {
      filters.setFilters({ ...filters.filters, search: 'keep', energyMin: 2 });
      dispatchFollow({ type: 'toggle', deck: 'C', loaded: true });
    });
    const before = filters!.filters;
    act(() => clearPlayed.click());
    expect(playedTracks().size).toBe(0);
    expect(filters!.filters).toBe(before);
    expect(getFollowFlags().C).toBe(true);
    expect(clearPlayed.disabled).toBe(true);
    act(() => clearFilters.click());
    expect(getFollowFlags().C).toBe(false);
    expect(filters!.filters.search).toBe('');
    expect(filters!.filters.energyMin).toBe(1);
  } finally {
    act(() => root.unmount());
    client.clear();
    resetPlayed();
    vi.unstubAllGlobals();
  }
});
