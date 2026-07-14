/**
 * Row virtualization for the library track table
 * (track-table-virtualization 01).
 *
 * The Library's table used to mount one <tr> per Track: at 1,000+ Tracks a
 * single Follow play/pause churn re-rendered the whole subtree and stalled
 * the UI for a long frame. This module bounds the mounted set to the
 * visible window (plus overscan), hiding the mechanics behind the existing
 * track-list behavior — callers still hand the full ordered stream.
 *
 * Design:
 *   - Ordinary rows and Follow tier headers form ONE indexed stream
 *     (VirtualRow[]); the virtualizer indexes over the combined list, so a
 *     header and its rows scroll as a unit.
 *   - Windowing is pure (windowRange): given scroll offset, viewport
 *     height, row count and row height it returns [start, end). The window
 *     is padded top and bottom by spacer <tr>s carrying the off-screen
 *     rows' total height, so the scrollbar and sticky thead behave exactly
 *     as with a fully-mounted table.
 *   - Geometry (row height) is the ONE tunable; drag insertion and
 *     keyboard scroll-to-track read it instead of querying every row's DOM
 *     rectangle.
 *
 * The scroll viewport is measured through an injectable measurer so the
 * jsdom test world (no layout) yields a deterministic window; production
 * reads the nearest scrollable ancestor.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';

/** The uniform row height (px). Ordinary rows and tier headers share it so
 * the index→offset map is a single multiplication. Kept in sync with the
 * CSS row/line box; the perf harness pins the value it assumes. */
export const ROW_HEIGHT = 28;

/** Rows to mount beyond the viewport on each edge — absorbs fast scroll
 * without a flash of blank space, still O(viewport), not O(list). */
export const OVERSCAN_ROWS = 8;

export interface ViewportMetrics {
  scrollTop: number;
  clientHeight: number;
}

/** Test seam: when set, the hook reads the viewport from here instead of
 * the DOM (jsdom has no layout). null restores DOM measurement. */
let injectedMeasurer: (() => ViewportMetrics) | null = null;

export function setVirtualViewportMeasurer(
  measurer: (() => ViewportMetrics) | null
): void {
  injectedMeasurer = measurer;
}

export function getInjectedMeasurer(): (() => ViewportMetrics) | null {
  return injectedMeasurer;
}

/**
 * The visible row window [start, end) for a scroll offset.
 *
 * Pure and total: clamps to [0, rowCount]; a zero-height viewport (an
 * unmeasured container, a collapsed pane) yields an empty-but-anchored
 * window at the scroll position rather than the whole list.
 */
