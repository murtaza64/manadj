import { useEffect, useMemo, useRef } from 'react';
import { DeckScope } from '../contexts/DeckContext';
import { followMacroToggles } from '../follow/model';
import { dispatchFollow, getFollowFlags } from '../follow/followStore';
import { useDeck, useDeckReady, useDecks } from '../hooks/useDeck';
import { useGridEditActions } from '../hooks/useGridEditActions';
import { useHotCueActions } from '../hooks/useHotCueActions';
import { useMatchAction } from '../hooks/useMatchAction';
import { useMixer } from '../hooks/useMixer';
import {
  registerDeckControls,
  registerFollowMacro,
  registerMixerControls,
} from '../midi/controlRegistry';
import { JogController } from '../midi/jog';
import { doubleBeatjump, halveBeatjump } from '../playback/beatjump';
import { setKeyLockFlag } from '../playback/keyLockStore';

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
  // Grid-edit pad ops (midi-performance-ops 05): the same mutations and
  // commit chain the on-screen grid/BPM controls use.
  const gridEdit = useGridEditActions();

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
    gridEdit,
  });
  useEffect(() => {
    latest.current = {
      engine,
      ready,
      hotCues,
      beatjumpBeats,
      setBeatjumpBeats,
      matchAction,
      jog,
      gridEdit,
    };
  });

  useEffect(
    () =>
      registerDeckControls(deck, {
        hotCueDown: (pad) => latest.current.hotCues.down(pad),
        hotCueUp: (pad) => latest.current.hotCues.up(pad),
        // Same remove path as the on-screen pads (React Query curation), so
        // screen state and pad lights follow the clear.
        hotCueClear: (pad) => latest.current.hotCues.remove(pad),
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
        jogTouchTicks: (ticks) => {
          const { jog: j, ready: r } = latest.current;
          if (!r) return;
          j.onTouchTicks(ticks);
        },
        jogSeekTicks: (ticks) => {
          const { jog: j, ready: r } = latest.current;
          if (!r) return;
          j.onSeekTicks(ticks);
        },
        // Grid-edit pads (midi-performance-ops 05): registry-direct stored-
        // data ops; gridless-Track gating lives in useGridEditActions.
        gridNudgeStep: (direction) => latest.current.gridEdit.nudgeStep(direction),
        gridSetDownbeat: () => latest.current.gridEdit.setDownbeatAtPlayhead(),
        gridBpm: (change) => latest.current.gridEdit.bpm(change),
        gridNudgeLocal: (offsetMs) => latest.current.gridEdit.nudgeLocal(offsetMs),
        gridNudgeCommit: (offsetMs) => latest.current.gridEdit.nudgeCommit(offsetMs),
        gridBpmAdjust: (deltaBpm) => latest.current.gridEdit.bpmAdjust(deltaBpm),
        toggleKeyLock: () => {
          // SHIFT+Q (midi-performance-ops 07): the exact dual write the
          // on-screen key-lock toggle makes (DeckPanel) — the engine owns
          // the live state (snapshot.keyLock drives the worklet mode),
          // the store persists it for boot restore.
          const { engine: e } = latest.current;
          const on = e.getSnapshot().keyLock;
          e.setKeyLock(!on);
          setKeyLockFlag(deck, !on);
        },
        // LOAD deliberately absent (editor-midi 03): load policy is
        // view-owned and rides the browse-surface registration in Library.
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

/**
 * The assistant button's Follow macro (midi-performance-ops 08). Cross-deck
 * by nature, so it registers whole rather than per deck. On press: read
 * follow flags (module store) and each engine's live `playing`, run the
 * pure decision (followMacroToggles — the tested seam), and dispatch
 * ordinary `toggle` events. The reducer's loaded gate still applies —
 * enabling an empty Deck no-ops exactly like a FilterBar click, so the
 * button stays a shortcut over the untouched model.
 */
function FollowMacroRegistrar() {
  const decks = useDecks();
  const latest = useRef(decks);
  useEffect(() => {
    latest.current = decks;
  });
  useEffect(
    () =>
      registerFollowMacro(() => {
        const registry = latest.current;
        const playing = {
          A: registry.A.engine.getSnapshot().playing,
          B: registry.B.engine.getSnapshot().playing,
        };
        for (const deck of followMacroToggles(getFollowFlags(), playing)) {
          dispatchFollow({
            type: 'toggle',
            deck,
            loaded: registry[deck].loadedTrack !== null,
          });
        }
      }),
    []
  );
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
      <FollowMacroRegistrar />
    </>
  );
}
