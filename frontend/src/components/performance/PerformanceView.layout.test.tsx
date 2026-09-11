// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckContext, DeckRegistryContext, useDeck, useDecks, type DeckContextValue } from '../../hooks/useDeck';
import { MixerContext } from '../../hooks/useMixer';
import { ViewActiveContext } from '../../contexts/viewActive';
import { CHANNEL_IDS, type Mixer, type ChannelId } from '../../playback/mixer';
import { _resetControlFocusForTests, focusDeck, getControlFocus, useControlFocus } from '../../performance/controlFocus';
import { setPerfSectionShown } from '../../performance/perfSectionsStore';
import { browseHostFor, sharedBrowseHandle } from '../browseHost';
import { PERSISTED_SETTING_KEYS } from '../../settings/persistedSettings';
import type { PlayGuideFrame } from '../../performance/playGuideModel';
import type { Track } from '../../types';
import { PerformanceView } from './PerformanceView';
import { HFader, Knob } from './MixerStrip';
import { dispatchFollow } from '../../follow/followStore';
import { getFollowParams } from '../../follow/paramsStore';

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
  DeckKeys: ({ enabled }: { enabled: boolean }) => <span data-key-deck={useDeck().deck} data-enabled={enabled} />,
}));
vi.mock('../../follow/followStore', () => ({ dispatchFollow: vi.fn() }));
vi.mock('../../performance/useMidiCursorSuppression', () => ({ useMidiCursorSuppression: () => {} }));
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

function press(key: string, options: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => { target.dispatchEvent(event); });
  act(() => { target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, ...options })); });
  return event;
}

