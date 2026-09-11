// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckContext, DeckRegistryContext, useDeck, useDecks, type DeckContextValue } from '../../hooks/useDeck';
import { MixerContext } from '../../hooks/useMixer';
import { ViewActiveContext } from '../../contexts/viewActive';
import { BrowseActiveContext } from '../../contexts/browseActive';
import { useMidiCursorSuppression } from '../../performance/useMidiCursorSuppression';
import { dispatchSetSpace } from '../../sets/spaceTransport';
import { CHANNEL_IDS, type Mixer, type ChannelId } from '../../playback/mixer';
import { _resetControlFocusForTests, focusDeck, getControlFocus, useControlFocus } from '../../performance/controlFocus';
import { setPerfSectionShown } from '../../performance/perfSectionsStore';
import { browseHostFor, sharedBrowseHandle } from '../browseHost';
import { PERSISTED_SETTING_KEYS } from '../../settings/persistedSettings';
import type { PlayGuideFrame } from '../../performance/playGuideModel';
import type { Track } from '../../types';
import { PerformanceView } from './PerformanceView';
import { HFader, Knob } from './MixerStrip';

const css = readFileSync('src/components/performance/PerformanceView.css', 'utf8');

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
});

// Keep the actual layout, focus store, browse policy, mixer controls and
// overlays. Substitute the audio provider and heavyweight deck rendering.
vi.mock('../../contexts/DeckContext', () => ({
  DeckScope: ({ deck, children }: { deck: ChannelId; children: ReactNode }) =>
    <DeckContext value={useDecks()[deck]}>{children}</DeckContext>,
}));
vi.mock('./DeckPanel', () => ({
  DeckPanel: () => {
    const { deck } = useDeck();
    const focus = useControlFocus();
    return <div data-deck={deck} className={`perf-deckpanel deck-${deck.toLowerCase()}${Object.values(focus).includes(deck) ? ' focused' : ''}`} />;
  },
  DeckWaveform: ({ visibleSeconds, onVisibleSecondsChange }: {
    visibleSeconds: number; onVisibleSecondsChange: (seconds: number) => void;
  }) => {
    const { deck } = useDeck();
    const focus = useControlFocus();
    return <div data-deck={deck} className={`perf-wave-row deck-${deck.toLowerCase()}${Object.values(focus).includes(deck) ? ' focused' : ''}`}>
      <button data-zoom={visibleSeconds} onClick={() => onVisibleSecondsChange(17)}>Zoom</button>
    </div>;
  },
}));
vi.mock('./DeckKeys', () => ({
  DeckKeys: () => <span data-key-deck={useDeck().deck} />,
}));
vi.mock('../../performance/useMidiCursorSuppression', () => ({ useMidiCursorSuppression: vi.fn() }));
vi.mock('../../hooks/useTakeoverHint', () => ({ useTakeoverHint: () => null }));
vi.mock('../../editor/transitionIndex', () => ({
  useTransitionIndex: () => ({ from: new Map(), into: new Map() }),
  transitionsFrom: () => new Map(),
}));
vi.mock('../../links/linkStore', () => ({
  useLinks: () => new Map(), isLinked: () => false, setLinked: vi.fn(),
}));
vi.mock('../../sets/spaceTransport', () => ({ dispatchSetSpace: vi.fn() }));
vi.mock('../../performance/usePlayGuides', () => ({ usePlayGuides: () => frames }));

