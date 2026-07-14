import React, { type JSX } from 'react';
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
      <table className="track-table">
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
              <td colSpan={playOrder !== undefined ? 12 : 11} className="track-table-message track-table-loading">
                Loading tracks...
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={playOrder !== undefined ? 12 : 11} className="track-table-message track-table-error">
                Error loading tracks
              </td>
            </tr>
          ) : (
            (() => {
              // Group counts for the header rows (one pass; labels arrive
              // pre-grouped, so counting runs of equals suffices — but a
              // full tally is robust to a caller that didn't sort).
              const counts = new Map<string, number>();
              if (groupLabelFor) {
                for (const t of tracks) {
                  const label = groupLabelFor(t);
                  counts.set(label, (counts.get(label) ?? 0) + 1);
                }
              }
              let previousLabel: string | null = null;
              return tracks.map((track: Track) => {
                const label = groupLabelFor?.(track) ?? null;
                const signals = matchSignalsFor?.(track);
                const opensGroup = label !== null && label !== previousLabel;
                previousLabel = label;
                return (
                  <React.Fragment key={track.id}>
                    {opensGroup && (
                      <tr className="track-tier-header">
                        <td colSpan={playOrder !== undefined ? 12 : 11}>
                          {/* Sticky-left so the label survives horizontal
                              scroll — the td spans the whole (wide) table. */}
                          <span className="track-tier-label">
                            {label}
                            <span className="track-tier-count"> — {counts.get(label!)}</span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <TrackRow
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
                  </React.Fragment>
                );
              });
            })()
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
