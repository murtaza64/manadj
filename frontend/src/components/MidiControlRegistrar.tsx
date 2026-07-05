import { useEffect, useMemo, useRef } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { useDeck, useDeckReady } from '../hooks/useDeck';
import { useHotCueActions } from '../hooks/useHotCueActions';
import { useMatchAction } from '../hooks/useMatchAction';
import { useMixer } from '../hooks/useMixer';
import { registerDeckControls, registerMixerControls } from '../midi/controlRegistry';
import { JogController } from '../midi/jog';
import { doubleBeatjump, halveBeatjump } from '../playback/beatjump';

/**
 * Headless glue (midi-controller 02/04): registers each shared Deck's
 * React-owned capabilities into the module-level control registry so MIDI
 * dispatch (which lives outside React) can drive them. Reuses the exact
 * hooks the on-screen controls use — hot cues via useHotCueActions
 * (set-empty / jump / hold-preview, React Query curation included),
 * beatjump via the same engine call + shared per-deck size as BeatjumpRow,
 * MATCH via the same useMatchAction as the on-screen button (out-of-reach
 * is silent: no hardware feedback channel), pitch via engine.setPitch with
 * the same ready gate as the on-screen fader. The Mixer registers itself —
 * MidiMixerControls is structurally a subset of Mixer.
 *
 * Registration runs once per deck; handlers read the latest hook values
 * through a ref so a Load or size change never re-registers. Like
 * MidiControllerBridge, this is hands-on-hardware verified glue — the tested
 * seam is dispatch + registry (dispatch.test.ts).
 */

function DeckControlsRegistrar() {
  const { deck, engine, loadedTrack, beatjumpBeats, setBeatjumpBeats } = useDeck();
  const ready = useDeckReady();
  const hotCues = useHotCueActions(loadedTrack?.id ?? null);
  const matchAction = useMatchAction();

  // One jog state machine per deck over the engine's bend/seek primitives
  // (midi/jog.ts is the tested seam). Disposed on engine change so a held
  // bend never outlives its deck.
  const jog = useMemo(
    () =>
      new JogController({
        isPlaying: () => engine.getSnapshot().playing,
        getPlayhead: () => engine.getPlayhead(),
        seek: (seconds) => engine.seek(seconds),
        setBend: (percent) => engine.setBend(percent),
      }),
    [engine]
  );
  useEffect(() => () => jog.dispose(), [jog]);

  const latest = useRef({
    engine,
    ready,
    hotCues,
    beatjumpBeats,
    setBeatjumpBeats,
    matchAction,
    jog,
  });
  useEffect(() => {
    latest.current = { engine, ready, hotCues, beatjumpBeats, setBeatjumpBeats, matchAction, jog };
  });

  useEffect(
    () =>
      registerDeckControls(deck, {
        hotCueDown: (pad) => latest.current.hotCues.down(pad),
        hotCueUp: (pad) => latest.current.hotCues.up(pad),
        beatjump: (direction) => {
          const { engine: e, ready: r, beatjumpBeats: beats } = latest.current;
          if (!r) return; // same gate as BeatjumpRow's disabled jumps
          e.jumpBeats(direction === 'back' ? -beats : beats);
        },
        beatjumpSize: (change) => {
          const { beatjumpBeats: beats, setBeatjumpBeats: set } = latest.current;
          set(change === 'halve' ? halveBeatjump(beats) : doubleBeatjump(beats));
        },
        setPitch: (percent) => {
          const { engine: e, ready: r } = latest.current;
          if (!r) return; // same gate as the on-screen pitch fader
          e.setPitch(percent);
        },
        match: () => {
          // Out-of-reach/unavailable are silent: no hardware feedback channel.
          latest.current.matchAction();
        },
        jogTicks: (ticks) => {
          const { jog: j, ready: r } = latest.current;
          if (!r) return; // no track/decoding: nothing to bend or seek
          j.onTicks(ticks);
        },
      }),
    [deck]
  );

  return null;
}

function MixerRegistrar() {
  const mixer = useMixer();
  // The Mixer instance satisfies MidiMixerControls structurally; it owns
  // clamping and audio-math (mixerMath.ts), so no wrapping is needed.
  useEffect(() => registerMixerControls(mixer), [mixer]);
  return null;
}

/** Mounted once inside DeckProvider, alongside MidiControllerBridge. */
export function MidiControlRegistrar() {
  return (
    <>
      <DeckScope deck="A">
        <DeckControlsRegistrar />
      </DeckScope>
      <DeckScope deck="B">
        <DeckControlsRegistrar />
      </DeckScope>
      <MixerRegistrar />
    </>
  );
}
