// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { freshDeck } from '../capture/audibilityReducer';
import { useDeckPlaybackLevels } from './useDeckPlaybackLevels';

const live = vi.hoisted(() => ({
  running: true, stemsLoaded: false, master: 0.5, crossfader: 0,
  auto: false, autoFader: 1,
  notify: () => {},
}));
const channel = freshDeck('left');
vi.mock('./useDeck', () => ({
  useDecks: () => Object.fromEntries(['A', 'B', 'C', 'D'].map((ch) => [ch, {
    engine: {
      subscribe: () => () => {},
      isAudioRunning: () => ch === 'A' && live.running,
      getSnapshot: () => ({ stemsLoaded: live.stemsLoaded }),
    },
  }])),
}));
vi.mock('./useMixer', () => ({
  useMixer: () => ({
    subscribe: (fn: () => void) => { live.notify = fn; return () => {}; },
    getChannelState: () => channel,
    getAutomation: () => live.auto ? { fader: live.autoFader } : null,
    isAutomationEngaged: () => live.auto,
    getCrossfader: () => live.crossfader,
    getCrossfaderEnabled: () => true,
    getCrossfaderAssignment: () => 'left',
    getMaster: () => live.master,
  }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

it('tracks mixer kills, master mute, engine stops, stems, and unnotified automation', () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  function Probe() { return <span>{useDeckPlaybackLevels().A}</span>; }
  act(() => root.render(<Probe />));
  const update = (fn: () => void) => act(() => { fn(); live.notify(); });
  expect(container.textContent).toBe('100');
  update(() => { channel.fader = 0.5; });
  expect(container.textContent).toBe('50');
  update(() => { channel.fader = 0.1; });
  // Below capture's audibility threshold, but still a nonzero color blend.
  expect(container.textContent).toBe('10');
  update(() => { channel.fader = 0; });
  expect(container.textContent).toBe('0');
  update(() => { channel.fader = 1; live.master = 0; });
  expect(container.textContent).toBe('0');
  update(() => { live.master = 0.5; live.crossfader = 1; });
  expect(container.textContent).toBe('0');
  // Automation owns the strip and pins the crossfader neutral, without notifying.
  act(() => { live.auto = true; vi.advanceTimersByTime(100); });
  expect(container.textContent).toBe('100');
  act(() => { live.autoFader = 0.5; vi.advanceTimersByTime(100); });
  expect(container.textContent).toBe('50');
  act(() => { live.autoFader = 0; vi.advanceTimersByTime(100); });
  expect(container.textContent).toBe('0');
  update(() => { live.auto = false; live.crossfader = 0; channel.filter = 1; });
  expect(container.textContent).toBe('0');
  update(() => { channel.filter = 0; channel.eq = { low: 0, mid: 0, high: 0 }; });
  expect(container.textContent).toBe('0');
  update(() => {
    channel.eq = { low: 0.5, mid: 0.5, high: 0.5 };
    channel.stems = { vocals: false, bass: false, drums: false, other: false };
    live.stemsLoaded = true;
  });
  expect(container.textContent).toBe('0');
  update(() => { live.stemsLoaded = false; });
  expect(container.textContent).toBe('100');
  update(() => { live.running = false; });
  expect(container.textContent).toBe('0');
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});
