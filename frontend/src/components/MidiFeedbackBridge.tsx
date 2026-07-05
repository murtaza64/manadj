import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { useHotCues } from '../hooks/useHotCues';
import { encodeDeckLeds, ledStates } from '../midi/feedback';
import { connectedOutputs, subscribeOutputs } from '../midi/outputStore';

/**
 * Headless Feedback glue (midi-pad-leds 01/02): per deck, subscribes to
 * the deck snapshot (transport LEDs) and the hot cue query cache (pads —
 * the exact source the on-screen pads render, so screen and hardware
 * cannot drift), derives desired light states through the tested seam
 * (midi/feedback.ts) and sends the deck's full light set to every
 * connected output. Resends on every relevant state change AND whenever
 * the output set changes — which is exactly the full sync a connect or
 * replug needs (the device does not dump LED state on connect).
 *
 * Hardware pad-sets round-trip through the mutation and this same query
 * cache before the light updates (PRD: brief lag accepted; optimistic
 * LED-on is a flagged follow-up).
 *
 * Read-only with respect to app state (glossary: Feedback; ADR 0013
 * untouched). Like MidiControlRegistrar, this is hands-on-hardware
 * verified glue — the tested seam is feedback.ts.
 */

function DeckFeedbackPublisher() {
  const { deck, loadedTrack } = useDeck();
  const playing = useDeckSnapshot((s) => s.playing);
  // Keyed by the loaded Track: a Load re-keys the query, an empty deck
  // disables it (placeholder []) — both resolve to all pads dark until
  // real assignments arrive.
  const { data: hotCues } = useHotCues(loadedTrack?.id ?? null);
  const outputs = useSyncExternalStore(subscribeOutputs, connectedOutputs);

  const assignedPads = useMemo(
    () => new Set((loadedTrack ? (hotCues ?? []) : []).map((cue) => cue.slot_number)),
    [loadedTrack, hotCues]
  );

  useEffect(() => {
    if (outputs.length === 0) return;
    const states = ledStates({ playing, assignedPads });
    for (const output of outputs) {
      if (!output.mapping.feedback) continue;
      for (const message of encodeDeckLeds(output.mapping.feedback, deck, states)) {
        output.send(message);
      }
    }
  }, [deck, playing, assignedPads, outputs]);

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
