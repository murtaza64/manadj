// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckContext, DeckRegistryContext, useDeck, useDecks, type DeckContextValue } from '../../hooks/useDeck';
import { CHANNEL_IDS, type ChannelId } from '../../playback/mixer';
import { _resetControlFocusForTests, focusDeck } from '../../performance/controlFocus';
import { setPerfSectionShown } from '../../performance/perfSectionsStore';
import { PerformanceView } from './PerformanceView';
import { getMouseJogSettings, resetMouseJogSettings, setMouseJogSettings, setMouseJogSpeed, useMouseJogSpeed } from './mouseJogSettings';

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  });
});

const probes = vi.hoisted(() => ({ panels: vi.fn(), keysUnmount: vi.fn() }));
vi.mock('../../contexts/DeckContext', () => ({
  DeckScope: ({ deck, children }: { deck: ChannelId; children: ReactNode }) =>
    <DeckContext value={useDecks()[deck]}>{children}</DeckContext>,
}));
vi.mock('./DeckPanel', () => ({
  DeckPanel: () => { probes.panels(); return <div data-panel={useDeck().deck} />; },
  DeckWaveform: () => null,
}));
vi.mock('./DeckKeys', () => ({
  DeckKeys: () => {
    useEffect(() => () => { probes.keysUnmount(); }, []);
    return <span data-key-deck={useDeck().deck} />;
  },
}));
vi.mock('./MixerStrip', () => ({
  MixerStrip: ({ onDeckCountChange }: { onDeckCountChange: (count: 2 | 4) => void }) =>
    <div className="stub-mixer"><button onClick={() => onDeckCountChange(2)}>2 DECKS</button></div>,
}));
vi.mock('../../links/PerformancePairLinks', () => ({ EdgePairLinks: () => null }));
vi.mock('../../performance/PlayGuideOverlay', () => ({ PlayGuideOverlay: () => null }));
vi.mock('../../performance/useMidiCursorSuppression', () => ({ useMidiCursorSuppression: () => {} }));
vi.mock('../../sets/spaceTransport', () => ({ dispatchSetSpace: () => {} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let decks: Record<ChannelId, DeckContextValue>;
let bends: Record<ChannelId, number>;
let listeners: Record<ChannelId, Set<() => void>>;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  localStorage.clear();
  _resetControlFocusForTests();
  resetMouseJogSettings();
  setPerfSectionShown('decks', true);
  setPerfSectionShown('waveforms', true);
  CHANNEL_IDS.forEach((deck) => setMouseJogSpeed(deck, 0));
  bends = { A: 0.75, B: -0.5, C: 2, D: -3 };
  listeners = { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
  decks = Object.fromEntries(CHANNEL_IDS.map((deck) => [deck, {
    deck, loadedTrack: null, loadTrack: vi.fn(),
    engine: {
      getSnapshot: () => ({ bendPercent: bends[deck], playing: true }),
      subscribe: (listener: () => void) => {
        listeners[deck].add(listener);
        return () => { listeners[deck].delete(listener); };
      },
      pause: vi.fn(), dispose: vi.fn(),
    },
  }])) as unknown as Record<ChannelId, DeckContextValue>;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(children: ReactNode = <PerformanceView />) {
  act(() => root.render(<DeckRegistryContext value={decks}>{children}</DeckRegistryContext>));
}

function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === text)!;
  expect(button).toBeDefined();
  act(() => button.click());
}

function readout(label: string) {
  return container.querySelector(`output[aria-label="${label}"]`)?.textContent;
}

describe('mouse jog tuner', () => {
  it('starts closed without engine subscriptions and opens outside hideable decks', () => {
    render();
    expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(Object.values(listeners).every((set) => set.size === 0)).toBe(true);
    act(() => setPerfSectionShown('decks', false));
    click('MOUSE / JOG TUNE');
    expect(container.querySelector('.mouse-jog-tuner')?.closest('.perf-decks')).toBeNull();
    expect(container.querySelector('.stub-mixer')?.nextElementSibling?.className).toBe('mouse-jog-tuner');
    expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(3);
    expect(container.querySelectorAll('input:not([type="range"])')).toHaveLength(0);
    expect(container.textContent).toContain('Playback keeps going until you drag.');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('applies native ranges live, formats values and previews, and resets without remounting controllers', () => {
    render();
    click('MOUSE / JOG TUNE');
    const panels = [...container.querySelectorAll('[data-panel]')];
    const renderCount = probes.panels.mock.calls.length;
    const ranges = [...container.querySelectorAll<HTMLInputElement>('input')];
    expect(ranges.map((input) => [input.min, input.max, input.step])).toEqual([
      ['0.25', '12', '0.25'], ['1', '3', '0.1'], ['0', '200', '5'],
    ]);
    for (const [index, value] of ['12', '2.5', '200'].entries()) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(ranges[index], value);
        ranges[index].dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(getMouseJogSettings()).toEqual({ sensitivity: 12, acceleration: 2.5, smoothingMs: 200 });
    expect(container.textContent).toContain('12.00x');
    expect(container.textContent).toContain('500 px/s');
    expect(container.textContent).toContain('600 px/s: 8.00%');
    act(() => setMouseJogSettings({ sensitivity: 6 }));
    expect(ranges[0].value).toBe('6');
    click('Reset baseline');
    expect(ranges.map((input) => input.value)).toEqual(['1', '1.5', '50']);
    expect(container.textContent).toContain('6000 px/s');
    expect(probes.panels).toHaveBeenCalledTimes(renderCount);
    click('MOUSE / JOG TUNE');
    expect([...container.querySelectorAll('[data-panel]')]).toEqual(panels);
    expect(probes.keysUnmount).not.toHaveBeenCalled();
    for (const deck of Object.values(decks)) {
      expect(deck.engine.pause).not.toHaveBeenCalled();
      expect(deck.engine.dispose).not.toHaveBeenCalled();
    }
  });

  it('reads actual engine bend and live speed only for focused decks, pinned to A/B in two-deck mode', () => {
    render();
    click('MOUSE / JOG TUNE');
    expect(readout('Deck A actual bend')).toBe('+0.75%');
    expect(readout('Deck B actual bend')).toBe('-0.50%');
    const renderCount = probes.panels.mock.calls.length;
    act(() => {
      setMouseJogSpeed('A', 321);
      bends.A = 1.23;
      for (const listener of listeners.A) listener();
    });
    expect(readout('Deck A rim speed')).toBe('321 px/s');
    expect(readout('Deck A actual bend')).toBe('+1.23%');
    expect(probes.panels).toHaveBeenCalledTimes(renderCount);
    act(() => { focusDeck('C'); focusDeck('D'); setMouseJogSpeed('D', -600); });
    expect(readout('Deck A rim speed')).toBeUndefined();
    expect(readout('Deck C actual bend')).toBe('+2.00%');
    expect(readout('Deck D rim speed')).toBe('-600 px/s');
    expect(listeners.A.size).toBe(0);
    expect(listeners.B.size).toBe(0);
    click('2 DECKS');
    expect(readout('Deck A rim speed')).toBe('321 px/s');
    expect(readout('Deck B actual bend')).toBe('-0.50%');
    expect(readout('Deck C actual bend')).toBeUndefined();
    expect(listeners.C.size).toBe(0);
    expect(listeners.D.size).toBe(0);
    click('MOUSE / JOG TUNE');
    expect(Object.values(listeners).every((set) => set.size === 0)).toBe(true);
  });

  it('deduplicates nonpersisted telemetry per deck, clears zero, and does not clear it on UI close', () => {
    const renders = vi.fn();
    function Speed() {
      const speed = useMouseJogSpeed('A');
      renders(speed);
      return null;
    }
    render(<><PerformanceView /><Speed /></>);
    vi.mocked(fetch).mockClear();
    act(() => setMouseJogSpeed('A', 500));
    const count = renders.mock.calls.length;
    act(() => { setMouseJogSpeed('A', 500); setMouseJogSpeed('B', 200); });
    expect(renders).toHaveBeenCalledTimes(count);
    click('MOUSE / JOG TUNE');
    expect(readout('Deck A rim speed')).toBe('500 px/s');
    click('MOUSE / JOG TUNE');
    click('MOUSE / JOG TUNE');
    expect(readout('Deck A rim speed')).toBe('500 px/s');
    act(() => setMouseJogSpeed('A', 0));
    expect(readout('Deck A rim speed')).toBe('0 px/s');
    act(() => { setMouseJogSpeed('A', 500); });
    act(() => { setMouseJogSpeed('A', NaN); });
    expect(readout('Deck A rim speed')).toBe('0 px/s');
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('manadj-mouse-jog')).toBeNull();
  });
});