describe('Performance library keyboard focus', () => {
  function browse() {
    const handle = {
      getSelectedTrack: vi.fn(() => ({ id: 20 } as Track)), navigate: vi.fn(),
      navigatePage: vi.fn(), navigateEnd: vi.fn(), areaMove: vi.fn(), activate: vi.fn(),
      selectAll: vi.fn(), focusSearch: vi.fn(), openFollowParams: vi.fn(),
    };
    sharedBrowseHandle.current = handle;
    return handle;
  }
  const isLibrary = () => container.querySelector('.perf-keyboard-scope')?.getAttribute('data-library-focus') === 'true';

  it('routes navigation and selection only in library focus, disabling both deck hubs', () => {
    const handle = browse(); render();
    expect(container.querySelector('.perf-keyboard-focus')).toBeNull();
    expect(getComputedStyle(container.querySelector('.perf-keyboard-scope')!).display).toBe('contents');
    press('j'); expect(handle.navigate).not.toHaveBeenCalled();
    press('Tab'); expect(isLibrary()).toBe(true);
    expect([...container.querySelectorAll('[data-enabled]')].every(node => node.getAttribute('data-enabled') === 'false')).toBe(true);
    press('j'); press('K', { shiftKey: true }); press('ArrowDown');
    expect(handle.navigate.mock.calls).toEqual([[1, false], [-1, true], [1, false]]);
    press('d', { ctrlKey: true }); press('u', { ctrlKey: true }); press('PageDown');
    expect(handle.navigatePage.mock.calls).toEqual([[1, true], [-1, true], [1]]);
    press('Home'); press('End'); expect(handle.navigateEnd.mock.calls).toEqual([[-1], [1]]);
    press('h'); press('l'); expect(handle.areaMove.mock.calls).toEqual([[-1], [1]]);
    press('Enter'); expect(handle.activate).toHaveBeenCalledOnce();
    expect(decks.A.loadTrack).not.toHaveBeenCalled();
    press('a', { metaKey: true }); press('a', { ctrlKey: true }); expect(handle.selectAll).toHaveBeenCalledTimes(2);
    press('Escape'); expect(isLibrary()).toBe(false);
    press('k'); expect(handle.navigate).toHaveBeenCalledTimes(3);
  });

  it('loads physical decks, keeps focus, respects the lock, and disables C/D in two-deck layout', () => {
    browse(); render(); press('Tab');
    for (const key of ['a', 'b', 'c', 'd']) press(key);
    expect(decks.A.loadTrack).toHaveBeenCalledOnce();
    expect(decks.B.loadTrack).toHaveBeenCalledOnce();
    expect(decks.C.loadTrack).not.toHaveBeenCalled(); // playing
    expect(decks.D.loadTrack).toHaveBeenCalledOnce();
    expect(isLibrary()).toBe(true);
    press('a', { repeat: true }); expect(decks.A.loadTrack).toHaveBeenCalledOnce();
    click('2 DECKS'); press('c'); press('d');
    expect(decks.A.loadTrack).toHaveBeenCalledOnce();
    expect(decks.B.loadTrack).toHaveBeenCalledOnce();
    expect(decks.D.loadTrack).toHaveBeenCalledOnce();
  });

  it('toggles Follow using loaded-track availability, not the browse selection', () => {
    browse(); decks.B.loadedTrack = null; render(); press('Tab');
    vi.mocked(dispatchFollow).mockClear();
    press('A', { shiftKey: true }); press('B', { shiftKey: true });
    press('D', { shiftKey: true, repeat: true });
    expect(dispatchFollow).toHaveBeenNthCalledWith(1, { type: 'toggle', deck: 'A', loaded: true });
    expect(dispatchFollow).toHaveBeenNthCalledWith(2, { type: 'toggle', deck: 'B', loaded: false });
    expect(dispatchFollow).toHaveBeenCalledTimes(2);
    click('2 DECKS'); press('C', { shiftKey: true });
    expect(dispatchFollow).toHaveBeenLastCalledWith({ type: 'toggle', deck: 'C', loaded: true });
    const before = getFollowParams().knownOnly;
    press('n'); expect(getFollowParams().knownOnly).toBe(!before);
    press('n'); expect(getFollowParams().knownOnly).toBe(before);
    expect(decks.A.loadTrack).not.toHaveBeenCalled();
  });

  it('leaves typing alone, focuses search, and allows Tab out of search but not other editors', () => {
    const handle = browse(); render(); press('Tab');
    press('/'); expect(handle.focusSearch).toHaveBeenCalledOnce();
    press('f'); expect(handle.openFollowParams).toHaveBeenCalledOnce();
    const input = document.createElement('input'); container.append(input); input.focus();
    expect(press('Tab', {}, input).defaultPrevented).toBe(false);
    press('j', {}, input); press('a', {}, input); press('/', {}, input);
    expect(handle.navigate).not.toHaveBeenCalled();
    expect(decks.A.loadTrack).not.toHaveBeenCalled();
    input.className = 'filter-bar-search';
    press('Tab', {}, input); expect(isLibrary()).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });

  it('lets dialogs dismiss before focus exits, and help is contextual', () => {
    const handle = browse(); render(); press('Tab');
    const dialog = document.createElement('div'); dialog.className = 'follow-modal-overlay'; container.append(dialog);
    press('Escape'); press('Tab'); press('j'); press('a');
    expect(isLibrary()).toBe(true);
    expect(handle.navigate).not.toHaveBeenCalled();
    expect(decks.A.loadTrack).not.toHaveBeenCalled();
    dialog.remove(); press('?');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('LIBRARY KEYBOARD');
    press('j'); expect(handle.navigate).not.toHaveBeenCalled();
    press('Escape'); expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(isLibrary()).toBe(true);
    press('Escape'); press('?');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('DECKS KEYBOARD');
  });

  it('blocks held keys across focus changes until release, and stays inert while inactive', () => {
    const handle = browse(); render();
    act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true })));
    press('Tab');
    press('j', { code: 'KeyJ', repeat: true }); expect(handle.navigate).not.toHaveBeenCalled();
    press('j', { code: 'KeyJ' }); expect(handle.navigate).toHaveBeenCalledOnce();
    render(<ViewActiveContext value={false}><PerformanceView /></ViewActiveContext>);
    press('j'); press('a'); press('Tab');
    expect(handle.navigate).toHaveBeenCalledOnce(); expect(decks.A.loadTrack).not.toHaveBeenCalled();
  });

  it('does not let a press originating in help leak into deck transport on close', () => {
    browse(); render(); press('?');
    act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })));
    press('Escape');
    expect(press('d', { repeat: true }).defaultPrevented).toBe(true);
    expect(press('d').defaultPrevented).toBe(false);
  });
});

describe('Performance deck-count layout', () => {
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
