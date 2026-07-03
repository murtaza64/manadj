import { type JSX } from 'react';
import TrackRow from './TrackRow';
import { MusicIcon, PersonIcon, KeyIcon, SpeedIcon, EnergyIcon, TagIcon, CalendarIcon } from './icons';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import { COLUMN_CONFIG } from './columnConfig';
import { ColumnResizeHandle } from './ColumnResizeHandle';
import { useColumnWidths } from '../hooks/useColumnWidths';
import './TrackList.css';

type SortColumn = 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance';

interface TrackListProps {
  tracks: Track[];
  isLoading: boolean;
  error: Error | null;
  selectedTrack: Track | null;
  onSelectTrack: (track: Track) => void;
  /** Load a track onto the Deck (double-click; Enter goes via the keyboard hub). */
  onLoadTrack: (track: Track) => void;
  /** The Deck's loaded track, for row highlighting. */
  loadedTrackId: number | null;
  /** When set (Performance view), rows get hover load-to-A/B buttons. */
  onLoadToDeck?: (deck: ChannelId, track: Track) => void;
  sortColumn: SortColumn | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
}

export default function TrackList({
  tracks,
  isLoading,
  error,
  selectedTrack,
  onSelectTrack,
  onLoadTrack,
  loadedTrackId,
  onLoadToDeck,
  sortColumn,
  sortDirection,
  onSort
}: TrackListProps) {
  const { widths, setWidth, resetWidth, cssVars } = useColumnWidths();

  const SortableHeader = ({
    column,
    icon,
    columnIndex,
    label
  }: {
    column: SortColumn;
    icon?: JSX.Element;
    columnIndex: number;
    label?: string;
  }) => {
    const config = COLUMN_CONFIG[columnIndex];
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
            <SortableHeader column="key" icon={<KeyIcon />} columnIndex={0} />
            <SortableHeader column="bpm" icon={<SpeedIcon />} columnIndex={1} />
            <SortableHeader column="energy" icon={<EnergyIcon />} columnIndex={2} />
            <SortableHeader column="title" icon={<MusicIcon />} columnIndex={3} />
            <SortableHeader column="artist" icon={<PersonIcon />} columnIndex={4} />
            <SortableHeader column="created_at" icon={<CalendarIcon />} columnIndex={5} />
            <th className="tags-header" style={{ textAlign: 'left', padding: '6px 12px', width: 'var(--colw-tags)', minWidth: 'var(--colw-tags)', maxWidth: 'var(--colw-tags)' }}>
              <TagIcon />
              <ColumnResizeHandle
                columnId="tags"
                currentWidth={widths.tags}
                onResize={setWidth}
                onReset={resetWidth}
              />
            </th>
            <SortableHeader column="bitrate_kbps" label="quality" columnIndex={7} />
            <SortableHeader column="filesize_bytes" label="size" columnIndex={8} />
            <SortableHeader column="provenance" label="from" columnIndex={9} />
          </tr>
        </thead>
        <tbody>
          {isLoading && tracks.length === 0 ? (
            <tr>
              <td colSpan={10} className="track-table-message track-table-loading">
                Loading tracks...
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={10} className="track-table-message track-table-error">
                Error loading tracks
              </td>
            </tr>
          ) : (
            tracks.map((track: Track) => (
              <TrackRow
                key={track.id}
                track={track}
                isSelected={selectedTrack?.id === track.id}
                isLoaded={loadedTrackId === track.id}
                onSelect={onSelectTrack}
                onLoad={onLoadTrack}
                onLoadToDeck={onLoadToDeck}
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
