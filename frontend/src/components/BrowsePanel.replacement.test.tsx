// @vitest-environment jsdom
import { act, useState, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { FilterProvider, useFilters } from '../contexts/FilterContext';
import { BrowseActiveContext } from '../contexts/browseActive';
import { ViewActiveContext } from '../contexts/viewActive';
import { browseSurface } from '../midi/controlRegistry';
import { dispatchSetSpace } from '../sets/spaceTransport';
import type { Track } from '../types';
import type TrackList from './TrackList';
import type PlaylistSidebar from './PlaylistSidebar';
import { BrowsePanel } from './BrowsePanel';
import Library from './Library';
import { sharedBrowseHandle, registerBrowseHost } from './browseHost';
import { _resetBrowseSessionForTests, browseSession, updateBrowseSession } from './browseStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { deck, hotCues, scrub, nudge, downbeat } = vi.hoisted(() => ({
  deck: {
    loadedTrack: { id: 7, tags: [] } as unknown as Track, beatjumpBeats: 4, loadTrack: vi.fn(),
    engine: {
      subscribe: () => () => {}, isAudioRunning: () => false,
      getSnapshot: () => ({ pendingPlay: false, loadState: 'ready', trackId: 7 }),
      togglePlay: vi.fn(), cueDown: vi.fn(), cueUp: vi.fn(), jumpBeats: vi.fn(),
      toggleLoop: vi.fn(),
    },
  },
  hotCues: { down: vi.fn(), up: vi.fn(), remove: vi.fn() },
  scrub: vi.fn(), nudge: vi.fn(), downbeat: vi.fn(),
}));

// Real Library, selection, keyboard hub, browse registry and FilterProvider;
// substitute audio/canvas rendering and unrelated discovery queries.
vi.mock('../hooks/useDeck', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useDeck')>(),
  useDeck: () => deck, useDeckReady: () => true, useDeckSnapshot: () => true,
  useDecks: () => ({ A: deck, B: deck, C: deck, D: deck }),
}));
vi.mock('../contexts/DeckContext', () => ({ DeckScope: ({ children }: { children: ReactNode }) => children }));
vi.mock('../hooks/useHotCueActions', () => ({ useHotCueActions: () => hotCues }));
vi.mock('../hooks/useScrubLoop', () => ({ useScrubLoop: (...args: unknown[]) => scrub(...args) }));
vi.mock('../hooks/useBeatgridData', () => ({
  GRID_NUDGE_MS: 1, useSetBeatgridDownbeat: () => downbeat, useNudgeBeatgrid: () => nudge,
}));
vi.mock('../editor/transitionIndex', () => ({ useTransitionIndex: () => ({}), transitionsFrom: () => new Map() }));
vi.mock('../links/linkStore', () => ({ useLinks: () => new Map(), linkedIdsOf: () => [] }));
vi.mock('./Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('./useTrackMenuItems', () => ({ useTrackMenuItems: () => [], useAddTracksToPlaylist: () => ({ mutate: vi.fn() }) }));
vi.mock('../sets/SetDetailPane', () => ({ default: () => null }));
vi.mock('../sessions/SessionTimelinePane', () => ({ SessionTimelinePane: () => null }));
vi.mock('../sessions/SessionsListView', () => ({ SessionsListView: () => null }));
vi.mock('./PlaylistFullExportModal', () => ({ PlaylistFullExportModal: () => null }));
vi.mock('../sets/spaceTransport', () => ({ dispatchSetSpace: vi.fn(() => true) }));
vi.mock('./Player', () => ({ default: function Player() {
  const [zoom, setZoom] = useState(8);
  return <button data-player data-zoom={zoom} onClick={() => setZoom(17)}>Zoom</button>;
} }));
vi.mock('./TagEditor', () => ({ default: () => <div data-tags /> }));
vi.mock('./TrackList', () => ({ default: function Table(props: ComponentProps<typeof TrackList>) {
  const [local, setLocal] = useState(0);
  return <div data-table data-local={local}>
    <button data-local-increment onClick={() => setLocal(local + 1)}>Table state</button>
    {props.tracks.map((track) => <button key={track.id} data-track-id={track.id}
      aria-selected={props.selectedIds?.has(track.id)}
      onClick={() => props.onSelectTrack(track, { shift: false, toggle: false })}
      onDoubleClick={() => props.onLoadTrack(track)}>{track.title}</button>)}
  </div>;
} }));
vi.mock('./FilterBar', () => ({ default: function Filters() {
  const { filters, setFilters } = useFilters();
  return <button data-filter={filters.search} onClick={() => setFilters({ ...filters, search: 'kept' })}>Filter</button>;
} }));
vi.mock('./PlaylistSidebar', () => ({ default: (props: ComponentProps<typeof PlaylistSidebar>) =>
  <button data-sidebar onClick={() => props.onSelectPlaylist(1)}>Playlist</button>,
}));

const tracks = [1, 2, 3].map((id) => ({ id, title: `Track ${id}`, bpm: 120 } as Track));
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  _resetBrowseSessionForTests();
  vi.spyOn(api.tracks, 'list').mockResolvedValue({ items: tracks });
  vi.spyOn(api.tracks, 'get').mockResolvedValue(deck.loadedTrack);
  vi.spyOn(api.playlists, 'list').mockResolvedValue([]);
  vi.spyOn(api.sets, 'list').mockResolvedValue([]);
  vi.spyOn(api.playlists, 'get').mockResolvedValue({ id: 1, name: 'Playlist', tracks } as Awaited<ReturnType<typeof api.playlists.get>>);
  vi.spyOn(api.playlistSync, 'getUnified').mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(children: ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <FilterProvider>{children}</FilterProvider>
  </QueryClientProvider>));
}

