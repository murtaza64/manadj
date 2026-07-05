import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { useAtCuePoint } from '../hooks/useAtCuePoint';
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { useHotCues } from '../hooks/useHotCues';
import {
  BLINK_INTERVAL_MS,
  CUE_FLASH_INTERVAL_MS,
  blinkPhase,
  encodeDeckLeds,
  ledStates,
} from '../midi/feedback';
import type { BlinkPhases } from '../midi/feedback';
import { connectedOutputs, subscribeOutputs } from '../midi/outputStore';

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

function DeckFeedbackPublisher({
  phases,
  onNeedsClock,
}: {
  phases: BlinkPhases;
  /** Report whether this deck currently has a blinking light. */
  onNeedsClock: (needs: boolean) => void;
}) {
  const { deck, loadedTrack } = useDeck();
  const playing = useDeckSnapshot((s) => s.playing);
  const pendingPlay = useDeckSnapshot((s) => s.pendingPlay);
  const previewing = useDeckSnapshot((s) => s.previewing);
  const hasCuePoint = useDeckSnapshot((s) => s.cuePoint !== null);
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

  // Which lights of THIS deck are blinking right now. Drives the shared
  // clock, and gates the phase values entering the effect below — a deck
  // with nothing blinking sees constant `true` phases, so the other deck's
  // blinking never causes resends here.
  const cueFlashing = !playing && !previewing && hasCuePoint && !atCuePoint;
  const needsClock = pendingPlay || cueFlashing;
  useEffect(() => {
    onNeedsClock(needsClock);
    return () => onNeedsClock(false);
  }, [needsClock, onNeedsClock]);

  const pendingPhase = pendingPlay ? phases.pending : true;
  const cueFlashPhase = cueFlashing ? phases.cueFlash : true;

  useEffect(() => {
    if (outputs.length === 0) return;
    const states = ledStates(
      { playing, pendingPlay, previewing, hasCuePoint, atCuePoint, assignedPads },
      { pending: pendingPhase, cueFlash: cueFlashPhase }
    );
    for (const output of outputs) {
      if (!output.mapping.feedback) continue;
      for (const message of encodeDeckLeds(output.mapping.feedback, deck, states)) {
        output.send(message);
      }
    }
  }, [
    deck,
    playing,
    pendingPlay,
    previewing,
    hasCuePoint,
    atCuePoint,
    assignedPads,
    pendingPhase,
    cueFlashPhase,
    outputs,
  ]);

  return null;
}

/** The one app-driven blink clock (the device has no native blink),
 * running only while some deck has a blinking light (pending-play PLAY or
 * away-from-cue CUE flash). Phases are clock-derived so both decks and the
 * on-screen CUE flash stay in step regardless of when each started. */
function useBlinkClock(active: boolean): BlinkPhases {
  const [phases, setPhases] = useState<BlinkPhases>({ pending: true, cueFlash: true });
  useEffect(() => {
    if (!active) return; // no timer while nothing is blinking
    const tick = () => {
      const now = performance.now();
      const next: BlinkPhases = {
        pending: blinkPhase(now, BLINK_INTERVAL_MS),
        cueFlash: blinkPhase(now, CUE_FLASH_INTERVAL_MS),
      };
      setPhases((prev) =>
        prev.pending === next.pending && prev.cueFlash === next.cueFlash ? prev : next
      );
    };
    tick();
    const interval = setInterval(tick, BLINK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      setPhases({ pending: true, cueFlash: true });
    };
  }, [active]);
  return phases;
}

/** Mounted once inside DeckProvider, alongside MidiControlRegistrar. */
export function MidiFeedbackBridge() {
  const [needsA, setNeedsA] = useState(false);
  const [needsB, setNeedsB] = useState(false);
  const onNeedsA = useCallback((needs: boolean) => setNeedsA(needs), []);
  const onNeedsB = useCallback((needs: boolean) => setNeedsB(needs), []);
  const phases = useBlinkClock(needsA || needsB);
  return (
    <>
      <DeckScope deck="A">
        <DeckFeedbackPublisher phases={phases} onNeedsClock={onNeedsA} />
      </DeckScope>
      <DeckScope deck="B">
        <DeckFeedbackPublisher phases={phases} onNeedsClock={onNeedsB} />
      </DeckScope>
    </>
  );
}
