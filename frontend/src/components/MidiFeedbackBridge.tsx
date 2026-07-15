import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { useAtCuePoint } from '../hooks/useAtCuePoint';
import { useBeatgridData } from '../hooks/useBeatgridData';
import { useDeck, useDeckSnapshot } from '../hooks/useDeck';
import { useHotCues } from '../hooks/useHotCues';
import { useMixerValue } from '../hooks/useMixer';
import { useFollowFlags } from '../follow/followStore';
import {
  BLINK_INTERVAL_MS,
  assistantLedLit,
  audibleTransportOverride,
  beatFlashFraction,
  beatFlashPeriodMs,
  beatFlashPhase,
  blinkPhase,
  encodeAssistantLed,
  encodeDeckLeds,
  ledStates,
} from '../midi/feedback';
import { effectiveBpm } from '../playback/tempo';
import { connectedOutputs, subscribeOutputs } from '../midi/outputStore';
import {
  audibleHolder,
  audibleTransportState,
  subscribeAudible,
} from '../playback/audibleSurface';
import { isQuantizeOn, subscribeQuantize } from '../playback/quantizeStore';
import { useControlFocus } from '../performance/controlFocus';

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
  clockNow,
  onNeedsClock,
}: {
  /** Shared blink-clock timestamp, or null while no light blinks. */
  clockNow: number | null;
  /** Report whether this deck currently has a blinking light. */
  onNeedsClock: (needs: boolean) => void;
}) {
  const { deck, engine, loadedTrack } = useDeck();
  // A layered Controller may expose a different logical Deck on the same
  // physical surface after focus changes. Re-send all logical deck state so
  // the newly visible layer repaints immediately.
  const controlFocus = useControlFocus();
  const playing = useDeckSnapshot((s) => s.playing);
  const pendingPlay = useDeckSnapshot((s) => s.pendingPlay);
  const previewing = useDeckSnapshot((s) => s.previewing);
  const hasCuePoint = useDeckSnapshot((s) => s.cuePoint !== null);
  // LOOP pad lamps (midi-performance-ops 02): the active loop's length,
  // straight off the same snapshot the on-screen LOOP row renders.
  const loopBeats = useDeckSnapshot((s) => s.loop?.lengthBeats ?? null);
  // The on-screen CUE button's own at-cue predicate; ledStates adds the
  // paused gate (tested at the seam).
  const atCuePoint = useAtCuePoint();
  // PFL is Mixer state, not deck state (headphone-cue 05) — read through
  // the same change subscription as the on-screen PFL button, so hardware
  // toggles, screen clicks and this light can never disagree.
  const pfl = useMixerValue((m) => m.getChannelState(deck).pfl);
  // Q lamp (midi-performance-ops 07): the app-wide Quantize store — the
  // same subscription the TopBar Q toggle renders from, so both hardware
  // lamps and the screen always agree.
  const quantize = useSyncExternalStore(subscribeQuantize, isQuantizeOn);
  // Key Lock lives in the engine snapshot (like the on-screen toggle) —
  // feeds the SHIFT-layer Q lamp probe only.
  const keyLock = useDeckSnapshot((s) => s.keyLock);
  // Keyed by the loaded Track: a Load re-keys the query, an empty deck
  // disables it (placeholder []) — both resolve to all pads dark until
  // real assignments arrive.
  const { data: hotCues } = useHotCues(loadedTrack?.id ?? null);
  // Grid-pad lamps (midi-performance-ops 05): lit iff the Track has a
  // Beatgrid — the same query the on-screen grid controls and the pad
  // handlers (useGridEditActions) read, so lamp and behavior cannot drift.
  const { data: beatgrid, error: beatgridError } = useBeatgridData(loadedTrack?.id ?? null);
  const hasBeatgrid = loadedTrack != null && !beatgridError && beatgrid != null;
  const outputs = useSyncExternalStore(subscribeOutputs, connectedOutputs);

  const assignedPads = useMemo(
    () => new Set((loadedTrack ? (hotCues ?? []) : []).map((cue) => cue.slot_number)),
    [loadedTrack, hotCues]
  );

  // Audibility-aware transport lights (editor-midi 05, ADR 0019): while a
  // non-shared holder exposes a transport state, PLAY mirrors it (the
  // editor reports its one mix transport for both decks) and the shared
  // deck's transport inputs are suppressed through the pure override
  // below. `null` = no override (shared audible, or a holder without the
  // section). Resubscribes when the holder flips — subscribeAudible fires
  // on claim/release, which re-renders and rebuilds the subscription.
  const holder = useSyncExternalStore(subscribeAudible, audibleHolder);
  const subscribeHolderPlaying = useCallback(
    (cb: () => void) => audibleTransportState()?.subscribe(cb) ?? (() => undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holder]
  );
  const holderPlaying = useSyncExternalStore(subscribeHolderPlaying, () =>
    holder === 'shared' ? null : (audibleTransportState()?.playing(deck) ?? null)
  );
  const overridden = holderPlaying !== null;

  // Which lights of THIS deck are blinking right now. Drives the shared
  // clock, and gates the phase values entering the effect below — a deck
  // with nothing blinking sees constant `true` phases, so the other deck's
  // blinking never causes resends here. Overridden transport never blinks
  // (pending-blink and the paused beat flash are shared-surface behaviors).
  // CDJ pause flash (four-deck 31): any loaded paused deck blinks PLAY (and
  // CUE when away from the cue), so the clock runs whenever one is paused.
  const loaded = loadedTrack != null;
  const bpm = useDeckSnapshot((s) => s.bpm);
  const pitchPercent = useDeckSnapshot((s) => s.pitchPercent);
  const pausedFlashing = !overridden && loaded && !playing;
  const needsClock = (!overridden && pendingPlay) || pausedFlashing;
  useEffect(() => {
    onNeedsClock(needsClock);
    return () => onNeedsClock(false);
  }, [needsClock, onNeedsClock]);

  const pendingPhase =
    pendingPlay && clockNow !== null ? blinkPhase(clockNow, BLINK_INTERVAL_MS) : true;
  // Beat-phased paused flash: cadence from the Deck's effective BPM, phase
  // from its paused playhead against its own grid (feedback.ts seam).
  // getPlayhead() is an imperative read on the clock tick — the playhead
  // only moves via gestures while paused, and each tick recomputes anyway.
  const beatFlash = useMemo(() => {
    if (!pausedFlashing || clockNow === null) return true;
    const period = beatFlashPeriodMs(bpm !== null ? effectiveBpm(bpm, pitchPercent) : null);
    const fraction = beatFlashFraction(
      engine.getPlayhead(),
      hasBeatgrid && beatgrid ? beatgrid.data.beat_times : null
    );
    return beatFlashPhase(clockNow, period, fraction);
  }, [pausedFlashing, clockNow, bpm, pitchPercent, engine, hasBeatgrid, beatgrid]);

  useEffect(() => {
    if (outputs.length === 0) return;
    const input = {
      playing,
      pendingPlay,
      previewing,
      hasCuePoint,
      atCuePoint,
      assignedPads,
      loaded,
      pfl,
      hasBeatgrid,
      quantize,
      keyLock,
      loopBeats,
    };
    const states = ledStates(
      holderPlaying === null ? input : audibleTransportOverride(input, holderPlaying),
      { pending: pendingPhase, beatFlash }
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
    loaded,
    pfl,
    hasBeatgrid,
    quantize,
    keyLock,
    loopBeats,
    holderPlaying,
    pendingPhase,
    beatFlash,
    controlFocus.left,
    controlFocus.right,
    outputs,
  ]);

  return null;
}

/**
 * The assistant lamp (midi-performance-ops 08): lit iff any Deck follows.
 * Not deck-scoped — one button over all Decks — so it publishes beside
 * the per-deck publishers. Subscribes to the follow store (every change
 * source funnels through it: the hardware macro, the FilterBar toggles,
 * playback spread/revoke), and resends on output-set changes, which is the
 * full sync a connect/replug needs.
 */
function AssistantFeedbackPublisher() {
  const follows = useFollowFlags();
  const outputs = useSyncExternalStore(subscribeOutputs, connectedOutputs);
  useEffect(() => {
    if (outputs.length === 0) return;
    const lit = assistantLedLit(follows);
    for (const output of outputs) {
      if (!output.mapping.feedback) continue;
      for (const message of encodeAssistantLed(output.mapping.feedback, lit)) {
        output.send(message);
      }
    }
  }, [follows, outputs]);
  return null;
}

/** Tick period for the shared blink clock. Fast enough to resolve a beat
 * flash at any playable tempo (200 BPM = 300 ms period, 150 ms half-cycle);
 * per-deck phase booleans are derived from the timestamp, so lights still
 * only resend on their own transitions. */
const CLOCK_TICK_MS = 50;

/** The one app-driven blink clock (the device has no native blink),
 * running only while some deck has a blinking light (pending-play PLAY or
 * the CDJ paused flash). Emits a shared timestamp; each deck derives its
 * own beat-phased booleans from it (feedback.ts), so all Controller lamps
 * stay in step regardless of when each started. */
function useBlinkClock(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(performance.now());
    const frame = requestAnimationFrame(tick);
    const interval = setInterval(tick, CLOCK_TICK_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, [active]);
  return active ? now : null;
}

/** Mounted once inside DeckProvider, alongside MidiControlRegistrar. */
export function MidiFeedbackBridge() {
  const [needsA, setNeedsA] = useState(false);
  const [needsB, setNeedsB] = useState(false);
  const [needsC, setNeedsC] = useState(false);
  const [needsD, setNeedsD] = useState(false);
  const onNeedsA = useCallback((needs: boolean) => setNeedsA(needs), []);
  const onNeedsB = useCallback((needs: boolean) => setNeedsB(needs), []);
  const onNeedsC = useCallback((needs: boolean) => setNeedsC(needs), []);
  const onNeedsD = useCallback((needs: boolean) => setNeedsD(needs), []);
  const clockNow = useBlinkClock(needsA || needsB || needsC || needsD);
  return (
    <>
      <DeckScope deck="A">
        <DeckFeedbackPublisher clockNow={clockNow} onNeedsClock={onNeedsA} />
      </DeckScope>
      <DeckScope deck="B">
        <DeckFeedbackPublisher clockNow={clockNow} onNeedsClock={onNeedsB} />
      </DeckScope>
      <DeckScope deck="C">
        <DeckFeedbackPublisher clockNow={clockNow} onNeedsClock={onNeedsC} />
      </DeckScope>
      <DeckScope deck="D">
        <DeckFeedbackPublisher clockNow={clockNow} onNeedsClock={onNeedsD} />
      </DeckScope>
      <AssistantFeedbackPublisher />
    </>
  );
}
