import type { DeckContextValue } from '../hooks/useDeck';
import type { ChannelId } from '../playback/mixer';
import type { MidiAction } from './actions';

/**
 * Thin glue: dispatch translator actions to the same engine methods the
 * keyboard calls (useKeyboardShortcuts) — never synthetic key events. The
 * readiness guards mirror the keyboard's exactly:
 * - transport allows a loading deck (the engine latches play intent, like
 *   Space during a load);
 * - cue requires decoded audio belonging to the loaded Track (the
 *   useDeckReady predicate), like F.
 *
 * This slice handles transport toggle + cue down/up; every other target in
 * the vocabulary is a silent no-op until its slice lands.
 */
export function dispatchMidiAction(
  action: MidiAction,
  decks: Record<ChannelId, DeckContextValue>
): void {
  // Absolute/relative handlers land in later slices.
  if (action.kind !== 'button') return;

  const target = action.target;
  switch (target.control) {
    case 'transport': {
      if (action.edge !== 'down') return;
      const deck = decks[target.deck];
      const { loadState } = deck.engine.getSnapshot();
      if (loadState !== 'ready' && loadState !== 'fetching' && loadState !== 'decoding') return;
      deck.engine.togglePlay();
      return;
    }
    case 'cue': {
      const deck = decks[target.deck];
      if (!deckReady(deck)) return;
      if (action.edge === 'down') deck.engine.cueDown();
      else deck.engine.cueUp();
      return;
    }
    // Hot cues, beatjump, match, load: later slices.
    default:
      return;
  }
}

/** Same predicate as useDeckSnapshot's useDeckReady, sans subscription. */
function deckReady(deck: DeckContextValue): boolean {
  const id = deck.loadedTrack?.id ?? null;
  const snapshot = deck.engine.getSnapshot();
  return id !== null && snapshot.loadState === 'ready' && snapshot.trackId === id;
}
