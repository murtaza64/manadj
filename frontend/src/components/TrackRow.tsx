import { memo, type CSSProperties, type ReactNode } from 'react';
import TagPill from './TagPill';
import EnergySquare from './EnergySquare';
import BPMDisplay from './BPMDisplay';
import KeyDisplay from './KeyDisplay';
import { formatRelativeTime } from '../utils/dateUtils';
import type { Track } from '../types';
import type { ChannelId } from '../playback/mixer';
import { CHANNEL_IDS } from '../playback/mixer';
import { getColumnConfig } from './columnConfig';
import { setTrackDragPayload, type TrackDragSource } from '../selection/trackDrag';
import { LinkIcon } from '../links/LinkIcon';
import { loadedStripShadow } from '../sets/rowMarks';
import {
  parseRowEvidence,
  rowEvidenceTitle,
  type TransitionMark,
} from './rowEvidence';
import './TrackRow.css';

/** Saved-Transition mark state for one source deck (transition-library
 * 02): 'saved' = the loaded deck's track has a Transition into this row;
 * 'preferred' = that pair has a favorited one. Strings keep the row memo
 * effective. Re-exported from the pure evidence seam (issue 21). */
export type { TransitionMark } from './rowEvidence';

/** Click modifiers, interpreted by the selection model (playlist-editing 02). */
export interface SelectMods {
  /** Shift: range from the anchor. */
  shift: boolean;
  /** Cmd/Ctrl: toggle membership. */
  toggle: boolean;
}

/** Lowercase Deck ids holding this Track, or `none`. A primitive string
 * keeps row memoization effective for every A–D combination. */
export type LoadedMark = string;

interface Props {
  track: Track;
  isSelected: boolean;
  /** The Deck(s) this track is loaded on (live occupancy across A–D). */
  loadedOn: LoadedMark;
  onSelect: (track: Track, mods: SelectMods) => void;
  /** Load this track onto the Deck (double-click). */
  onLoad: (track: Track) => void;
  /** When set (Performance view), show hover load-to-A–D buttons. */
  onLoadToDeck?: (deck: ChannelId, track: Track) => void;
  /** When set, replaces the ABCD deck buttons (#221 Mix editor: rows
   * navigate the picker, not the decks). */
  rowActions?: import('./browseHost').BrowseRowAction[];
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
  /** Match score against the followed references (match-score PRD):
   * undefined = column absent; null = Known row (evidence, not score). */
  score?: number | null;
  /** Why-did-this-match dimming (Follow views): undefined = no follow
   * context. false dims the key cell (no compatible relation earned
   * points). Primitives, not objects — the row is memoized. */
  keyMatched?: boolean;
  /** CSV of tag ids shared with a followed reference; tags outside it
   * dim. undefined = no follow context (nothing dims). */
  sharedTagIds?: string;
  /** Per-Deck evidence marks (four-deck-performance 21), PACKED
   * (`packRowEvidence`): ◆/★ Transition marks and the symmetric Linked
   * chain for every Deck A–D. One primitive string keeps the row memo
   * effective. '' / undefined = no evidence. */
  evidence?: string;
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

/** A Deck's slot in the marks column: strongest evidence, or nothing. */
function markSlot(mark: TransitionMark, linked: boolean): ReactNode {
  if (mark === 'preferred') return <span className="mark-star">★</span>;
  if (linked) return <LinkIcon size={10} />;
  if (mark === 'saved') return '◆';
  return null;
}

/** Memoized: the table is large, and rows must not re-render on deck/selection
 * churn unless their own props changed. */
const TrackRow = memo(function TrackRow({
  track,
  isSelected,
  loadedOn,
  onSelect,
  onLoad,
  onLoadToDeck,
  rowActions,
  getDragIds,
  dragSource,
  onContextMenu,
  orderIndex,
  score,
  keyMatched,
  sharedTagIds,
  evidence = '',
}: Props) {
  // ≤4 tiny segments; parsing per render is cheaper than defeating the
  // row memo with object props.
  const deckEvidence = parseRowEvidence(evidence);
  // Extract just the filename from the full path
  const filename = track.filename.split('/').pop() || track.filename;
  const holdingDecks =
    loadedOn === 'none'
      ? []
      : (loadedOn.toUpperCase().split('') as ChannelId[]);
  // Loaded mark: deck-color strip at the left edge (rowMarks.loadedStripShadow),
  // carried as a CSS var the first cell's box-shadow reads (TrackRow.css) —
  // the first cell is sticky, so the strip survives horizontal scroll. No
  // background tint — the row's background belongs to hover/selection alone.
  const strip = loadedStripShadow(holdingDecks);
  const loadedStyle: CSSProperties = strip
    ? ({ '--loaded-strip': strip } as CSSProperties)
    : {};

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
      className={`track-row ${isSelected ? 'track-row-selected' : ''} ${track.archived_at ? 'track-row-archived' : ''}`}
      onClick={(e) => onSelect(track, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      onDoubleClick={() => onLoad(track)}
      data-track-id={track.id}
      style={{ cursor: 'pointer', ...loadedStyle }}
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
          <div className={`track-cell-single${keyMatched === false ? ' track-signal-dim' : ''}`}>
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
        {/* Marks column (follow-mode 09; A–D per four-deck-performance
            21): one slot per Deck with evidence, strongest wins (★
            favorited Transition > 🔗 Linked > ◆ saved Transition — the
            Known ranking). Tooltip carries ALL evidence. */}
        <td
          className={getCellClasses('marks', 'track-marks-cell')}
          style={getCellStyle('marks')}
          title={rowEvidenceTitle(deckEvidence)}
        >
          {/* While Follow filters, Compatible rows carry their Match
              score here instead of (absent) evidence marks — one column,
              two vocabularies. Any real mark wins the slot. */}
          {score != null && deckEvidence.length === 0 ? (
            <div className="track-match-score">{Math.round(score)}</div>
          ) : (
            <div className="track-marks">
              {/* Only occupied slots render, so a lone badge centers in
                  the column instead of hugging its deck's side. */}
              {deckEvidence.map(({ deck, mark, linked }) => (
                <span key={deck} className={`track-mark-slot mark-${deck.toLowerCase()}`}>
                  {markSlot(mark, linked)}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className={getCellClasses('title')} style={getCellStyle('title')}>
          <div className="track-cell-text">
            {track.needs_attention && (
              <span
                className="needs-attention-badge"
                title="Grid analysis bailed — no grid or BPM; grid it by hand or import one"
              >
                !
              </span>
            )}
            {track.title || filename}
          </div>
          {rowActions ? (
            <span className="track-load-buttons">
              {rowActions.map((a) => (
                <button
                  key={a.title}
                  className="track-load-button track-row-action"
                  title={a.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    a.run(track);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {a.icon}
                </button>
              ))}
            </span>
          ) : onLoadToDeck ? (
            <span className="track-load-buttons">
              {CHANNEL_IDS.map((deck) => (
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
          ) : null}
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
            {track.tags.map(tag => {
              const dim =
                sharedTagIds !== undefined &&
                !sharedTagIds.split(',').includes(String(tag.id));
              return (
                <span key={tag.id} className={dim ? 'track-signal-dim' : undefined}>
                  <TagPill tag={tag} />
                </span>
              );
            })}
          </div>
        </td>
        <td className="track-cell stems-cell" style={getCellStyle('stems')}>
          {track.has_stems ? (
            <span className="stems-check" title="Stems ready">
              ✓
            </span>
          ) : null}
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
