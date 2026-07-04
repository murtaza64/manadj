import { useEffect, useRef } from 'react';
import { useDecks } from '../hooks/useDeck';
import { attachMidiController } from '../midi/adapter';
import { dispatchMidiAction } from '../midi/dispatch';
import { INPULSE_300_MK2 } from '../midi/mappings/inpulse300mk2';

/**
 * Mounts the Controller layer once, inside DeckProvider and above the view
 * switch (PRD scope): deck actions work in every view, and a mid-mix flip
 * to the library never detaches the hardware.
 *
 * Attach exactly once: the deck registry's identity changes on every Load,
 * so the dispatcher reads it through a ref instead of re-running the
 * attach effect (re-attaching would re-request MIDI access).
 */
export function MidiControllerBridge() {
  const decks = useDecks();
  const decksRef = useRef(decks);
  useEffect(() => {
    decksRef.current = decks;
  }, [decks]);

  useEffect(
    () =>
      attachMidiController({
        mappings: [INPULSE_300_MK2],
        onAction: (action) => dispatchMidiAction(action, decksRef.current),
      }),
    []
  );

  return null;
}
