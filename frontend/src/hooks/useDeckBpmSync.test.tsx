// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeckBpmSync } from './useDeckBpmSync';
import { DeckEngine } from '../playback/DeckEngine';
import { _clearBufferCacheForTests, putCachedBuffer } from '../playback/bufferCache';
import type { DeckAudioPort } from '../playback/mixer';
import type { Track } from '../types';

vi.mock('../api/client', () => ({
  api: { tracks: { getById: vi.fn() } },
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

function trackRow(id: number, bpm: number): Track {
  return { id, bpm } as unknown as Track;
}

async function loadedEngine(trackId: number, bpm: number) {
  putCachedBuffer(trackId, fakeBuffer);
  const engine = new DeckEngine(unusedPort);
  await engine.load({ trackId, audioUrl: 'http://127.0.0.1:1/none', bpm });
  return engine;
}

function renderSync(engine: DeckEngine, trackId: number, queryClient: QueryClient) {
  function Probe() {
    useDeckBpmSync(engine, trackId);
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

describe('useDeckBpmSync (cue-quantize-bpm 02)', () => {
  afterEach(() => {
    _clearBufferCacheForTests();
    vi.mocked(api.tracks.getById).mockReset();
  });

  it('a track refetch after invalidation re-arms beat-jump math with the new tempo', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const engine = await loadedEngine(5, 120);
    queryClient.setQueryData(['track', 5], trackRow(5, 120));

    const { unmount } = renderSync(engine, 5, queryClient);

    // A BPM edit landed somewhere (analysis, sync import, another deck's
    // control) — the path invalidates ['track', id]; the refetch serves
    // the new tempo and the sync pushes it into the engine.
    vi.mocked(api.tracks.getById).mockResolvedValue(trackRow(5, 240));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['track', 5] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(engine.getSnapshot().bpm).toBe(240);
    engine.seek(10);
    engine.jumpBeats(4); // 4 beats at 240 = 1s
    expect(engine.getPlayhead()).toBeCloseTo(11);
    unmount();
    queryClient.clear();
  });

  it('pushes a warm cached tempo into a freshly mounted deck scope', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Engine loaded with a stale snapshot bpm; cache already holds fresher.
    const engine = await loadedEngine(6, 87);
    queryClient.setQueryData(['track', 6], trackRow(6, 174));

    const { unmount } = renderSync(engine, 6, queryClient);
    await act(async () => {});

    expect(engine.getSnapshot().bpm).toBe(174);
    unmount();
    queryClient.clear();
  });
});
