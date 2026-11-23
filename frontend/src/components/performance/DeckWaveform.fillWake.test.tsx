// @vitest-environment jsdom
/** Real DeckWaveform underlay effect, with GL/audio and unrelated controls absent. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckWaveform } from './DeckPanel';

const fixture = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const snapshot = { playing: false, pendingPlay: false, previewing: false,
    hotCuePreviewSlot: null, scratching: false, cuePoint: 0, loop: null,
    pitchPercent: 0, duration: 300, stemsLoaded: false };
  const channel = { trim: .5, eq: { low: .5, mid: .5, high: .5 }, fader: 1, filter: 0, stems: { vocals: true, drums: true, bass: true, other: true } };
  const engine = {
    position: 0,
    getSnapshot: () => snapshot,
    getPlayhead: () => engine.position,
    getHeardDisplayPlayhead: () => engine.position,
    getSlipReturnPlayhead: () => null,
    addTransportEventListener: (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  const deck = { deck: 'A', engine, loadedTrack: { id: 1 }, beatjump: {} };
  const mixer = { getChannelState: () => channel, getAutomation: () => null,
    getFilterSettings: () => ({ mode: 'off' }) };
  return { listeners, snapshot, channel, engine, deck, mixer, active: true };
});
vi.mock('../../hooks/useDeck', () => ({
  useDeck: () => fixture.deck, useDeckReady: () => true,
  useDeckSnapshot: (selector: (s: typeof fixture.snapshot) => unknown) => selector(fixture.snapshot),
  useBeatjumpBeats: () => 4,
}));
vi.mock('../../hooks/useMixer', () => ({ useMixer: () => fixture.mixer,
  useMixerValue: (selector: (m: typeof fixture.mixer) => unknown) => selector(fixture.mixer),
  useAutomationGhost: () => null }));
vi.mock('../../contexts/viewActive', () => ({ useViewActive: () => fixture.active }));
vi.mock('../../performance/useHeardWaveformClock', () => ({ useHeardWaveformClock: () => fixture.engine }));
vi.mock('../../performance/controlFocus', () => ({ useControlFocus: () => ({ left: 'A', right: 'B' }) }));
vi.mock('../../hooks/useScrubTransport', () => ({ useScrubTransport: () => ({}) }));
vi.mock('../../waveform/useStemWaveform', () => ({ useStemWaveforms: () => null }));
vi.mock('../../selection/deckDrop', () => ({ useDeckDropTarget: () => ({ dropState: null, dropHandlers: {} }) }));
vi.mock('../WebGLWaveform', () => ({ default: () => null }));
vi.mock('../../performance/DeckActionTrail', () => ({ DeckActionTrail: () => null,
  playbackVisualState: () => 'paused' }));
vi.mock('../../performance/OutputDelayCue', () => ({ OutputDelayCue: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let clear: ReturnType<typeof vi.fn>;
function render() { act(() => root.render(<DeckWaveform visibleSeconds={8} onVisibleSecondsChange={() => {}} />)); }
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function jump(position: number) {
  // Real engine fires the transport gesture before its synchronous dispatch.
  act(() => { fixture.listeners.forEach(cb => cb()); fixture.engine.position = position; });
}
beforeEach(() => {
  vi.useFakeTimers();
  fixture.listeners.clear(); fixture.active = true; fixture.engine.position = 0;
  clear = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: clear,
    fillRect: vi.fn(), fillStyle: '' } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  render();
  const canvas = container.querySelector('canvas')!;
  Object.defineProperties(canvas, { clientWidth: { value: 400 }, clientHeight: { value: 100 } });
  advance(64); // first draw + unchanged frame, then idle
  clear.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('paused waveform fader underlay transport wake', () => {
  it('repaints a parked underlay on the next frame for every sparse seek/jump', () => {
    for (const position of [16, 32, 48]) {
      jump(position);
      advance(16);
      expect(clear).toHaveBeenCalledTimes(1);
      advance(64); // no continuous drawing after it settles
      expect(clear).toHaveBeenCalledTimes(1);
      clear.mockClear();
    }
  });
  it('coalesces a burst and removes its wake/timers when hidden or unmounted', () => {
    jump(16); jump(32); jump(48); advance(16);
    expect(clear).toHaveBeenCalledTimes(1);
    fixture.active = false; render();
    expect(fixture.listeners.size).toBe(0);
    clear.mockClear(); jump(64); advance(1000);
    expect(clear).not.toHaveBeenCalled();
    fixture.active = true; render(); advance(32);
    expect(clear).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(fixture.listeners.size).toBe(0);
    clear.mockClear(); jump(80); advance(1000);
    expect(clear).not.toHaveBeenCalled();
  });
});
