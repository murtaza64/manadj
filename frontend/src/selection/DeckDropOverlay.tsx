import type { ChannelId } from '../playback/mixer';
import type { DeckDropState } from './deckDrop';
import './deckDrop.css';

/**
 * Drop highlight drawn above the surface (canvases included). Render inside
 * the target (which must be positioned); null when no drag is over it.
 */
export function DeckDropOverlay({ deck, state }: { deck: ChannelId; state: DeckDropState }) {
  if (state === null) return null;
  return (
    <div className={`deck-drop-overlay deck-${deck.toLowerCase()}`} data-state={state} aria-hidden="true">
      <span className="deck-drop-label">{state === 'refused' ? 'PLAYING — LOAD BLOCKED' : `LOAD ${deck}`}</span>
    </div>
  );
}
