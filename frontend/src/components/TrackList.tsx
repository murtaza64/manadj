import React, { useEffect, useMemo, useRef, type JSX } from 'react';
import TrackRow, { type LoadedMark, type SelectMods, type TransitionMark } from './TrackRow';
import { useDecks } from '../hooks/useDeck';
import { useDeckOccupancy } from '../hooks/useDeckOccupancy';
import { loadedDecks } from '../sets/rowMarks';
import { MusicIcon, PersonIcon, KeyIcon, SpeedIcon, EnergyIcon, TagIcon, CalendarIcon, CrosshairIcon } from './icons';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import type { PairInfo } from '../editor/transitionIndex';
import { isLinked, type LinkKey } from '../links/linkStore';
import { getColumnConfig } from './columnConfig';
import { ColumnResizeHandle } from './ColumnResizeHandle';
import { useColumnWidths } from '../hooks/useColumnWidths';
import {
  ROW_HEIGHT,
  registerTrackScroller,
  scrollIndexIntoView,
  useVirtualWindow,
  type TrackScroller,
} from './virtualRows';
import './TrackList.css';

/** 'position' = Play order (#), playlist tables only. */
type SortColumn = 'position' | 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance';

interface TrackListProps {
  tracks: Track[];
  isLoading: boolean;
  error: Error | null;
  /** Multi-selection (playlist-editing 02): membership + click routing. */
  selectedIds: ReadonlySet<number>;
  onSelectTrack: (track: Track, mods: SelectMods) => void;
  /** Drag payload for a row (whole selection when the row is in it). */
  getDragIds: (trackId: number) => number[];
  /** Which pane drags from this table originate in. */
  dragSource?: import('../selection/trackDrag').TrackDragSource;
  /** Right-click on a row: open the track context menu. */
  onRowContextMenu?: (track: Track, pos: { x: number; y: number }) => void;
  /** Play order by track id (playlist tables): shows the # column. */
  playOrder?: ReadonlyMap<number, number>;
  /** Load a track onto the Deck (double-click; Enter goes via the keyboard hub). */
  onLoadTrack: (track: Track) => void;
  /** When set (Performance view), rows get hover load-to-A/B buttons. */
  onLoadToDeck?: (deck: ChannelId, track: Track) => void;
  /** Saved-Transition marks (transition-library 02): targets with a
   * Transition FROM deck A's / deck B's loaded track. */
  transitionMarksA?: ReadonlyMap<number, PairInfo>;
  transitionMarksB?: ReadonlyMap<number, PairInfo>;
  /** Linked marks (linked-pairs 03): the Linked set plus each deck's
   * loaded track id, resolved per row (symmetric, unordered pairs). */
  links?: ReadonlySet<LinkKey>;
  deckAId?: number | null;
  deckBId?: number | null;
  /** Section headers (follow-mode 08): when set, a full-width header row
   * (label — count) opens each run of equal labels. The caller supplies
   * pre-grouped tracks (Follow's tier ordering); this only renders the
   * boundaries. Absent = flat table. */
  groupLabelFor?: (track: Track) => string;
  /** Match score column (match-score PRD): when set, a score column
   * renders (Follow views). Known rows show their marks, not a score —
   * callers may return null for them. */
  scoreFor?: (track: Track) => number | null;
  /** Whether score is the active sort (the Follow default). */
  scoreSorted?: boolean;
  /** Score header click: return to the score order. */
  onScoreSort?: () => void;
  /** Why-did-this-match dimming (Follow views): per-row matched signals;
   * rows dim the key/tags that earned nothing. */
  matchSignalsFor?: (track: Track) => { key: boolean; tagIds: Set<number> };
  sortColumn: SortColumn | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
}

