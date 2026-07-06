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
/** Repeat-cycle glyph (two arcs + arrowheads) standing in for "LOOP". */
function LoopIcon() {
  return (
    <svg className="deck-loop-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 7.3 v-0.6 a2.7 2.7 0 0 1 2.7 -2.7 h9.3 M11.3 1.3 l2.7 2.7 -2.7 2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 8.7 v0.6 a2.7 2.7 0 0 1 -2.7 2.7 H2 M4.7 14.7 l-2.7 -2.7 2.7 -2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  const loopBeatsLabel = useDeckSnapshot((s) => s.loopBeatsLabel);
  const pendingBeats = useDeckSnapshot((s) => s.pendingLoopBeats);
  const hasBeatgrid = useDeckSnapshot((s) => s.hasBeatgrid);

  // Active loop: the displayed size projects the audible region through the
  // LIVE grid (ADR 0027 §6) — `~N.N` after a re-tempo. Idle: pending size.
  const label = loop
    ? (loopBeatsLabel ?? formatLoopBeats(loop.lengthBeats))
    : formatLoopBeats(pendingBeats);
  const title = loop
    ? `Release the loop${titleSuffix}`
    : hasBeatgrid
      ? `Loop ${label} beats from here${titleSuffix}`
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
        aria-label={`Loop ${label}`}
      >
        <LoopIcon />
        {label}
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
