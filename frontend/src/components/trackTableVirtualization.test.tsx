// @vitest-environment jsdom
// Virtualized TrackTable perf harness (track-table-virtualization 01).
//
// The recurring whole-UI stall came from the Library's unbounded track
// table: every Track in view mounted a <tr>, and a Follow play/pause churn
// re-rendered all of them at once. This harness is the red-capable signal
// the diagnosis was built on and the regression fence the fix keeps green:
//
//   1. Mounted <tr data-track-id> count stays bounded as the list grows to
//      1,000+ Tracks (only the visible window + overscan mounts).
//   2. A prop churn on the scale of a Follow play/pause (new selection and
//      a re-ordered candidate list) re-runs the row build
//      within a small mounted-row budget — the transport-update budget.
//
// jsdom has no layout, so the viewport geometry is injected: the scroll
// container's clientHeight and a fixed row height give a deterministic
// window. The assertions are on DOM node counts, not wall-clock time, so
// the loop is fast and stable in CI.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../api/client';
import TrackList from './TrackList';
import { setVirtualViewportMeasurer, ROW_HEIGHT } from './virtualRows';
import type { Track } from '../types';
import { COLUMN_CONFIG } from './columnConfig';
import { COLUMN_DRAG_MIME, setColumnOrder } from './columnOrder';
import { TRACKS_MIME } from '../selection/trackDrag';
import { writeSetting } from '../settings/persistedSettings';

// TrackList reads live deck occupancy in the app. Deck identity is
// orthogonal to this virtualization seam, so keep the standalone harness
// focused with a stable empty occupancy snapshot.
vi.mock('../hooks/useDeck', () => ({ useDecks: () => ({}) }));
vi.mock('../settings/persistedSettings', () => ({ writeSetting: vi.fn() }));
vi.mock('../api/client', () => ({ api: {
  waveforms: { getPreview: vi.fn(async () => null), getData: vi.fn() },
  hotcues: { getBulk: vi.fn(async () => ({})) },
} }));
const playback = vi.hoisted(() => ({ trackId: null as number | null, playing: false, otherDecks: false, audible: '' }));
vi.mock('../hooks/useDeckPlaybackLevels', () => ({
  useDeckPlaybackLevels: () => Object.fromEntries(['A', 'B', 'C', 'D'].map((ch) => [ch, playback.audible.includes(ch) ? 100 : 0])),
}));
vi.mock('../hooks/useDeckOccupancy', () => ({
  useDeckOccupancy: () => ({
    A: { trackId: playback.trackId, playing: playback.playing },
    B: { trackId: playback.trackId, playing: playback.otherDecks },
    C: { trackId: playback.trackId, playing: playback.otherDecks },
    D: { trackId: playback.trackId, playing: playback.otherDecks },
  }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const emptySet: ReadonlySet<number> = new Set();

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    filename: `/tracks/track-${i + 1}.mp3`,
    title: `Track ${i + 1}`,
    artist: `Artist ${i % 50}`,
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    tags: [],
  })) as Track[];
}

/** A fixed 600px viewport: ~21 visible rows at ROW_HEIGHT + overscan. */
const VIEWPORT_HEIGHT = 600;

let cleanup: (() => void)[] = [];
const clients: QueryClient[] = [];
afterEach(() => {
  Object.assign(playback, { trackId: null, playing: false, otherDecks: false, audible: '' });
  cleanup.forEach((fn) => fn());
  cleanup = [];
  clients.splice(0).forEach(client => client.clear());
  setColumnOrder(COLUMN_CONFIG.map(column => column.id));
  vi.clearAllMocks();
  setVirtualViewportMeasurer(null);
});

function renderList(props: Partial<React.ComponentProps<typeof TrackList>> & { tracks: Track[] }, viewportWidth?: number): {
  container: HTMLElement;
  root: Root;
  rerender: (next: Partial<React.ComponentProps<typeof TrackList>>) => void;
} {
  // The scroll container is what the virtualizer measures; inject a fixed
  // viewport so jsdom's zero-layout world yields a deterministic window.
  setVirtualViewportMeasurer(() => ({ scrollTop: 0, clientHeight: VIEWPORT_HEIGHT }));

  const container = document.createElement('div');
  if (viewportWidth !== undefined) {
    container.style.overflowY = 'auto';
    Object.defineProperty(container, 'clientWidth', { value: viewportWidth });
  }
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);

  let current: React.ComponentProps<typeof TrackList> = {
    isLoading: false,
    error: null,
    selectedIds: emptySet,
    onSelectTrack: noop,
    getDragIds: (id: number) => [id],
    onLoadTrack: noop,
    sortColumn: null,
    sortDirection: 'asc',
    onSort: noop,
    ...props,
  };

  const doRender = () => {
    act(() => {
      root.render(<QueryClientProvider client={client}><TrackList {...current} /></QueryClientProvider>);
    });
  };
  doRender();

  return {
    container,
    root,
    rerender: (next) => {
      current = { ...current, ...next };
      doRender();
    },
  };
}