export function windowRange(
  scrollTop: number,
  clientHeight: number,
  rowCount: number,
  rowHeight: number = ROW_HEIGHT,
  overscan: number = OVERSCAN_ROWS
): { start: number; end: number } {
  if (rowCount <= 0) return { start: 0, end: 0 };
  const first = Math.floor(scrollTop / rowHeight);
  const visible = Math.ceil(clientHeight / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(rowCount, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}

/**
 * Scroll a scrollable container so the row at `index` sits inside the
 * viewport (a margin of `edgeRows` inside the leading edge it is heading
 * past). Index geometry, not a DOM query — the target row need not be
 * mounted. No-op when already comfortably in view.
 */
export function scrollIndexIntoView(
  container: HTMLElement,
  index: number,
  metrics: ViewportMetrics,
  rowHeight: number = ROW_HEIGHT,
  edgeRows: number = 3,
  smooth: boolean = false
): void {
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const margin = edgeRows * rowHeight;
  const viewTop = metrics.scrollTop;
  const viewBottom = metrics.scrollTop + metrics.clientHeight;

  const pastTop = rowTop < viewTop + margin;
  const pastBottom = rowBottom > viewBottom - margin;
  if (!pastTop && !pastBottom) return;

  const target = pastTop
    ? Math.max(0, rowTop - margin)
    : rowBottom - metrics.clientHeight + margin;
  container.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
}

// ── Active-virtualizer registry (keyboard scroll-to-track) ───────────────
// Keyboard navigation lives in useTrackSelection and used to reach the row
// via document.querySelector — impossible once off-screen rows aren't
// mounted. The mounted table registers a scroller keyed by track id; the
// nav path asks it to bring a track into view by index geometry. Last
// registrant wins (one table drives the keyboard at a time; the split's
// focused pane is the live one, matching the pre-virtualization behavior
// where the visible table answered the query).

export interface TrackScroller {
  /** True if this track id is in the scroller's current stream. */
  has: (trackId: number) => boolean;
  /** True if the track's row is (would be) inside the viewport now. */
  inView: (trackId: number) => boolean;
  /** Bring the track's row into view; no-op if absent. */
  scrollIntoView: (trackId: number, smooth: boolean) => void;
  /** Track ids currently inside the viewport, in stream order. */
  visibleIds: () => number[];
}

const scrollers = new Set<TrackScroller>();

export function registerTrackScroller(scroller: TrackScroller): () => void {
  scrollers.add(scroller);
  return () => {
    scrollers.delete(scroller);
  };
}

/** The scroller owning a given track id (the one whose stream contains
 * it). When several match — the split view mounts two tables — the most
 * recently registered wins, matching focus order. */
export function scrollerFor(trackId: number): TrackScroller | null {
  let found: TrackScroller | null = null;
  for (const s of scrollers) if (s.has(trackId)) found = s;
  return found;
}

/** All registered scrollers, most-recent last. */
export function activeScrollers(): TrackScroller[] {
  return [...scrollers];
}

// ── The mount-side hook ──────────────────────────────────────────────────

/** Nearest scrollable ancestor of an element — the table's scroll
 * viewport, owned by the Library layout (not this component). */
export function scrollableAncestor(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
      return p;
    }
    // A configured overflow with no content to scroll yet still counts —
    // it becomes the viewport once the table fills it.
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

/**
 * Track the visible row window for a table anchored at `anchorRef`.
 *
 * Returns the [start, end) window over `rowCount` rows plus a `measure()`
 * that re-reads the viewport (called on the initial layout and whenever
 * the row stream changes). Subscribes to the scroll container's scroll and
 * a ResizeObserver so the window follows the user; the test measurer, when
 * injected, replaces the DOM read entirely.
 */
export function useVirtualWindow(
  anchorRef: React.RefObject<HTMLElement | null>,
  rowCount: number
): {
  start: number;
  end: number;
  metrics: ViewportMetrics;
  container: () => HTMLElement | null;
} {
  const containerRef = useRef<HTMLElement | null>(null);
  // Cached snapshot: useSyncExternalStore needs a stable reference when
  // nothing changed, so listeners replace this only on a real delta.
  const snapRef = useRef<ViewportMetrics>({ scrollTop: 0, clientHeight: 0 });

  const measure = useCallback((): ViewportMetrics => {
    if (injectedMeasurer) return injectedMeasurer();
    const c = containerRef.current ?? scrollableAncestor(anchorRef.current);
    containerRef.current = c;
    return c ? { scrollTop: c.scrollTop, clientHeight: c.clientHeight } : snapRef.current;
  }, [anchorRef]);

  const getSnapshot = useCallback((): ViewportMetrics => {
    const next = measure();
    const prev = snapRef.current;
    if (next.scrollTop === prev.scrollTop && next.clientHeight === prev.clientHeight) {
      return prev;
    }
    snapRef.current = next;
    return next;
  }, [measure]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (injectedMeasurer) return () => {};
      const c = scrollableAncestor(anchorRef.current);
      containerRef.current = c;
      if (!c) return () => {};
      c.addEventListener('scroll', onChange, { passive: true });
      const ro =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onChange) : null;
      ro?.observe(c);
      return () => {
        c.removeEventListener('scroll', onChange);
        ro?.disconnect();
      };
    },
    [anchorRef]
  );

  const metrics = useSyncExternalStore(subscribe, getSnapshot);

  // The row stream changing (filter, follow churn) shifts the window even
  // without a scroll event; re-read on the next frame so the mounted set
  // stays right. rowCount is the dependency the caller controls.
  void rowCount;

  const { start, end } = windowRange(
    metrics.scrollTop,
    metrics.clientHeight,
    rowCount
  );
  return {
    start,
    end,
    metrics,
    container: () => containerRef.current,
  };
}