export default function TrackList({
  tracks,
  isLoading,
  error,
  selectedIds,
  onSelectTrack,
  getDragIds,
  dragSource,
  onRowContextMenu,
  playOrder,
  onLoadTrack,
  onLoadToDeck,
  transitionMarksA,
  transitionMarksB,
  links,
  deckAId,
  deckBId,
  groupLabelFor,
  scoreFor,
  scoreSorted = false,
  onScoreSort,
  matchSignalsFor,
  sortColumn,
  sortDirection,
  onSort
}: TrackListProps) {
  // Live deck occupancy (both decks) → per-row loaded identity mark,
  // mirroring the Set view's wash (sets 35). Memoized on engine slices,
  // so rows re-render only on load/play changes.
  const occupancy = useDeckOccupancy(useDecks());
  /** Memo-friendly loaded mark: which deck(s) hold this row's track. */
  const loadedFor = (id: number): LoadedMark =>
    (loadedDecks(id, occupancy).join('').toLowerCase() || 'none') as LoadedMark;
  /** Memo-friendly per-row mark state (strings, not objects). */
  const markFor = (marks: ReadonlyMap<number, PairInfo> | undefined, id: number): TransitionMark => {
    const info = marks?.get(id);
    return info ? (info.preferred ? 'preferred' : 'saved') : 'none';
  };
  /** Memo-friendly Linked flag: is this row Linked with the deck's track? */
  const linkedFor = (deckId: number | null | undefined, id: number): boolean =>
    links !== undefined && deckId != null && isLinked(links, deckId, id);
  const { widths, setWidth, resetWidth, cssVars } = useColumnWidths(playOrder !== undefined);
  const colSpan = playOrder !== undefined ? 12 : 11;

  // ── One indexed stream: tier headers + ordinary rows ──────────────────
  // Follow groups arrive pre-ordered; a header row opens each run of equal
  // labels. Flattening headers and tracks into a single VirtualRow[] lets
  // the virtualizer window over the combined stream, so a header scrolls
  // with its rows and the mounted set is bounded whether or not Follow
  // filters (the issue's "one stable ordered stream").
  type VirtualRow =
    | { kind: 'header'; key: string; label: string; count: number }
    | { kind: 'track'; key: number; track: Track };
  const rows = useMemo<VirtualRow[]>(() => {
    const out: VirtualRow[] = [];
    if (!groupLabelFor) {
      for (const t of tracks) out.push({ kind: 'track', key: t.id, track: t });
      return out;
    }
    // A full tally (one pass) is robust to a caller that didn't pre-sort;
    // headers still open only on label changes down the stream.
    const counts = new Map<string, number>();
    for (const t of tracks) {
      const label = groupLabelFor(t);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    let previousLabel: string | null = null;
    for (const t of tracks) {
      const label = groupLabelFor(t);
      if (label !== previousLabel) {
        out.push({ kind: 'header', key: `h:${label}`, label, count: counts.get(label) ?? 0 });
        previousLabel = label;
      }
      out.push({ kind: 'track', key: t.id, track: t });
    }
    return out;
  }, [tracks, groupLabelFor]);

  // Track id → stream index, for the keyboard scroll-to-track path.
  const indexOfTrack = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => {
      if (r.kind === 'track') m.set(r.track.id, i);
    });
    return m;
  }, [rows]);

  const tableRef = useRef<HTMLTableElement | null>(null);
  const { start, end, metrics, container } = useVirtualWindow(tableRef, rows.length);

  // Register a scroller so keyboard navigation can bring an off-screen
  // (unmounted) row into view by index geometry (useTrackSelection reads
  // this instead of querying the DOM). Ref-backed so registration is
  // mount-scoped while handlers see live geometry.
  const scrollGeom = useRef({ rows, indexOfTrack, metrics, container });
  useEffect(() => {
    scrollGeom.current = { rows, indexOfTrack, metrics, container };
  });
  useEffect(() => {
    const scroller: TrackScroller = {
      has: (id) => scrollGeom.current.indexOfTrack.has(id),
      inView: (id) => {
        const g = scrollGeom.current;
        const i = g.indexOfTrack.get(id);
        if (i === undefined) return false;
        const top = i * ROW_HEIGHT;
        return top + ROW_HEIGHT > g.metrics.scrollTop &&
          top < g.metrics.scrollTop + g.metrics.clientHeight;
      },
      scrollIntoView: (id, smooth) => {
        const g = scrollGeom.current;
        const i = g.indexOfTrack.get(id);
        const c = g.container();
        if (i === undefined || !c) return;
        scrollIndexIntoView(c, i, g.metrics, ROW_HEIGHT, 3, smooth);
      },
      visibleIds: () => {
        const g = scrollGeom.current;
        const first = Math.floor(g.metrics.scrollTop / ROW_HEIGHT);
        const last = Math.ceil(
          (g.metrics.scrollTop + g.metrics.clientHeight) / ROW_HEIGHT
        );
        const ids: number[] = [];
        for (let i = Math.max(0, first); i < Math.min(g.rows.length, last); i++) {
          const r = g.rows[i];
          if (r.kind === 'track') ids.push(r.track.id);
        }
        return ids;
      },
    };
    return registerTrackScroller(scroller);
  }, []);

  const SortableHeader = ({
    column,
    icon,
    columnId,
    label,
    center = false
  }: {
    column: SortColumn;
    icon?: JSX.Element;
    columnId: string;
    label?: string;
    /** Center the icon (narrow icon-only columns: key/bpm/energy). */
    center?: boolean;
  }) => {
    const config = getColumnConfig(columnId)!;
    const className = [
      'sortable-header',
      config.sticky ? 'sticky-col-header' : '',
      config.showShadow ? 'sticky-shadow' : '',
      sortColumn === column ? 'sorted' : ''
    ].filter(Boolean).join(' ');

    const style: React.CSSProperties = {
      width: `var(--colw-${config.id})`,
      minWidth: `var(--colw-${config.id})`,
      maxWidth: `var(--colw-${config.id})`,
      textAlign: config.align || 'left',
      ...(config.sticky ? { left: `var(--colleft-${config.id})` } : {})
    };

    return (
      <th className={className} style={style} onClick={() => onSort(column)}>
        <div className={`sortable-header-content ${center ? 'align-center' : config.align === 'right' ? 'align-right' : ''}`}>
          {icon || label}
          {sortColumn === column && (
            <span className="sort-indicator">
              {sortDirection === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </div>
        <ColumnResizeHandle
          columnId={config.id}
          currentWidth={widths[config.id]}
          onResize={setWidth}
          onReset={resetWidth}
        />
      </th>
    );
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', ...cssVars }}>
      <table className="track-table" ref={tableRef}>
        <thead>
          <tr>
            {playOrder !== undefined && <SortableHeader column="position" label="#" columnId="order" />}
            <SortableHeader column="key" icon={<KeyIcon />} columnId="key" center />
            <SortableHeader column="bpm" icon={<SpeedIcon />} columnId="bpm" center />
            <SortableHeader column="energy" icon={<EnergyIcon />} columnId="energy" center />
            {/* Marks/match column (follow-mode 09, match-score PRD): two
                evidence slots per row; while Follow filters, Compatible
                rows show their Match score here and the crosshair header
                returns the list to the score order after a column sort
                took over (client-side, so not a SortColumn). A full
                column citizen: crosshair name, resize handle. */}
            <th
              className={`sortable-header sticky-col-header${scoreFor !== undefined && scoreSorted ? ' sorted' : ''}`}
              style={{
                width: 'var(--colw-marks)',
                minWidth: 'var(--colw-marks)',
                maxWidth: 'var(--colw-marks)',
                left: 'var(--colleft-marks)',
              }}
              onClick={scoreFor !== undefined ? onScoreSort : undefined}
              title={
                scoreFor !== undefined
                  ? 'Match score (click to sort by match)'
                  : 'Evidence marks (saved transitions, links); match score while following'
              }
            >
              {/* The crosshair names the column always; sorting by match
                  only means something while Follow filters. */}
              <div className="sortable-header-content align-center">
                <CrosshairIcon width={13} height={13} />
                {scoreFor !== undefined && scoreSorted && (
                  <span className="sort-indicator">▼</span>
                )}
              </div>
              <ColumnResizeHandle
                columnId="marks"
                currentWidth={widths.marks}
                onResize={setWidth}
                onReset={resetWidth}
              />
            </th>
            <SortableHeader column="title" icon={<MusicIcon />} columnId="title" />
            <SortableHeader column="artist" icon={<PersonIcon />} columnId="artist" />
            <SortableHeader column="created_at" icon={<CalendarIcon />} columnId="created_at" />
            <th className="tags-header" style={{ textAlign: 'left', padding: '6px 12px', width: 'var(--colw-tags)', minWidth: 'var(--colw-tags)', maxWidth: 'var(--colw-tags)' }}>
              <TagIcon />
              <ColumnResizeHandle
                columnId="tags"
                currentWidth={widths.tags}
                onResize={setWidth}
                onReset={resetWidth}
              />
            </th>
            <SortableHeader column="bitrate_kbps" label="quality" columnId="quality" />
            <SortableHeader column="filesize_bytes" label="size" columnId="size" />
            <SortableHeader column="provenance" label="from" columnId="provenance" />
          </tr>
        </thead>
        <tbody>
          {isLoading && tracks.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="track-table-message track-table-loading">
                Loading tracks...
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={colSpan} className="track-table-message track-table-error">
                Error loading tracks
              </td>
            </tr>
          ) : (
            <>
              {/* Top spacer: the off-screen rows above the window, as one
                  <tr> of their total height — the scrollbar and sticky
                  thead behave as if every row were mounted. */}
              {start > 0 && (
                <tr aria-hidden="true" style={{ height: start * ROW_HEIGHT }}>
                  <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
                </tr>
              )}
              {rows.slice(start, end).map((row) => {
                if (row.kind === 'header') {
                  return (
                    <tr key={row.key} className="track-tier-header" style={{ height: ROW_HEIGHT }}>
                      <td colSpan={colSpan}>
                        {/* Sticky-left so the label survives horizontal
                            scroll — the td spans the whole (wide) table. */}
                        <span className="track-tier-label">
                          {row.label}
                          <span className="track-tier-count"> — {row.count}</span>
                        </span>
                      </td>
                    </tr>
                  );
                }
                const track = row.track;
                const signals = matchSignalsFor?.(track);
                return (
                  <TrackRow
                    key={track.id}
                    track={track}
                    isSelected={selectedIds.has(track.id)}
                    loadedOn={loadedFor(track.id)}
                    onSelect={onSelectTrack}
                    onLoad={onLoadTrack}
                    onLoadToDeck={onLoadToDeck}
                    getDragIds={getDragIds}
                    dragSource={dragSource}
                    onContextMenu={onRowContextMenu}
                    orderIndex={playOrder !== undefined ? (playOrder.get(track.id) ?? null) : undefined}
                    score={scoreFor !== undefined ? scoreFor(track) : undefined}
                    keyMatched={signals ? signals.key : undefined}
                    sharedTagIds={signals ? [...signals.tagIds].join(',') : undefined}
                    markA={markFor(transitionMarksA, track.id)}
                    markB={markFor(transitionMarksB, track.id)}
                    linkedA={linkedFor(deckAId, track.id)}
                    linkedB={linkedFor(deckBId, track.id)}
                  />
                );
              })}
              {/* Bottom spacer: the off-screen rows below the window. */}
              {end < rows.length && (
                <tr aria-hidden="true" style={{ height: (rows.length - end) * ROW_HEIGHT }}>
                  <td colSpan={colSpan} style={{ padding: 0, border: 0 }} />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>

      {isLoading && tracks.length > 0 && (
        <div className="track-table-fetching-overlay">
          <div className="track-table-fetching-message">Updating...</div>
        </div>
      )}
    </div>
  );
}
