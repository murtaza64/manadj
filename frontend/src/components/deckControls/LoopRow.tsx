import type { ReactNode } from 'react';
import { useDeck, useDeckReady, useDeckSnapshot } from '../../hooks/useDeck';
import { formatLoopBeats } from '../../playback/loop';
import './deckControls.css';

/**
 * Loop row for the scoped deck (looping 03): one stateful LOOP button
 * showing the pending/active size — press to engage an auto-loop of the
 * pending size at the playhead, press again to release. Lit green while a
 * loop is active (green = state, never Deck identity). Inert on gridless
 * Tracks (auto-loop never guesses).
 */
export function LoopRow({
  kbd,
  titleSuffix = '',
}: {
  /** On-control keyboard hint slot (Performance view). */
  kbd?: ReactNode;
  /** Title-only key hint (library view, e.g. " (R)"). */
  titleSuffix?: string;
}) {
  const { engine } = useDeck();
  const ready = useDeckReady();
  const loop = useDeckSnapshot((s) => s.loop);
  const pendingBeats = useDeckSnapshot((s) => s.pendingLoopBeats);
  const hasBeatgrid = useDeckSnapshot((s) => s.hasBeatgrid);

  const beats = loop?.lengthBeats ?? pendingBeats;
  const title = loop
    ? `Release the loop${titleSuffix}`
    : hasBeatgrid
      ? `Loop ${formatLoopBeats(beats)} beats from here${titleSuffix}`
      : 'Auto-loop needs a beatgrid';

  return (
    <div className="deck-looprow">
      <button
        className={`player-button deck-loop-toggle${loop ? ' active' : ''}`}
        disabled={!ready || !hasBeatgrid}
        onClick={() => engine.toggleLoop()}
        title={title}
      >
        LOOP {formatLoopBeats(beats)}
        {kbd}
      </button>
    </div>
  );
}
