import { type JSX } from 'react';
import TrackRow, { type SelectMods, type TransitionMark } from './TrackRow';
import { MusicIcon, PersonIcon, KeyIcon, SpeedIcon, EnergyIcon, TagIcon, CalendarIcon } from './icons';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import type { PairInfo } from '../editor/transitionIndex';
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
  /** Right-click on a row: open the track context menu. */
  onRowContextMenu?: (track: Track, pos: { x: number; y: number }) => void;
  /** Play order by track id (playlist tables): shows the # column. */
  playOrder?: ReadonlyMap<number, number>;
  /** Load a track onto the Deck (double-click; Enter goes via the keyboard hub). */
  onLoadTrack: (track: Track) => void;
  /** The Deck's loaded track, for row highlighting. */
  loadedTrackId: number | null;
  /** When set (Performance view), rows get hover load-to-A/B buttons. */
  onLoadToDeck?: (deck: ChannelId, track: Track) => void;
  /** Saved-Transition marks (transition-library 02): targets with a
   * Transition FROM deck A's / deck B's loaded track. */
  transitionMarksA?: ReadonlyMap<number, PairInfo>;
  transitionMarksB?: ReadonlyMap<number, PairInfo>;
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
  onRowContextMenu,
  playOrder,
  onLoadTrack,
  loadedTrackId,
  onLoadToDeck,
  transitionMarksA,
  transitionMarksB,
  sortColumn,
  sortDirection,
  onSort
}: TrackListProps) {
  /** Memo-friendly per-row mark state (strings, not objects). */
  const markFor = (marks: ReadonlyMap<number, PairInfo> | undefined, id: number): TransitionMark => {
    const info = marks?.get(id);
    return info ? (info.preferred ? 'preferred' : 'saved') : 'none';
  };
  const { widths, setWidth, resetWidth, cssVars } = useColumnWidths(playOrder !== undefined);

  const SortableHeader = ({
    column,
    icon,
    columnId,
    label
  }: {
    column: SortColumn;
    icon?: JSX.Element;
    columnId: string;
    label?: string;
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
        <div className={`sortable-header-content ${config.align === 'right' ? 'align-right' : ''}`}>
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
            <SortableHeader column="key" icon={<KeyIcon />} columnId="key" />
            <SortableHeader column="bpm" icon={<SpeedIcon />} columnId="bpm" />
            <SortableHeader column="energy" icon={<EnergyIcon />} columnId="energy" />
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
              <td colSpan={playOrder !== undefined ? 11 : 10} className="track-table-message track-table-loading">
                Loading tracks...
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={playOrder !== undefined ? 11 : 10} className="track-table-message track-table-error">
                Error loading tracks
              </td>
            </tr>
          ) : (
            tracks.map((track: Track) => (
              <TrackRow
                key={track.id}
                track={track}
                isSelected={selectedIds.has(track.id)}
                isLoaded={loadedTrackId === track.id}
                onSelect={onSelectTrack}
                onLoad={onLoadTrack}
                onLoadToDeck={onLoadToDeck}
                getDragIds={getDragIds}
                onContextMenu={onRowContextMenu}
                orderIndex={playOrder !== undefined ? (playOrder.get(track.id) ?? null) : undefined}
                markA={markFor(transitionMarksA, track.id)}
                markB={markFor(transitionMarksB, track.id)}
              />
            ))
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
