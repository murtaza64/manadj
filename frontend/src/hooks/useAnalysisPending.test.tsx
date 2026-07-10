// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ANALYSIS_PENDING_ACTIVE_POLL_MS,
  ANALYSIS_PENDING_IDLE_POLL_MS,
  analysisPendingPollMs,
  useAnalysisPendingSync,
  useTrackAnalysisPending,
} from './useAnalysisPending';
import type { AnalysisPendingItem } from '../types';

vi.mock('../api/client', () => ({
  api: { analyze: { pending: vi.fn() } },
}));
import { api } from '../api/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendingItem(trackId: number): AnalysisPendingItem {
  return { track_id: trackId, state: 'pending', manual: false };
}

function render(node: React.ReactElement, queryClient: QueryClient) {
  const container = document.createElement('div');
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    );
  });
  return { unmount: () => act(() => root.unmount()) };
}

/** react-query notifies observers on scheduled macrotasks whose timing
 * varies under parallel suite load — flush ticks until the condition
 * holds (bounded), keeping the test deterministic. */
async function flushUntil(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(check()).toBe(true);
}

describe('analysisPendingPollMs', () => {
  it('polls fast while analyses are in flight, slow when idle', () => {
    expect(analysisPendingPollMs(undefined)).toBe(ANALYSIS_PENDING_IDLE_POLL_MS);
    expect(analysisPendingPollMs([])).toBe(ANALYSIS_PENDING_IDLE_POLL_MS);
    expect(analysisPendingPollMs([pendingItem(1)])).toBe(
      ANALYSIS_PENDING_ACTIVE_POLL_MS
    );
  });
});

describe('useAnalysisPendingSync (analysis-curation 03)', () => {
  afterEach(() => vi.mocked(api.analyze.pending).mockReset());

  function SyncProbe() {
    useAnalysisPendingSync();
    return null;
  }

  it('a track leaving the pending set invalidates its row and per-track caches', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(api.analyze.pending).mockResolvedValue([
      pendingItem(1),
      pendingItem(2),
    ]);

    const { unmount } = render(<SyncProbe />, queryClient);
    // Wait for the first pending set to land (data + effect) before the
    // completion poll.
    await flushUntil(
      () => queryClient.getQueryData(['analysis-pending']) !== undefined
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invalidate).not.toHaveBeenCalled();

    // Track 1's analysis finished; the next poll (here: a forced refetch)
    // no longer lists it.
    vi.mocked(api.analyze.pending).mockResolvedValue([pendingItem(2)]);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['analysis-pending'] });
    });
    const keys = () => invalidate.mock.calls.map((c) => c[0]?.queryKey);
    await flushUntil(() =>
      keys().some((k) => JSON.stringify(k) === JSON.stringify(['tracks']))
    );

    expect(keys()).toContainEqual(['tracks']);
    expect(keys()).toContainEqual(['track', 1]);
    expect(keys()).toContainEqual(['beatgrid', 1]);
    expect(keys()).toContainEqual(['grid-analysis', 1]);
    expect(keys()).not.toContainEqual(['track', 2]);
    unmount();
    queryClient.clear();
  });

  it('an empty first response invalidates nothing', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(api.analyze.pending).mockResolvedValue([]);

    const { unmount } = render(<SyncProbe />, queryClient);
    await act(async () => {});
    expect(invalidate).not.toHaveBeenCalled();
    unmount();
    queryClient.clear();
  });
});

describe('useTrackAnalysisPending', () => {
  afterEach(() => vi.mocked(api.analyze.pending).mockReset());

  it('reports membership of the pending set', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(api.analyze.pending).mockResolvedValue([pendingItem(5)]);
    const seen: Record<string, boolean> = {};

    function Probe({ trackId, label }: { trackId: number | null; label: string }) {
      seen[label] = useTrackAnalysisPending(trackId);
      return null;
    }
    const { unmount } = render(
      <>
        <Probe trackId={5} label="pending" />
        <Probe trackId={6} label="other" />
        <Probe trackId={null} label="none" />
      </>,
      queryClient
    );
    await flushUntil(() => seen.pending === true);

    expect(seen).toEqual({ pending: true, other: false, none: false });
    unmount();
    queryClient.clear();
  });
});