function mountedRowCount(container: HTMLElement): number {
  return container.querySelectorAll('tbody tr[data-track-id]').length;
}

function transfer() {
  const data: Record<string, string> = {};
  return {
    get types() { return Object.keys(data); },
    getData: (type: string) => data[type] ?? '',
    setData: (type: string, value: string) => { data[type] = value; },
    effectAllowed: '', dropEffect: '',
  };
}

function dragEvent(target: Element, type: string, dataTransfer: ReturnType<typeof transfer>, clientX = -1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => { target.dispatchEvent(event); });
  return event;
}

describe('TrackTable column dragging', () => {
  it('releases a wide frozen prefix so a narrow pane can still scroll to other columns', () => {
    setColumnOrder(['tags']);
    const { container, root } = renderList({ tracks: makeTracks(1) }, 700);
    cleanup.push(() => act(() => root.unmount()));
    expect(container.querySelector('th')!.dataset.columnId).toBe('tags');
    expect(container.querySelectorAll('th.sticky-col-header')).toHaveLength(0);
    expect(container.querySelectorAll('td.sticky-col-cell')).toHaveLength(0);
    expect(container.querySelector('.sticky-shadow')).toBeNull();
  });

  it('moves headers and keyed cells together, shares order with playlists, and saves once on drop', () => {
    const onSort = vi.fn();
    const first = renderList({ tracks: makeTracks(2), onSort });
    const playlist = renderList({ tracks: makeTracks(2), playOrder: new Map([[1, 0], [2, 1]]) });
    cleanup.push(() => act(() => { first.root.unmount(); playlist.root.unmount(); }));
    const header = (id: string) => first.container.querySelector(`th[data-column-id="${id}"]`)!;
    const waveform = first.container.querySelector('.track-waveform-preview');
    expect(header('waveform').querySelector('svg')).not.toBeNull();
    expect(header('waveform').getAttribute('aria-label')).toBe('Waveform / hotcues');
    const dt = transfer();
    const source = header('waveform');
    dragEvent(source, 'dragstart', dt);
    expect(document.body.classList.contains('column-dragging')).toBe(true);
    expect(dt.getData(COLUMN_DRAG_MIME)).toBe('waveform');
    expect(dt.types).not.toContain(TRACKS_MIME);
    dragEvent(header('title'), 'dragover', dt);
    expect(header('title').classList.contains('column-drop-before')).toBe(true);
    expect(writeSetting).not.toHaveBeenCalled();
    dragEvent(header('title'), 'drop', dt);
    expect(document.body.classList.contains('column-dragging')).toBe(false);
    dragEvent(source, 'dragend', dt);
    expect(writeSetting).toHaveBeenCalledTimes(1);
    expect(writeSetting).toHaveBeenCalledWith('manadj-column-order-v1', expect.any(String));
    for (const { container } of [first, playlist]) {
      const headers = [...container.querySelectorAll('th')].map(cell => cell.getAttribute('data-column-id'));
      for (const row of container.querySelectorAll('tr[data-track-id]')) {
        expect([...row.children].map(cell => cell.getAttribute('data-column-id'))).toEqual(headers);
      }
      expect(headers.indexOf('waveform') + 1).toBe(headers.indexOf('title'));
    }
    expect(first.container.querySelector('.track-waveform-preview')).toBe(waveform);
    act(() => { header('title').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSort).not.toHaveBeenCalled();
    act(() => {
      header('title').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      header('title').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSort).toHaveBeenCalledWith('title');
    expect(first.container.querySelector('table')!.parentElement!.style.getPropertyValue('--colleft-waveform')).toBe('149px');
    expect(header('title').classList.contains('sticky-col-header')).toBe(false);
    expect(playlist.container.querySelectorAll('th.sticky-col-header')).toHaveLength(6);
  });

  it('leaves track dragging alone and blocks reorder/sort when a resize starts', () => {
    const onSort = vi.fn();
    const { container, root } = renderList({ tracks: makeTracks(1), onSort });
    cleanup.push(() => act(() => root.unmount()));
    const header = container.querySelector('th[data-column-id="title"]')!;
    const dt = transfer();
    dragEvent(container.querySelector('tr[data-track-id]')!, 'dragstart', dt);
    expect(dt.getData(TRACKS_MIME)).toBe('[1]');
    expect(dragEvent(header, 'dragover', dt).defaultPrevented).toBe(false);
    expect(dragEvent(header, 'drop', dt).defaultPrevented).toBe(false);
    expect(writeSetting).not.toHaveBeenCalled();
    const handle = header.querySelector('.col-resize-handle')!;
    act(() => { handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 })); });
    const columnTransfer = transfer();
    expect(dragEvent(header, 'dragstart', columnTransfer).defaultPrevented).toBe(true);
    expect(document.body.classList.contains('column-dragging')).toBe(false);
    expect(columnTransfer.types).toEqual([]);
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
      handle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSort).not.toHaveBeenCalled();
    expect(container.querySelector('table')!.parentElement!.style.getPropertyValue('--colw-title')).toBe('230px');
    expect(writeSetting).toHaveBeenCalledWith('manadj-column-widths-v1', expect.any(String));
    expect(writeSetting).not.toHaveBeenCalledWith('manadj-column-order-v1', expect.anything());
  });

  it('clears canceled drags without changing order or swallowing the next click', () => {
    const onSort = vi.fn();
    const { container, root } = renderList({ tracks: makeTracks(1), onSort });
    cleanup.push(() => act(() => root.unmount()));
    const header = container.querySelector('th[data-column-id="artist"]')!;
    const target = container.querySelector('th[data-column-id="title"]')!;
    const dt = transfer();
    dragEvent(header, 'dragstart', dt);
    dragEvent(target, 'dragover', dt);
    dragEvent(header, 'dragend', dt);
    expect(document.body.classList.contains('column-dragging')).toBe(false);
    expect(container.querySelector('.column-drop-before')).toBeNull();
    expect(writeSetting).not.toHaveBeenCalled();
    act(() => {
      header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSort).toHaveBeenCalledWith('artist');
  });

  it('restores the cursor if the dragging table unmounts', () => {
    const { container, root } = renderList({ tracks: makeTracks(1) });
    dragEvent(container.querySelector('th')!, 'dragstart', transfer());
    expect(document.body.classList.contains('column-dragging')).toBe(true);
    act(() => root.unmount());
    expect(document.body.classList.contains('column-dragging')).toBe(false);
  });
});