const frames: PlayGuideFrame[] = [
  ['A', 'B'], ['C', 'A'], ['B', 'D'], ['C', 'D'],
].map(([outgoing, incoming]) => ({
  outgoing: outgoing as ChannelId,
  incoming: incoming as ChannelId,
  guides: [{ uuid: `${outgoing}${incoming}`, name: 'Guide', favorite: false, aTime: 10, missed: false, requiredPitchPercent: null }],
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storageKey = 'manadj-perf-deck-count';
let container: HTMLDivElement;
let style: HTMLStyleElement;
let root: Root;
let decks: Record<ChannelId, DeckContextValue>;
let mixer: Mixer;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  localStorage.clear();
  _resetControlFocusForTests();
  setPerfSectionShown('waveforms', true);
  setPerfSectionShown('decks', true);
  decks = Object.fromEntries(CHANNEL_IDS.map((deck, i) => [deck, {
    deck,
    loadedTrack: { id: i + 1, title: deck } as Track,
    loadTrack: vi.fn(),
    engine: {
      getSnapshot: () => ({ playing: deck === 'C', pendingPlay: false, pitchPercent: 0, previewing: false, hotCuePreviewSlot: null }),
      getPlayhead: () => 10,
      isAudioRunning: () => deck === 'C',
      stop: vi.fn(), pause: vi.fn(), unload: vi.fn(), dispose: vi.fn(),
    },
  }])) as unknown as Record<ChannelId, DeckContextValue>;
  mixer = {
    subscribe: () => () => {},
    getCrossfader: () => 0,
    getCrossfaderEnabled: () => true,
    getCueMix: () => 0,
    getCrossfaderAssignment: () => 'thru',
    setCrossfader: vi.fn(), setCrossfaderEnabled: vi.fn(),
    setCrossfaderAssignment: vi.fn(), setCueMix: vi.fn(),
  } as unknown as Mixer;
  style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  style.remove();
  sharedBrowseHandle.current = null;
  vi.unstubAllGlobals();
});

function render(children: ReactNode = <PerformanceView />) {
  act(() => root.render(
    <DeckRegistryContext value={decks}><MixerContext value={mixer}>{children}</MixerContext></DeckRegistryContext>
  ));
}

function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === label)!;
  expect(button).toBeDefined();
  act(() => button.click());
}

function visibleDecks(selector: string) {
  return [...container.querySelectorAll<HTMLElement>(selector)]
    .filter((node) => getComputedStyle(node).display !== 'none')
    .map((node) => node.dataset.deck);
}

function press(key: string) {
  act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}

