// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ARRIVAL_POLL_MS,
  gridArrivalPollMs,
  useDeckBeatgridSync,
} from './useDeckBeatgridSync';
import { DeckEngine } from '../playback/DeckEngine';
import { _clearBufferCacheForTests, putCachedBuffer } from '../playback/bufferCache';
import type { DeckAudioPort } from '../playback/mixer';
import type { BeatgridResponse } from '../types';

vi.mock('../api/client', () => ({
  api: { beatgrids: { get: vi.fn() }, analyze: { getGrid: vi.fn() } },
}));
import { api } from '../api/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const unusedPort: DeckAudioPort = {
  ensureAudio: () => {
    throw new Error('audio must not be touched in these tests');
  },
};

const fakeBuffer = {
  duration: 180,
  sampleRate: 44100,
  numberOfChannels: 1,
  getChannelData: () => new Float32Array(44100),
} as unknown as AudioBuffer;

/** A 120 BPM grid from 0s: beats every 0.5s. */
const grid120 = Array.from({ length: 360 }, (_, i) => i * 0.5);
/** The same track re-tempo'd to 240 BPM: beats every 0.25s. */
const grid240 = Array.from({ length: 720 }, (_, i) => i * 0.25);

function beatgridResponse(
  trackId: number,
  beatTimes: number[],
  origin: BeatgridResponse['origin'] = 'edited'
): BeatgridResponse {
  return {
    id: origin === 'generated' ? null : trackId,
    track_id: trackId,
    data: {
      tempo_changes: [],
      beat_times: beatTimes,
      downbeat_times: [],
    },
    origin,
    anchor_time: null,
    created_at: null,
    updated_at: null,
  } as unknown as BeatgridResponse;
}

async function loadedEngine(trackId: number, grid: number[]) {
  putCachedBuffer(trackId, fakeBuffer);
  const engine = new DeckEngine(unusedPort);
  await engine.load({
    trackId,
    audioUrl: 'http://127.0.0.1:1/none',
    bpm: 120,
    beatTimes: Promise.resolve(grid),
  });
  return engine;
}

function renderSync(engine: DeckEngine, trackId: number, queryClient: QueryClient) {
  function Probe() {
    useDeckBeatgridSync(engine, trackId);
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
  return { unmount: () => act(() => root.unmount()) };
}

/** Quantized cue placement at 10.35s: 10.25 on the 240 grid, 10.5 on 120. */
function placeCue(engine: DeckEngine): number | null {
  engine.seek(10.35);
  engine.cueDown();
  return engine.getSnapshot().cuePoint;
}

describe('useDeckBeatgridSync (cue-quantize-bpm 01)', () => {
  afterEach(() => {
    _clearBufferCacheForTests();
    vi.mocked(api.beatgrids.get).mockReset();
    vi.mocked(api.analyze.getGrid).mockReset();
  });

  it('a beatgrid refetch after invalidation re-arms Quantize with the new grid', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // The load-time state: engine and query cache both hold the 120 grid.
    const engine = await loadedEngine(5, grid120);
    queryClient.setQueryData(['beatgrid', 5], beatgridResponse(5, grid120));

    const { unmount } = renderSync(engine, 5, queryClient);

    // The BPM re-tempo landed server-side; the commit path invalidates
    // ['beatgrid', id] and the refetch serves the re-spaced grid.
    vi.mocked(api.beatgrids.get).mockResolvedValue(beatgridResponse(5, grid240));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['beatgrid', 5] });
      // react-query notifies observers on a macrotask — flush it so the
      // sync effect runs before we gesture.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(placeCue(engine)).toBeCloseTo(10.25, 10);
    unmount();
    queryClient.clear();
  });

  it('pushes a warm cached grid into a freshly mounted deck scope', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Engine loaded gridless (grid fetch failed); cache has the grid.
    const engine = await loadedEngine(6, []);
    queryClient.setQueryData(['beatgrid', 6], beatgridResponse(6, grid240));

    const { unmount } = renderSync(engine, 6, queryClient);
    await act(async () => {});

    expect(engine.getSnapshot().hasBeatgrid).toBe(true);
    expect(placeCue(engine)).toBeCloseTo(10.25, 10);
    unmount();
    queryClient.clear();
  });

  it('an analyzed grid replacing a placeholder re-parks the untouched cue (ADR 0029 §2/§3)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Fresh-import shape: loaded gridless, cache holds the BPM placeholder
    // (first beat 0 — the parked default doesn't visibly move).
    const engine = await loadedEngine(7, []);
    queryClient.setQueryData(['beatgrid', 7], beatgridResponse(7, grid120, 'generated'));
    vi.mocked(api.analyze.getGrid).mockResolvedValue({ track_id: 7, bailed: false });

    const { unmount } = renderSync(engine, 7, queryClient);
    await act(async () => {});
    expect(engine.getSnapshot().cuePoint).toBe(0);

    // Background analysis lands: the arrival poll's refetch (here forced by
    // an invalidation — the poll and the invalidation share the refetch
    // path) serves the analyzed grid, whose first beat is off zero.
    const analyzed = grid120.map((t) => t + 0.75);
    vi.mocked(api.beatgrids.get).mockResolvedValue(
      beatgridResponse(7, analyzed, 'analyzed')
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['beatgrid', 7] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(engine.getSnapshot().hasBeatgrid).toBe(true);
    expect(engine.getSnapshot().cuePoint).toBeCloseTo(0.75, 10);
    expect(engine.getPlayhead()).toBeCloseTo(0.75, 10);
    unmount();
    queryClient.clear();
  });
});

describe('gridArrivalPollMs (ADR 0029 §3)', () => {
  it('polls while the grid is missing', () => {
    expect(gridArrivalPollMs(undefined, false)).toBe(ARRIVAL_POLL_MS);
  });

  it('polls while only a placeholder exists', () => {
    expect(gridArrivalPollMs(beatgridResponse(1, grid120, 'generated'), false)).toBe(
      ARRIVAL_POLL_MS
    );
  });

  it('stops once a saved-origin grid arrives', () => {
    for (const origin of ['analyzed', 'edited', 'imported'] as const) {
      expect(gridArrivalPollMs(beatgridResponse(1, grid120, origin), false)).toBe(false);
    }
  });

  it('stops when analysis bailed (Needs-attention owns those)', () => {
    expect(gridArrivalPollMs(undefined, true)).toBe(false);
    expect(gridArrivalPollMs(beatgridResponse(1, grid120, 'generated'), true)).toBe(false);
  });
});
