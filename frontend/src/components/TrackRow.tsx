import TagPill from './TagPill';
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
    >
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
        <td className="track-cell">
          <div className="track-cell-single">
            {track.key || <span style={{ color: 'var(--overlay0)' }}>-</span>}
          </div>
        </td>
        <td className="track-cell">
          <div className="track-cell-single">
            {track.bpm || <span style={{ color: 'var(--overlay0)' }}>-</span>}
          </div>
        </td>
        <td className="track-energy-cell">
          {track.energy ? (
            <div style={{ display: 'flex' }}>
              {[1, 2, 3, 4, 5].map(level => {
                const isFilled = level <= track.energy!;
                const colors = [
                  'var(--energy-1)',
                  'var(--energy-2)',
                  'var(--energy-3)',
                  'var(--energy-4)',
                  'var(--energy-5)'
                ];
                const color = isFilled ? colors[level - 1] : 'var(--surface0)';

                return (
                  <div
                    key={level}
                    style={{
                      width: '16px',
                      height: '12px',
                      background: color
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <span style={{ color: 'var(--overlay0)' }}>-</span>
          )}
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
