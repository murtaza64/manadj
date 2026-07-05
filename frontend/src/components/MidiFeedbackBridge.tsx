import { useEffect, useSyncExternalStore } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { encodeDeckLeds, ledStates } from '../midi/feedback';
import { connectedOutputs, subscribeOutputs } from '../midi/outputStore';

/**
 * Headless Feedback glue (midi-pad-leds 01): per deck, subscribes to the
 * deck snapshot, derives desired light states through the tested seam
 * (midi/feedback.ts) and sends the deck's full light set to every
 * connected output. Resends on every relevant state change AND whenever
 * the output set changes — which is exactly the full sync a connect or
 * replug needs (the device does not dump LED state on connect).
 *
 * Read-only with respect to app state (glossary: Feedback; ADR 0013
 * untouched). Like MidiControlRegistrar, this is hands-on-hardware
 * verified glue — the tested seam is feedback.ts.
 */

function DeckFeedbackPublisher() {
  const { deck } = useDeck();
  const playing = useDeckSnapshot((s) => s.playing);
  const outputs = useSyncExternalStore(subscribeOutputs, connectedOutputs);

  useEffect(() => {
    if (outputs.length === 0) return;
    const states = ledStates({ playing });
    for (const output of outputs) {
      if (!output.mapping.feedback) continue;
      for (const message of encodeDeckLeds(output.mapping.feedback, deck, states)) {
        output.send(message);
      }
    }
  }, [deck, playing, outputs]);

  return null;
}

/** Mounted once inside DeckProvider, alongside MidiControlRegistrar. */
export function MidiFeedbackBridge() {
  return (
    <>
      <DeckScope deck="A">
        <DeckFeedbackPublisher />
      </DeckScope>
      <DeckScope deck="B">
        <DeckFeedbackPublisher />
      </DeckScope>
    </>
  );
}
