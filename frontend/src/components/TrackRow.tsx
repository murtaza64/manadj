import TagPill from './TagPill';
import EnergySquare from './EnergySquare';
import BPMDisplay from './BPMDisplay';
import KeyDisplay from './KeyDisplay';
import { formatRelativeTime } from '../utils/dateUtils';
import type { Track } from '../types';
import { COLUMN_CONFIG, getStickyLeft } from './columnConfig';
import './TrackRow.css';

interface Props {
  track: Track;
  isSelected: boolean;
  onSelect: (track: Track) => void;
}

export default function TrackRow({ track, isSelected, onSelect }: Props) {
  // Extract just the filename from the full path
  const filename = track.filename.split('/').pop() || track.filename;

  // Helper to get cell style from column config
  const getCellStyle = (columnIndex: number) => {
    const config = COLUMN_CONFIG[columnIndex];
    return {
      width: config.width,
      minWidth: config.width,
      maxWidth: config.width,
      textAlign: config.align || ('left' as const),
      ...(config.sticky ? { left: getStickyLeft(columnIndex) } : {})
    };
  };

  // Helper to get cell classes
  const getCellClasses = (columnIndex: number, baseClass: string = 'track-cell') => {
    const config = COLUMN_CONFIG[columnIndex];
    return [
      baseClass,
      config.sticky ? 'sticky-col-cell' : '',
      config.showShadow ? 'sticky-shadow' : ''
    ].filter(Boolean).join(' ');
  };

  return (
    <tr
      className={`track-row ${isSelected ? 'track-row-selected' : ''}`}
      onClick={() => onSelect(track)}
      data-track-id={track.id}
      style={{ cursor: 'pointer' }}
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.setData('trackId', track.id.toString());
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
        <td className={getCellClasses(0)} style={getCellStyle(0)}>
          <div className="track-cell-single">
            <KeyDisplay keyValue={track.key} />
          </div>
        </td>
        <td className={getCellClasses(1)} style={getCellStyle(1)}>
          <div className="track-cell-single">
            <BPMDisplay bpm={track.bpm} round={true} />
          </div>
        </td>
        <td className={getCellClasses(2, 'track-energy-cell')} style={getCellStyle(2)}>
          {track.energy ? (
            <EnergySquare
              level={track.energy}
              filled={true}
              showNumber={true}
            />
          ) : (
            <div className="energy-square-empty">
              -
            </div>
          )}
        </td>
        <td className={getCellClasses(3)} style={getCellStyle(3)}>
          <div className="track-cell-text">
            {track.title || filename}
          </div>
        </td>
        <td className="track-cell">
          <div className="track-cell-text">
            {track.artist || <span style={{ color: 'var(--overlay0)' }}>-</span>}
          </div>
        </td>
        <td style={{
          textAlign: 'right',
          padding: '2px 12px',
          fontSize: '12px',
          color: 'var(--subtext1)'
        }}>
          {formatRelativeTime(track.created_at)}
        </td>
        <td className="track-tags-cell">
          <div className="track-tags-container">
            {track.tags.map(tag => (
              <TagPill key={tag.id} tag={tag} />
            ))}
          </div>
        </td>
      </tr>
  );
}