describe('Performance deck-count layout', () => {
  it('suspends browse keys and cursor suppression in Settings without changing deck focus keys or mounted panels', () => {
    const navigate = vi.fn();
    const selected = vi.fn(() => ({ id: 20 } as Track));
    sharedBrowseHandle.current = { navigate, getSelectedTrack: selected };
    const view = (active: boolean) => <BrowseActiveContext value={active}>
      <PerformanceView />
      {!active && <div className="settings-page"><input type="range" /><input type="checkbox" /><select /></div>}
    </BrowseActiveContext>;
    render(view(true));
    const panels = [...container.querySelectorAll('.perf-deckpanel')];
    const waves = [...container.querySelectorAll('.perf-wave-row')];
    expect(vi.mocked(useMidiCursorSuppression).mock.lastCall?.[1]).toBe(true);
    render(view(false));
    expect(vi.mocked(useMidiCursorSuppression).mock.lastCall?.[1]).toBe(false);
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']) press(key);
    expect(navigate).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    expect(dispatchSetSpace).not.toHaveBeenCalled();
    press('[');
    press(']');
    expect(getControlFocus()).toEqual({ left: 'C', right: 'D' });
    for (const target of container.querySelectorAll('.settings-page input, .settings-page select')) {
      for (const key of [' ', 'Enter', 'ArrowLeft', 'ArrowDown']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        act(() => { target.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(false);
      }
    }
    container.querySelectorAll('.perf-deckpanel').forEach((node, i) => expect(node).toBe(panels[i]));
    container.querySelectorAll('.perf-wave-row').forEach((node, i) => expect(node).toBe(waves[i]));
    render(view(true));
    press('ArrowDown');
    expect(navigate).toHaveBeenCalledWith(1);
    press(' ');
    expect(dispatchSetSpace).toHaveBeenCalledOnce();
    expect(vi.mocked(useMidiCursorSuppression).mock.lastCall?.[1]).toBe(true);
  });

  it('has no mouse jog tuner or disclosure', () => {
    render();
    expect(container.textContent).not.toContain('MOUSE / JOG TUNE');
    expect(container.querySelector('.mouse-jog-tuner')).toBeNull();
    expect(container.querySelector('[aria-label="Sensitivity"]')).toBeNull();
  });

  it('defaults to four, switches display without unmounting decks or mutating transport, and persists', () => {
    render();
    const panels = [...container.querySelectorAll('.perf-deckpanel')];
    const waves = [...container.querySelectorAll('.perf-wave-row')];
    expect(visibleDecks('.perf-wave-row')).toEqual(['C', 'A', 'B', 'D']);
    expect(visibleDecks('.perf-deckpanel')).toEqual(['A', 'B', 'C', 'D']);
    expect(container.querySelectorAll('.perf-xf-assign')).toHaveLength(4);
    expect(container.querySelectorAll('.pairlink-edge')).toHaveLength(4);
    expect(container.querySelectorAll('.pairlink-diag')).toHaveLength(2);
    act(() => { focusDeck('C'); focusDeck('D'); });
    click('2 DECKS');
    expect(visibleDecks('.perf-wave-row')).toEqual(['A', 'B']);
    expect(visibleDecks('.perf-deckpanel')).toEqual(['A', 'B']);
    expect(getComputedStyle(panels[0]).borderTopWidth).toBe(getComputedStyle(panels[1]).borderTopWidth);
    expect(visibleDecks('.perf-deckpanel.focused')).toEqual(['A', 'B']);
    expect(visibleDecks('.perf-wave-row.focused')).toEqual(['A', 'B']);
    expect(container.querySelectorAll('.perf-xf-assign')).toHaveLength(2);
    expect(container.querySelectorAll('.pairlink-edge')).toHaveLength(1);
    expect(container.querySelector<HTMLElement>('.edge-ab')!.style.top).toBe('50%');
    expect(container.querySelectorAll('.pairlink-diag')).toHaveLength(0);
    expect(localStorage.getItem(storageKey)).toBe('2');
    expect(PERSISTED_SETTING_KEYS).toContain(storageKey);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/api/settings/${storageKey}`), expect.objectContaining({ method: 'PUT', body: JSON.stringify({ value: '2' }) }));
    click('4 DECKS');
    container.querySelectorAll('.perf-deckpanel').forEach((node, i) => expect(node).toBe(panels[i]));
    container.querySelectorAll('.perf-wave-row').forEach((node, i) => expect(node).toBe(waves[i]));
    expect(visibleDecks('.perf-wave-row')).toEqual(['C', 'A', 'B', 'D']);
    expect(container.querySelectorAll('.pairlink-edge')).toHaveLength(4);
    expect(container.querySelector<HTMLElement>('.edge-ab')!.style.top).toBe('');
    expect(localStorage.getItem(storageKey)).toBe('4');
    for (const deck of Object.values(decks)) {
      expect(deck.loadTrack).not.toHaveBeenCalled();
      for (const value of Object.values(deck.engine)) {
        if (vi.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
      }
    }
    expect(decks.C.engine.getSnapshot().playing).toBe(true);
    expect(decks.C.loadedTrack!.id).toBe(3);
    for (const value of Object.values(mixer)) {
      if (vi.isMockFunction(value)) expect(value).not.toHaveBeenCalled();
    }
  });

  it('restores two decks on remount, and ignores invalid persisted counts', () => {
    render();
    click('2 DECKS');
    render(null);
    act(() => { focusDeck('C'); focusDeck('D'); });
    render();
    expect(visibleDecks('.perf-wave-row')).toEqual(['A', 'B']);
    expect(getControlFocus()).toEqual({ left: 'A', right: 'B' });
    render(null);
    localStorage.setItem(storageKey, '3');
    render();
    expect(visibleDecks('.perf-wave-row')).toEqual(['C', 'A', 'B', 'D']);
  });

  it('pins keyboard scopes, indicators and all load paths to A/B despite external focus changes', () => {
    localStorage.setItem(storageKey, '2');
    const track = { id: 20 } as Track;
    sharedBrowseHandle.current = { getSelectedTrack: () => track } as NonNullable<typeof sharedBrowseHandle.current>;
    render();
    act(() => { focusDeck('C'); focusDeck('D'); });
    expect(getControlFocus()).toEqual({ left: 'A', right: 'B' });
    expect([...container.querySelectorAll<HTMLElement>('[data-key-deck]')].map((node) => node.dataset.keyDeck)).toEqual(['A', 'B']);
    expect(visibleDecks('.perf-wave-row.focused')).toEqual(['A', 'B']);
    press('[');
    press(']');
    expect(getControlFocus()).toEqual({ left: 'A', right: 'B' });
    press('ArrowLeft');
    press('ArrowRight');
    press('Enter');
    const host = browseHostFor('performance')!;
    expect(host.doubleClickDeck).toBe('A');
    act(() => { host.onLoadToDeck('C', track); host.onLoadToDeck('D', track); });
    expect(decks.A.loadTrack).toHaveBeenCalledTimes(3);
    expect(decks.B.loadTrack).toHaveBeenCalledTimes(2);
    expect(decks.C.loadTrack).not.toHaveBeenCalled();
    expect(decks.D.loadTrack).not.toHaveBeenCalled();
    click('4 DECKS');
    press('[');
    press(']');
    expect(getControlFocus()).toEqual({ left: 'C', right: 'D' });
  });

  it('keeps section hide/show and shared zoom state across deck-count changes', () => {
    render();
    const waves = container.querySelector<HTMLElement>('.perf-waves')!;
    const panels = container.querySelector<HTMLElement>('.perf-decks')!;
    click('Zoom');
    click('WAVE');
    click('DECK');
    click('2 DECKS');
    expect(waves.style.display).toBe('none');
    expect(panels.style.display).toBe('none');
    expect(container.querySelectorAll('.perf-wave-row')).toHaveLength(4);
    expect(container.querySelectorAll('.perf-deckpanel')).toHaveLength(4);
    click('WAVE');
    click('DECK');
    expect(container.querySelector('.perf-waves')).toBe(waves);
    expect(container.querySelector('.perf-decks')).toBe(panels);
    expect(waves.style.display).toBe('');
    expect(panels.style.display).toBe('');
    expect([...container.querySelectorAll<HTMLElement>('[data-zoom]')].map((node) => node.dataset.zoom)).toEqual(['17', '17', '17', '17']);
  });

  it('hides shared browse C/D load buttons only while two-deck Performance is active', () => {
    const surface = (active: boolean) => <div className="app-main">
      <ViewActiveContext value={active}><PerformanceView /></ViewActiveContext>
      <div className="app-browse">
        {CHANNEL_IDS.map((deck) => <button key={deck} data-deck={deck} className={`track-load-button-${deck}`}>{deck}</button>)}
      </div>
    </div>;
    render(surface(true));
    expect(visibleDecks('.app-browse button')).toEqual(['A', 'B', 'C', 'D']);
    click('2 DECKS');
    expect(visibleDecks('.app-browse button')).toEqual(['A', 'B']);
    render(surface(false));
    expect(visibleDecks('.app-browse button')).toEqual(['A', 'B', 'C', 'D']);
    act(() => { focusDeck('C'); focusDeck('D'); });
    expect(getControlFocus()).toEqual({ left: 'C', right: 'D' });
    render(surface(true));
    expect(getControlFocus()).toEqual({ left: 'A', right: 'B' });
    expect(visibleDecks('.app-browse button')).toEqual(['A', 'B']);
  });

  it('filters hidden-deck guides and recomputes line heights and chip positions', () => {
    render();
    const geometry = () => {
      const guide = container.querySelector('.perf-playguide.incoming-b')!;
      return {
        lines: [...guide.querySelectorAll<HTMLElement>('.perf-playguide-line')].map((node) => [node.style.top, node.style.height]),
        chip: guide.querySelector<HTMLElement>('.perf-playguide-chip')!.style.top,
      };
    };
    expect(container.querySelectorAll('.perf-playguide')).toHaveLength(4);
    expect(geometry()).toEqual({ lines: [['25%', '25%'], ['50%', '25%']], chip: '62.5%' });
    click('2 DECKS');
    expect(container.querySelectorAll('.perf-playguide')).toHaveLength(1);
    expect(geometry()).toEqual({ lines: [['0%', '50%'], ['50%', '50%']], chip: '75%' });
    click('4 DECKS');
    expect(container.querySelectorAll('.perf-playguide')).toHaveLength(4);
    expect(geometry()).toEqual({ lines: [['25%', '25%'], ['50%', '25%']], chip: '62.5%' });
  });

  it('renders knob/fader hints alongside labels and hides them with KBD', () => {
    const controls = <>
      <Knob label="LOW" kbd="Q" min={0} max={1} value={0} defaultValue={0} onChange={vi.fn()} />
      <HFader label="VOL" kbd={<>W/S</>} min={0} max={1} value={0} defaultValue={0} onChange={vi.fn()} />
    </>;
    render(<div className="perf-root">{controls}</div>);
    expect(container.querySelector('.perf-knob > span')!.textContent).toBe('LOWQ');
    expect(container.querySelector('.perf-fader-handle')!.textContent).toBe('VOLW/S');
    expect([...container.querySelectorAll('.perf-kbd')].every((node) => getComputedStyle(node).display !== 'none')).toBe(true);
    render(<div className="perf-root kbd-hints-off">{controls}</div>);
    expect([...container.querySelectorAll('.perf-kbd')].every((node) => getComputedStyle(node).display === 'none')).toBe(true);
  });
});
