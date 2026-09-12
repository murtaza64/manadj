// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { SessionTimelineView } from './SessionTimelineView';
import { getTimelineViewState, patchTimelineViewState } from './timelineViewState';

vi.mock('../hooks/useDeck', () => ({ useDecks: () => ({ A: {}, B: {}, C: {}, D: {} }) }));
vi.mock('../hooks/useMixer', () => ({ useMixer: () => ({}) }));
vi.mock('../components/Toast', () => ({ useToast: () => vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('pinch overrides a pan latch, zooms faster than wheel and retains the cursor time', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const session = { uuid: 'zoom-test', started_at: '2026-09-12T12:00:00', ended_at: '2026-09-12T13:00:00', take_count: 0 };
  patchTimelineViewState(session.uuid, { pxPerSec: 10, collapseIdle: false });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['session', session.uuid], { ...session, events: [
    { t: 0, kind: 'tick', playheads: {} }, { t: 300, kind: 'tick', playheads: {} },
  ] });
  for (const key of [['takes'], ['routine-takes'], ['routines'], ['routine-candidates', session.uuid]]) client.setQueryData(key, []);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><SessionTimelineView session={session} /></QueryClientProvider>));
    const el = host.querySelector('.stl-scroll') as HTMLDivElement;
    const wheel = (deltaX: number, deltaY: number, ctrlKey = false) => {
      act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, ctrlKey,
        clientX: 500, bubbles: true, cancelable: true })));
      act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(performance.now())); });
    };
    wheel(20, 0);
    expect(el.scrollLeft).toBe(20);
    const cursorT = (el.scrollLeft + 500) / 10;
    wheel(0, -20, true);
    const pinchScale = getTimelineViewState(session.uuid)!.pxPerSec!;
    expect(pinchScale).toBeCloseTo(10 * Math.exp(0.2));
    expect((el.scrollLeft + 500) / pinchScale).toBeCloseTo(cursorT, 1);
    wheel(0, -20);
    const wheelScale = getTimelineViewState(session.uuid)!.pxPerSec!;
    expect(wheelScale / pinchScale).toBeCloseTo(Math.exp(0.03));
  } finally {
    act(() => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
