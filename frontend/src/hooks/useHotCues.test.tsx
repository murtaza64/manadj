// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSetHotCue } from './useHotCues';
import type { HotCue } from '../types';

vi.mock('../api/client', () => ({
  api: { hotcues: { set: vi.fn(() => new Promise(() => {})) } },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function renderMutation(queryClient: QueryClient) {
  const result = { current: null as unknown as ReturnType<typeof useSetHotCue> };
  function Probe() {
    const mutation = useSetHotCue();
    useEffect(() => { result.current = mutation; });
    return null;
  }
  const container = document.createElement('div');
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>
    );
  });
  cleanup.push(() => act(() => root.unmount()));
  return result;
}

describe('useSetHotCue optimistic defaults', () => {
  it('shows a new cue in its slot color before the endpoint settles', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<HotCue[]>(['hotcues', 12], []);
    const mutation = renderMutation(queryClient);

    await act(async () => {
      mutation.current.mutate({ trackId: 12, slotNumber: 6, data: { time_seconds: 48 } });
      await Promise.resolve();
    });

    expect(queryClient.getQueryData<HotCue[]>(['hotcues', 12])?.[0]).toMatchObject({
      slot_number: 6,
      time_seconds: 48,
      color: '#ff5cc8',
      label: null,
    });
    queryClient.clear();
  });
});
