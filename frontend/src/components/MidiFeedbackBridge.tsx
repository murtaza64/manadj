import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { useAtCuePoint } from '../hooks/useAtCuePoint';
import { useDeck, useDecks, useDeckSnapshot } from '../hooks/useDeck';
import { useHotCues } from '../hooks/useHotCues';
import { BLINK_INTERVAL_MS, blinkPhase, encodeDeckLeds, ledStates } from '../midi/feedback';
import { connectedOutputs, subscribeOutputs } from '../midi/outputStore';
import type { DeckEngine } from '../playback/DeckEngine';

/**
 * Headless Feedback glue (midi-pad-leds 01/02/03): per deck, subscribes to
 * the deck snapshot (transport LEDs) and the hot cue query cache (pads —
 * the exact source the on-screen pads render, so screen and hardware
 * cannot drift), derives desired light states through the tested seam
 * (midi/feedback.ts) and sends the deck's full light set to every
 * connected output. Resends on every relevant state change AND whenever
 * the output set changes — which is exactly the full sync a connect or
 * replug needs (the device does not dump LED state on connect).
 *
 * Hardware pad-sets flow through the same mutations the screen uses; the
 * cache updates optimistically on mutate and settles after the round-trip,
 * so pad lights track the on-screen pads exactly — including rollbacks.
 *
 * Read-only with respect to app state (glossary: Feedback; ADR 0013
 * untouched). Like MidiControlRegistrar, this is hands-on-hardware
 * verified glue — the tested seam is feedback.ts.
 */

function DeckFeedbackPublisher({ phase }: { phase: boolean }) {
  const { deck, loadedTrack } = useDeck();
  const playing = useDeckSnapshot((s) => s.playing);
  const pendingPlay = useDeckSnapshot((s) => s.pendingPlay);
  const previewing = useDeckSnapshot((s) => s.previewing);
  // The on-screen CUE button's own at-cue predicate; ledStates adds the
  // paused gate (tested at the seam).
  const atCuePoint = useAtCuePoint();
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
    const states = ledStates({ playing, pendingPlay, previewing, atCuePoint, assignedPads }, phase);
    for (const output of outputs) {
      if (!output.mapping.feedback) continue;
      for (const message of encodeDeckLeds(output.mapping.feedback, deck, states)) {
        output.send(message);
      }
    }
  }, [deck, playing, pendingPlay, previewing, atCuePoint, assignedPads, phase, outputs]);

  return null;
}

/** The one app-driven ~2 Hz blink clock (the device has no native blink),
 * running only while some deck is pending-play. Phase is clock-derived so
 * both decks blink in step regardless of when each latched. */
function usePendingPlay(engine: DeckEngine): boolean {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getSnapshot().pendingPlay
  );
}

function useBlinkPhase(): boolean {
  const decks = useDecks();
  // Both hooks must run unconditionally (no || short-circuit).
  const pendingA = usePendingPlay(decks.A.engine);
  const pendingB = usePendingPlay(decks.B.engine);
  const anyPending = pendingA || pendingB;

  const [phase, setPhase] = useState(true);
  useEffect(() => {
    if (!anyPending) return; // no timer while nothing is pending
    const tick = () => setPhase(blinkPhase(performance.now()));
    tick();
    const interval = setInterval(tick, BLINK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      setPhase(true);
    };
  }, [anyPending]);
  return phase;
}

/** Mounted once inside DeckProvider, alongside MidiControlRegistrar. */
export function MidiFeedbackBridge() {
  const phase = useBlinkPhase();
  return (
    <>
      <DeckScope deck="A">
        <DeckFeedbackPublisher phase={phase} />
      </DeckScope>
      <DeckScope deck="B">
        <DeckFeedbackPublisher phase={phase} />
      </DeckScope>
    </>
  );
}