async function ready() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.querySelector('[data-track-id="2"]')).not.toBeNull();
  });
}

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

const settings = <div className="settings-page"><input type="range" /><input type="number" />
  <input type="checkbox" /><input type="radio" /><select><option>One</option></select><button>Settings button</button></div>;

it('replaces only the lower body, retaining player, table, selection, filter and scroll', async () => {
  await render(<BrowsePanel mode="library" />);
  await ready();
  const player = host.querySelector<HTMLButtonElement>('[data-player]')!;
  const table = host.querySelector<HTMLElement>('[data-table]')!;
  const tags = host.querySelector('[data-tags]');
  const body = host.querySelector<HTMLElement>('.Library')!;
  const scroller = table.parentElement!;
  act(() => {
    player.click();
    table.querySelector<HTMLButtonElement>('[data-local-increment]')!.click();
    host.querySelector<HTMLButtonElement>('[data-track-id="2"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-filter]')!.click();
    scroller.scrollTop = 217;
    scroller.dispatchEvent(new Event('scroll'));
  });
  expect(sharedBrowseHandle.current?.getSelectedTrack()?.id).toBe(2);
  const selection = browseSession().mainSelection;
  expect(browseSurface()).not.toBeNull();
  await render(<BrowsePanel mode="library" replacement={settings} />);
  expect(body.style.display).toBe('none');
  expect(host.querySelector('.Library-replacement .settings-page')).not.toBeNull();
  expect(host.querySelector('[data-player]')).toBe(player);
  expect(host.querySelector('[data-tags]')).toBe(tags);
  expect(player.closest('.Library')).toBeNull();
  expect(host.querySelector('[data-table]')).toBe(table);
  expect(browseSurface()).toBeNull();
  expect(sharedBrowseHandle.current?.getSelectedTrack()).toBeNull();
  act(() => sharedBrowseHandle.current?.navigate(1));
  for (const key of ['j', 'k', 'ArrowDown', 'ArrowUp', 'Enter', 'Delete', 'Backspace', 'Tab', 'PageDown', 'PageUp', 'Home', 'End', 'v', 't', 'e']) {
    expect(press(key).defaultPrevented).toBe(false);
  }
  expect(press('a', document.body, { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(browseSession().mainSelection).toBe(selection);
  expect(deck.loadTrack).not.toHaveBeenCalled();
  press(' ');
  expect(dispatchSetSpace).not.toHaveBeenCalled();
  expect(deck.engine.togglePlay).toHaveBeenCalledOnce();
  await render(<BrowsePanel mode="library" />);
  expect(body.style.display).toBe('flex');
  expect(host.querySelector('[data-player]')).toBe(player);
  expect(player.dataset.zoom).toBe('17');
  expect(host.querySelector('[data-table]')).toBe(table);
  expect(table.dataset.local).toBe('1');
  expect(scroller.scrollTop).toBe(217);
  expect(host.querySelector('[data-filter]')?.getAttribute('data-filter')).toBe('kept');
  expect(sharedBrowseHandle.current?.getSelectedTrack()?.id).toBe(2);
  expect(browseSurface()?.getSelectedTrack()?.id).toBe(2);
  press('Enter');
  expect(deck.loadTrack).toHaveBeenCalledWith(tracks[1]);
});

it('retains both split panes and their state across replacement', async () => {
  updateBrowseSession({ view: 'playlist', playlistId: 1, splitViewOpen: true });
  await render(<BrowsePanel mode="library" />);
  await ready();
  const tables = [...host.querySelectorAll<HTMLElement>('[data-table]')];
  expect(tables).toHaveLength(2);
  act(() => tables.forEach((table, index) => {
    table.parentElement!.scrollTop = 100 + index;
    table.querySelector<HTMLButtonElement>('[data-local-increment]')!.click();
  }));
  await render(<BrowsePanel mode="library" replacement={settings} />);
  await render(<BrowsePanel mode="library" />);
  host.querySelectorAll<HTMLElement>('[data-table]').forEach((table, index) => {
    expect(table).toBe(tables[index]);
    expect(table.dataset.local).toBe('1');
    expect(table.parentElement!.scrollTop).toBe(100 + index);
  });
  expect(browseSession().splitViewOpen).toBe(true);
});

it('keeps MIDI loads on the host policy and unregisters for either inactive boundary', async () => {
  const load = vi.fn();
  const unregister = registerBrowseHost('performance', { onLoadToDeck: load });
  try {
    await render(<BrowsePanel mode="performance" />);
    await ready();
    act(() => host.querySelector<HTMLButtonElement>('[data-track-id="2"]')!.click());
    act(() => browseSurface()?.load('B', browseSurface()!.getSelectedTrack()!));
    expect(load).toHaveBeenCalledWith('B', tracks[1]);
    expect(deck.loadTrack).not.toHaveBeenCalled();
    await render(<BrowseActiveContext value={false}><BrowsePanel mode="performance" /></BrowseActiveContext>);
    expect(browseSurface()).toBeNull();
    expect(sharedBrowseHandle.current?.getSelectedTrack()).toBeNull();
    await render(<ViewActiveContext value={false}><Library browseRef={sharedBrowseHandle} /></ViewActiveContext>);
    expect(browseSurface()).toBeNull();
    expect(sharedBrowseHandle.current?.getSelectedTrack()).toBeNull();
    press(' ');
    expect(deck.engine.togglePlay).not.toHaveBeenCalled();
  } finally {
    unregister();
  }
});

it('leaves Settings native controls alone while visible player controls still work', async () => {
  await render(<BrowsePanel mode="library" replacement={settings} />);
  for (const target of host.querySelectorAll('.settings-page input, .settings-page select, .settings-page button')) {
    for (const key of [' ', 'Enter', 'ArrowLeft', 'ArrowDown', 'Home', 'End', 'f', '1']) {
      expect(press(key, target, { code: key === '1' ? 'Digit1' : undefined }).defaultPrevented).toBe(false);
    }
  }
  expect(deck.engine.togglePlay).not.toHaveBeenCalled();
  expect(deck.engine.cueDown).not.toHaveBeenCalled();
  expect(hotCues.down).not.toHaveBeenCalled();
  press(' ', host.querySelector('[data-player]')!);
  press('a');
  press('r');
  press('1', document.body, { code: 'Digit1' });
  expect(deck.engine.togglePlay).toHaveBeenCalledOnce();
  expect(deck.engine.jumpBeats).toHaveBeenCalledWith(-4);
  expect(deck.engine.toggleLoop).toHaveBeenCalledOnce();
  expect(hotCues.down).toHaveBeenCalledWith(1);
});

it('releases held keys across Settings focus, modifiers, blur and view deactivation, not browse hiding', async () => {
  const view = (active: boolean, replacement?: ReactNode) => <ViewActiveContext value={active}>
    <Library replacement={replacement} />
  </ViewActiveContext>;
  await render(view(true));
  press('f');
  press('1', document.body, { code: 'Digit1' });
  press('h');
  await render(view(true, settings));
  expect(deck.engine.cueUp).not.toHaveBeenCalled();
  expect(hotCues.up).not.toHaveBeenCalled();
  expect(scrub).toHaveBeenLastCalledWith(deck.engine, -1);
  const input = host.querySelector('input')!;
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'F', shiftKey: true, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: '!', code: 'Digit1', shiftKey: true, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'H', shiftKey: true, bubbles: true }));
  });
  expect(deck.engine.cueUp).toHaveBeenCalledOnce();
  expect(hotCues.up).toHaveBeenCalledWith(1);
  expect(scrub).toHaveBeenLastCalledWith(deck.engine, 0);
  press('f');
  act(() => window.dispatchEvent(new Event('blur')));
  expect(deck.engine.cueUp).toHaveBeenCalledTimes(2);
  press('f');
  await render(view(false, settings));
  expect(deck.engine.cueUp).toHaveBeenCalledTimes(3);
  press('f');
  expect(deck.engine.cueDown).toHaveBeenCalledTimes(3);
});
