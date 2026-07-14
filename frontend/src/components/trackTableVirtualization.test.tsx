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
import TrackList from './TrackList';
import { setVirtualViewportMeasurer, ROW_HEIGHT } from './virtualRows';
import type { Track } from '../types';

// TrackList reads live deck occupancy in the app. Deck identity is
// orthogonal to this virtualization seam, so keep the standalone harness
// focused with a stable empty occupancy snapshot.
vi.mock('../hooks/useDeck', () => ({ useDecks: () => ({}) }));
vi.mock('../hooks/useDeckOccupancy', () => ({
  useDeckOccupancy: () => ({
    A: { trackId: null, playing: false },
    B: { trackId: null, playing: false },
    C: { trackId: null, playing: false },
    D: { trackId: null, playing: false },
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
afterEach(() => {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  setVirtualViewportMeasurer(null);
});

function renderList(props: Partial<React.ComponentProps<typeof TrackList>> & { tracks: Track[] }): {
  container: HTMLElement;
  root: Root;
  rerender: (next: Partial<React.ComponentProps<typeof TrackList>>) => void;
} {
  // The scroll container is what the virtualizer measures; inject a fixed
  // viewport so jsdom's zero-layout world yields a deterministic window.
  setVirtualViewportMeasurer(() => ({ scrollTop: 0, clientHeight: VIEWPORT_HEIGHT }));

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

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
      root.render(<TrackList {...current} />);
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

describe('TrackTable virtualization — bounded mounted rows', () => {
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
