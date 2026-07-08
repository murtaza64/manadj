// @vitest-environment jsdom
//
// Regression guard for deck-asset-refresh 01: a beatgrid loaded before its
// background analysis finishes must ride out the not-yet-analyzed errors via
// bounded retries (mirroring the waveform blob), instead of settling into a
// permanent error state that only a track re-load could clear.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBeatgridData, BEATGRID_RETRY } from './useBeatgridData';
import type { BeatgridResponse } from '../types';

vi.mock('../api/client', () => ({
  api: { beatgrids: { get: vi.fn() } },
}));
import { api } from '../api/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function beatgridResponse(trackId: number): BeatgridResponse {
  return {
    id: trackId,
    track_id: trackId,
    data: { tempo_changes: [], beat_times: [0, 0.5, 1], downbeat_times: [] },
    origin: 'analyzed',
    anchor_time: null,
  } as unknown as BeatgridResponse;
}

function renderBeatgrid(trackId: number, queryClient: QueryClient) {
  const result = { current: null as unknown as ReturnType<typeof useBeatgridData> };
  function Probe() {
    const value = useBeatgridData(trackId);
    useEffect(() => {
      result.current = value;
    });
    return null;
  }
  const container = document.createElement('div');
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  return { result, unmount: () => act(() => root!.unmount()) };
}

/**
 * Drive react-query's retry state machine to quiescence: each attempt resolves
 * a microtask, then the next retry is armed behind a backoff timer. Alternate
 * flushing microtasks and advancing fake timers until the query settles.
 */
async function settle(queryClient: QueryClient) {
  for (let i = 0; i < 50; i++) {
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10000);
    });
    if (!queryClient.isFetching()) break;
  }
}

describe('useBeatgridData retry policy (deck-asset-refresh 01)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.beatgrids.get).mockReset();
  });

  it('rides out background-analysis errors and lands the grid once written', async () => {
    // The load-time reality: the endpoint errors until the analysis task
    // writes the grid, then succeeds — the beatgrid must survive the wait.
    const queryClient = new QueryClient();
    vi.mocked(api.beatgrids.get)
      .mockRejectedValueOnce(new Error('Failed to fetch beatgrid: Not Found'))
      .mockRejectedValueOnce(new Error('Failed to fetch beatgrid: Not Found'))
      .mockResolvedValue(beatgridResponse(1007));

    const { result, unmount } = renderBeatgrid(1007, queryClient);
    await settle(queryClient);

    expect(result.current.data).toEqual(beatgridResponse(1007));
    expect(result.current.error).toBeNull();
    // Two failures + one success — retried, did not give up on the first 404.
    expect(vi.mocked(api.beatgrids.get)).toHaveBeenCalledTimes(3);

    unmount();
    queryClient.clear();
  });

  it('gives up on a genuinely gridless track (bounded, does not retry forever)', async () => {
    const queryClient = new QueryClient();
    vi.mocked(api.beatgrids.get).mockRejectedValue(
      new Error('Failed to fetch beatgrid: Not Found')
    );

    const { result, unmount } = renderBeatgrid(9999, queryClient);
    await settle(queryClient);

    expect(result.current.error).toBeInstanceOf(Error);
    // Initial attempt + BEATGRID_RETRY retries, then it settles — no infinite loop.
    expect(vi.mocked(api.beatgrids.get)).toHaveBeenCalledTimes(BEATGRID_RETRY + 1);

    unmount();
    queryClient.clear();
  });
});
