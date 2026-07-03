import { type JSX } from 'react';
import TrackRow from './TrackRow';
import { MusicIcon, PersonIcon, KeyIcon, SpeedIcon, EnergyIcon, TagIcon, CalendarIcon } from './icons';
import type { Track } from '../types';
import { COLUMN_CONFIG, getStickyLeft } from './columnConfig';
import './TrackList.css';

type SortColumn = 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance';

interface TrackListProps {
  tracks: Track[];
  isLoading: boolean;
  error: Error | null;
  selectedTrack: Track | null;
  onSelectTrack: (track: Track) => void;
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
  sortColumn,
  sortDirection,
  onSort
}: TrackListProps) {
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
      width: config.width,
      minWidth: config.width,
      maxWidth: config.width,
      textAlign: config.align || 'left',
      ...(config.sticky ? { left: getStickyLeft(columnIndex) } : {})
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
      </th>
    );
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <table className="track-table">
        <thead>
          <tr>
            <SortableHeader column="key" icon={<KeyIcon />} columnIndex={0} />
            <SortableHeader column="bpm" icon={<SpeedIcon />} columnIndex={1} />
            <SortableHeader column="energy" icon={<EnergyIcon />} columnIndex={2} />
            <SortableHeader column="title" icon={<MusicIcon />} columnIndex={3} />
            <SortableHeader column="artist" icon={<PersonIcon />} columnIndex={4} />
            <SortableHeader column="created_at" icon={<CalendarIcon />} columnIndex={5} />
            <SortableHeader column="bitrate_kbps" label="quality" columnIndex={6} />
            <SortableHeader column="filesize_bytes" label="size" columnIndex={7} />
            <SortableHeader column="provenance" label="from" columnIndex={8} />
            <th style={{ textAlign: 'left', padding: '6px 12px', width: COLUMN_CONFIG[9].width }}>
              <TagIcon />
            </th>
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
                onSelect={onSelectTrack}
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
