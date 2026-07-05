import type { ReactNode } from 'react';
import { useDeck, useDeckReady, useDeckSnapshot } from '../../hooks/useDeck';
import { formatLoopBeats } from '../../playback/loop';
import './deckControls.css';

/**
 * Loop row for the scoped deck (looping 03/04): [½] [LOOP N] [×2],
 * mirroring the beatjump row idiom. The stateful LOOP button shows the
 * pending/active size — press to engage an auto-loop of the pending size
 * at the playhead, press again to release; lit green while a loop is
 * active (green = state, never Deck identity). ½/×2 adjust the pending
 * size when idle and resize the active region live when looping. Inert on
 * gridless Tracks (auto-loop never guesses).
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
        className="player-button"
        onClick={() => engine.resizeLoop('halve')}
        title={loop ? 'Halve the loop' : 'Halve loop size'}
      >
        1/2
      </button>
      <button
        className={`player-button deck-loop-toggle${loop ? ' active' : ''}`}
        disabled={!ready || !hasBeatgrid}
        onClick={() => engine.toggleLoop()}
        title={title}
      >
        LOOP {formatLoopBeats(beats)}
        {kbd}
      </button>
      <button
        className="player-button"
        onClick={() => engine.resizeLoop('double')}
        title={loop ? 'Double the loop' : 'Double loop size'}
      >
        x2
      </button>
    </div>
  );
}
