import type { ReactNode } from 'react';
import { useDeck, useDeckReady } from '../../hooks/useDeck';
import { doubleBeatjump, halveBeatjump } from '../../playback/beatjump';
import { JumpBackIcon, JumpForwardIcon } from '../icons/JumpIcons';
import './deckControls.css';

/**
 * Beatjump row for the scoped deck: jump back / halve / [size] / double /
 * jump forward (deck-controls PRD, playback class). ONE per-deck size in
 * DeckContext, shared by every mode — set it here in any view, and the
 * jump keys everywhere use the same N.
 *
 * Icon language: curved jump arrows for the jumps; halve/double is plain
 * text `1/2` / `x2` (bare +/− disappears from deck controls).
 */
export function BeatjumpRow({
  backKbd,
  forwardKbd,
  backTitleSuffix = '',
  forwardTitleSuffix = '',
}: {
  /** On-control keyboard hint slots (Performance view). */
  backKbd?: ReactNode;
  forwardKbd?: ReactNode;
  /** Title-only key hints (library view, e.g. " (A)"). */
  backTitleSuffix?: string;
  forwardTitleSuffix?: string;
}) {
  const { engine, beatjumpBeats, setBeatjumpBeats } = useDeck();
  const ready = useDeckReady();

  return (
    <div className="deck-jumprow">
      <button
        className="player-button"
        disabled={!ready}
        onClick={() => engine.jumpBeats(-beatjumpBeats)}
        title={`Jump back ${beatjumpBeats} beats${backTitleSuffix}`}
      >
        <JumpBackIcon />
        {backKbd}
      </button>
      <button
        className="player-button"
        onClick={() => setBeatjumpBeats(halveBeatjump(beatjumpBeats))}
        title="Halve beatjump size"
      >
        1/2
      </button>
      <span className="deck-jumpsize" title="Beatjump size (beats)">
        {beatjumpBeats}
      </span>
      <button
        className="player-button"
        onClick={() => setBeatjumpBeats(doubleBeatjump(beatjumpBeats))}
        title="Double beatjump size"
      >
        x2
      </button>
      <button
        className="player-button"
        disabled={!ready}
        onClick={() => engine.jumpBeats(beatjumpBeats)}
        title={`Jump forward ${beatjumpBeats} beats${forwardTitleSuffix}`}
      >
        <JumpForwardIcon />
        {forwardKbd}
      </button>
    </div>
  );
}
