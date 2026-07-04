import { memo } from 'react';
import TagPill from './TagPill';
import EnergySquare from './EnergySquare';
import BPMDisplay from './BPMDisplay';
import KeyDisplay from './KeyDisplay';
import { formatRelativeTime } from '../utils/dateUtils';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import { getColumnConfig } from './columnConfig';
import { setTrackDragPayload, type TrackDragSource } from '../selection/trackDrag';
import './TrackRow.css';

/** Saved-Transition mark state for one source deck (transition-library
 * 02): 'saved' = the loaded deck's track has a Transition into this row;
 * 'preferred' = that pair has a favorited one. Strings keep the row memo
 * effective. */
export type TransitionMark = 'none' | 'saved' | 'preferred';

/** Click modifiers, interpreted by the selection model (playlist-editing 02). */
export interface SelectMods {
  /** Shift: range from the anchor. */
  shift: boolean;
  /** Cmd/Ctrl: toggle membership. */
  toggle: boolean;
}

interface Props {
  track: Track;
  isSelected: boolean;
  /** True when this track is on the Deck. */
  isLoaded: boolean;
  onSelect: (track: Track, mods: SelectMods) => void;
  /** Load this track onto the Deck (double-click). */
  onLoad: (track: Track) => void;
  /** When set (Performance view), show hover load-to-A/B buttons. */
  onLoadToDeck?: (deck: ChannelId, track: Track) => void;
  /**
   * The ids a drag from this row carries: the whole selection when the row
   * is part of it, else just this row. Identity-stable (reads via ref) so
   * row memoization survives selection churn.
   */
  getDragIds: (trackId: number) => number[];
  /** Which pane drags from this row originate in (drop targets branch on it). */
  dragSource?: TrackDragSource;
  /** Right-click: open the track context menu (playlist-editing 03). */
  onContextMenu?: (track: Track, pos: { x: number; y: number }) => void;
  /** Play order index (0-based) — renders the # cell (playlist tables).
   * undefined = no # column; null = track has no position (shouldn't happen). */
  orderIndex?: number | null;
  markA?: TransitionMark;
  markB?: TransitionMark;
}

const LOSSLESS = new Set(['flac', 'alac', 'pcm']);

function formatQuality(codec?: string | null, bitrateKbps?: number | null): string {
  if (!codec) return '-';
  if (LOSSLESS.has(codec)) return codec.toUpperCase();
  return bitrateKbps ? `${codec.toUpperCase()} ${bitrateKbps}k` : codec.toUpperCase();
}

function isLowQuality(track: Track): boolean {
  if (!track.codec || LOSSLESS.has(track.codec)) return false;
  if (!track.bitrate_kbps) return false;
  // AAC transparency threshold is lower than MP3's
  return track.bitrate_kbps < (track.codec === 'aac' ? 128 : 192);
}

function formatSize(bytes?: number | null): string {
  if (!bytes) return '-';
  return `${(bytes / 1_000_000).toFixed(1)}M`;
}

/** Memoized: the table is large, and rows must not re-render on deck/selection
 * churn unless their own props changed. */