describe('TrackTable virtualization — bounded mounted rows', () => {
  it('requests only mounted previews, batches their cues, and spans the preview column', async () => {
    const tracks = makeTracks(1000);
    const { container, root } = renderList({
      tracks, groupLabelFor: () => 'Tracks', playOrder: new Map(tracks.map((track, index) => [track.id, index])),
    });
    cleanup.push(() => act(() => root.unmount()));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const mountedIds = [...container.querySelectorAll('tr[data-track-id]')].map(row => Number(row.getAttribute('data-track-id')));
    expect(api.waveforms.getPreview).toHaveBeenCalledTimes(mountedIds.length);
    expect(api.waveforms.getData).not.toHaveBeenCalled();
    expect(api.hotcues.getBulk).toHaveBeenCalledWith(mountedIds);
    expect(container.querySelectorAll('.track-waveform-preview')).toHaveLength(mountedIds.length);
    expect(container.querySelector('.track-tier-header td')?.getAttribute('colspan')).toBe('14');
    expect(container.querySelector('tr[aria-hidden] td')?.getAttribute('colspan')).toBe('14');
    expect(container.querySelectorAll('thead th')).toHaveLength(14);
  });

  it('shows animated-bar markup only for playing tracks, with separate audibility', () => {
    Object.assign(playback, { trackId: 1, playing: true, audible: 'A' });
    const { container, root, rerender } = renderList({
      tracks: makeTracks(3),
      transitionMarks: { B: new Map([[1, { count: 1, preferred: true }]]) },
    });
    cleanup.push(() => act(() => root.unmount()));
    expect(container.querySelectorAll('.track-playing i')).toHaveLength(3);
    expect(container.querySelector('.track-marks-cell .mark-a [aria-label="Deck A: Playing - 100% level"]')).not.toBeNull();
    expect(container.querySelector('.track-cell-text .track-playing')).toBeNull();
    expect(container.querySelector('.mark-star')).toBeNull();
    playback.audible = '';
    rerender({});
    expect(container.querySelectorAll('.track-playing i')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Deck A: Playing - 0% level"]')).not.toBeNull();
    playback.otherDecks = true;
    playback.audible = 'BD';
    rerender({});
    expect(container.querySelectorAll('.track-marks-cell .track-playing')).toHaveLength(4);
    expect(container.querySelector('.mark-b [aria-label="Deck B: Playing - 100% level"]')).not.toBeNull();
    expect(container.querySelector('.mark-c [aria-label="Deck C: Playing - 0% level"]')).not.toBeNull();
    expect(container.querySelector('.mark-d [aria-label="Deck D: Playing - 100% level"]')).not.toBeNull();
    playback.otherDecks = false;
    playback.playing = false;
    rerender({});
    expect(container.querySelector('.track-playing')).toBeNull();
    expect(container.querySelector('.mark-star')).not.toBeNull();
  });

  it('mounts only the visible window (+overscan), not every Track, at 1,000 rows', () => {
    const { container, root } = renderList({ tracks: makeTracks(1000) });
    cleanup.push(() => act(() => root.unmount()));

    const mounted = mountedRowCount(container);
    // A 600px viewport at 24px rows is ~25 rows; overscan doubles that at
    // most. The point of the assertion is that it does NOT scale with the
    // list: it must stay far below 1,000.
    const visible = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThanOrEqual(visible * 3);
  });

  it('mounted count does not grow with the list (100 vs 5,000)', () => {
    const small = renderList({ tracks: makeTracks(100) });
    cleanup.push(() => act(() => small.root.unmount()));
    const smallMounted = mountedRowCount(small.container);

    const big = renderList({ tracks: makeTracks(5000) });
    cleanup.push(() => act(() => big.root.unmount()));
    const bigMounted = mountedRowCount(big.container);

    // Both bounded by the viewport, not the list length.
    expect(bigMounted).toBeLessThanOrEqual(smallMounted + 2);
  });
});

describe('TrackTable virtualization — transport-update budget', () => {
  it('a Follow play/pause-scale prop churn keeps mounted rows bounded', () => {
    const tracks = makeTracks(1000);
    const { container, root, rerender } = renderList({
      tracks,
      selectedIds: emptySet,
    });
    cleanup.push(() => act(() => root.unmount()));

    const before = mountedRowCount(container);

    // Simulate the candidate-list churn a Follow play/pause produces:
    // selection moves and the candidate list is re-ordered. Neither may
    // un-bound the mounted row set.
    rerender({
      tracks: [...tracks].reverse(),
      selectedIds: new Set([500]),
    });

    const after = mountedRowCount(container);
    const visible = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
    expect(after).toBeLessThanOrEqual(visible * 3);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });
});

describe('TrackTable empty state (feature-tour #283)', () => {
  it('renders the caller-supplied guidance only when loaded with zero rows', () => {
    const { container, root, rerender } = renderList({
      tracks: [],
      emptyMessage: 'No tracks yet — import your library.',
    });
    cleanup.push(() => act(() => root.unmount()));
    expect(container.querySelector('.track-table-empty')?.textContent).toContain(
      'No tracks yet'
    );

    // Loading wins over the empty message…
    rerender({ isLoading: true });
    expect(container.querySelector('.track-table-empty')).toBeNull();
    expect(container.querySelector('.track-table-loading')).toBeTruthy();

    // …and rows win once data lands.
    rerender({ isLoading: false, tracks: makeTracks(3) });
    expect(container.querySelector('.track-table-empty')).toBeNull();
    expect(mountedRowCount(container)).toBe(3);
  });

  it('absent emptyMessage keeps the legacy bare table', () => {
    const { container, root } = renderList({ tracks: [] });
    cleanup.push(() => act(() => root.unmount()));
    expect(container.querySelector('.track-table-empty')).toBeNull();
  });
});
