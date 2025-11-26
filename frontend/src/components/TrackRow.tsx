import TagPill from './TagPill';
import EnergySquare from './EnergySquare';
import BPMDisplay from './BPMDisplay';
import KeyDisplay from './KeyDisplay';
import type { Track } from '../types';
import './TrackRow.css';

interface Props {
  track: Track;
  isSelected: boolean;
  onSelect: (track: Track) => void;
}

export default function TrackRow({ track, isSelected, onSelect }: Props) {
  // Extract just the filename from the full path
  const filename = track.filename.split('/').pop() || track.filename;

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
        <td className="track-cell" style={{ textAlign: 'right' }}>
          <div className="track-cell-single">
            <KeyDisplay keyValue={track.key} />
          </div>
        </td>
        <td className="track-cell">
          <div className="track-cell-single">
            <BPMDisplay bpm={track.bpm} />
          </div>
        </td>
        <td className="track-energy-cell">
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
        <td className="track-cell">
          <div className="track-cell-text">
            {track.title || filename}
          </div>
        </td>
        <td className="track-cell">
          <div className="track-cell-text">
            {track.artist || <span style={{ color: 'var(--overlay0)' }}>-</span>}
          </div>
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