const TrackRow = memo(function TrackRow({
  track,
  isSelected,
  isLoaded,
  onSelect,
  onLoad,
  onLoadToDeck,
  getDragIds,
  dragSource,
  onContextMenu,
  orderIndex,
  markA = 'none',
  markB = 'none',
}: Props) {
  // Extract just the filename from the full path
  const filename = track.filename.split('/').pop() || track.filename;

  // Helper to get cell style from column config
  const getCellStyle = (columnId: string) => {
    const config = getColumnConfig(columnId)!;
    return {
      width: `var(--colw-${config.id})`,
      minWidth: `var(--colw-${config.id})`,
      maxWidth: `var(--colw-${config.id})`,
      textAlign: config.align || ('left' as const),
      ...(config.sticky ? { left: `var(--colleft-${config.id})` } : {})
    };
  };

  // Helper to get cell classes
  const getCellClasses = (columnId: string, baseClass: string = 'track-cell') => {
    const config = getColumnConfig(columnId)!;
    return [
      baseClass,
      config.sticky ? 'sticky-col-cell' : '',
      config.showShadow ? 'sticky-shadow' : ''
    ].filter(Boolean).join(' ');
  };

  return (
    <tr
      className={`track-row ${isSelected ? 'track-row-selected' : ''} ${isLoaded ? 'track-row-loaded' : ''} ${track.archived_at ? 'track-row-archived' : ''}`}
      onClick={(e) => onSelect(track, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      onDoubleClick={() => onLoad(track)}
      data-track-id={track.id}
      style={{ cursor: 'pointer' }}
      draggable={true}
      onDragStart={(e) => {
        setTrackDragPayload(e.dataTransfer, getDragIds(track.id), dragSource);
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(track, { x: e.clientX, y: e.clientY });
            }
          : undefined
      }
    >
        {orderIndex !== undefined && (
          <td className={getCellClasses('order')} style={getCellStyle('order')}>
            <div className="track-cell-single track-order-cell">
              {orderIndex === null ? '-' : orderIndex + 1}
            </div>
          </td>
        )}
        <td className={getCellClasses('key')} style={getCellStyle('key')}>
          <div className="track-cell-single">
            <KeyDisplay keyValue={track.key} />
          </div>
        </td>
        <td className={getCellClasses('bpm')} style={getCellStyle('bpm')}>
          <div className="track-cell-single">
            <BPMDisplay bpm={track.bpm} round={true} />
          </div>
        </td>
        <td className={getCellClasses('energy', 'track-energy-cell')} style={getCellStyle('energy')}>
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
        <td className={getCellClasses('title')} style={getCellStyle('title')}>
          {/* Saved-Transition marks: one glyph per source deck, in the
              deck's accent color; ★ when the pair is Preferred. */}
          {(markA !== 'none' || markB !== 'none') && (
            <span className="track-transition-marks">
              {markA !== 'none' && (
                <span
                  className="track-transition-mark mark-a"
                  title={`Saved transition from deck A's track${markA === 'preferred' ? ' (favorite)' : ''}`}
                >
                  {markA === 'preferred' ? '★' : '◆'}
                </span>
              )}
              {markB !== 'none' && (
                <span
                  className="track-transition-mark mark-b"
                  title={`Saved transition from deck B's track${markB === 'preferred' ? ' (favorite)' : ''}`}
                >
                  {markB === 'preferred' ? '★' : '◆'}
                </span>
              )}
            </span>
          )}
          <div className="track-cell-text">
            {track.title || filename}
          </div>
          {onLoadToDeck && (
            <span className="track-load-buttons">
              {(['A', 'B'] as const).map((deck) => (
                <button
                  key={deck}
                  className={`track-load-button track-load-button-${deck}`}
                  title={`Load to Deck ${deck}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLoadToDeck(deck, track);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {deck}
                </button>
              ))}
            </span>
          )}
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
        <td className="track-tags-cell" style={getCellStyle('tags')}>
          <div className="track-tags-container">
            {track.tags.map(tag => (
              <TagPill key={tag.id} tag={tag} />
            ))}
          </div>
        </td>
        <td className="track-cell" style={getCellStyle('quality')}>
          <span className={`quality-display ${isLowQuality(track) ? 'quality-low' : ''}`}>
            {formatQuality(track.codec, track.bitrate_kbps)}
          </span>
        </td>
        <td className="track-cell" style={getCellStyle('size')}>
          <span className="size-display">{formatSize(track.filesize_bytes)}</span>
        </td>
        <td className="track-cell" style={getCellStyle('provenance')}>
          {track.provenance ? (
            track.provenance.url ? (
              <a
                className="provenance-chip"
                href={track.provenance.url}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                title={track.provenance.url}
              >
                {track.provenance.label}
              </a>
            ) : (
              <span className="provenance-chip">
                {track.provenance.label}
              </span>
            )
          ) : (
            <span style={{ color: 'var(--overlay0)' }}>-</span>
          )}
        </td>

      </tr>
  );
});

export default TrackRow;
