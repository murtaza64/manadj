import {
  audibleHolder,
  audibleJog,
  audibleJumps,
  audibleLoops,
  audiblePads,
  audibleTransport,
} from '../playback/audibleSurface';
import { PITCH_RANGE_PERCENT } from '../playback/tempo';
import { isQuantizeOn, setQuantize } from '../playback/quantizeStore';
import type { MidiAction } from './actions';
import {
  browseSurface,
  deckControlsFor,
  midiFollowMacro,
  midiMixerControls,
} from './controlRegistry';
import { initialGridChordState, reduceGridChord } from './gridChord';
import type { GridChordCommand, GridChordEvent } from './gridChord';
import {
  BIPOLAR_PICKUP_TOLERANCE,
  PITCH_PICKUP_TOLERANCE,
  SoftTakeover,
  UNIPOLAR_PICKUP_TOLERANCE,
} from './softTakeover';
import { reportPickedUp, reportSuppressed, takeoverKey } from './takeoverFeedback';

/** Encoder detents per action are tiny; cap steps so a burst can't warp the
 * selection across the whole library in one message. */
const MAX_SELECTION_STEPS = 8;

/**
 * Thin glue, view-blind forever. Two routing classes (ADR 0013, gesture
 * classes per ADR 0019):
 *
 * - Surface-routed gesture classes (transport, cue, pads) go through the
 *   AUDIBLE SURFACE's handle — never to decks directly, never synthetic
 *   key events. The shared surface carries the library/performance guards
 *   and delegates to the deck behavior; the editor registers its own
 *   gesture semantics. A class (or handler) the holder didn't register is
 *   dropped — CUE drops in the editor like keyboard F.
 *
 * - Everything else (mixer, pitch, PFL, beatjump-size — state, not
 *   playback gestures) aims at the shared decks' registered controls
 *   (controlRegistry) regardless of audibility.
 *
 * Targets without a registered handler are silent no-ops, like unmapped
 * messages.
 */
export function dispatchMidiAction(action: MidiAction): void {
  if (action.kind === 'button') return dispatchButton(action.target, action.edge);
  if (action.kind === 'absolute') return dispatchAbsolute(action.target, action.value);
  return dispatchRelative(action.target, action.ticks);
}

/**
 * The one piece of dispatch-held state: the spin-to-nudge chord
 * (midi-performance-ops 06), folded through the pure reducer
 * (gridChord.ts — the tested seam). While a grid-nudge pad is held, that
 * deck's rim and touch ticks are consumed here BEFORE surface routing —
 * the deliberate ADR 0019 carve-out (see the amendment note there); the
 * shifted jog-seek stream stays surface-routed (SHIFT is its own
 * deliberate gesture).
 */
let gridChordState = initialGridChordState();

export function _resetGridChordForTests(): void {
  gridChordState = initialGridChordState();
}

function runGridChord(event: GridChordEvent): void {
  const [next, commands] = reduceGridChord(gridChordState, event);
  gridChordState = next;
  for (const command of commands) executeGridChordCommand(command);
}

function executeGridChordCommand(command: GridChordCommand): void {
  switch (command.type) {
    case 'pass-jog': {
      // Not armed: the tick keeps its normal surface-routed meaning.
      const jog = audibleJog();
      if (command.stream === 'rim') jog?.rimTicks(command.deck, command.ticks);
      else jog?.touchTicks(command.deck, command.ticks);
      return;
    }
    case 'local-nudge':
      deckControlsFor(command.deck)?.gridNudgeLocal(command.offsetMs);
      return;
    case 'tap-step':
      deckControlsFor(command.deck)?.gridNudgeStep(command.direction);
      return;
    case 'commit':
      deckControlsFor(command.deck)?.gridNudgeCommit(command.offsetMs);
      return;
    case 'bpm-tap':
      deckControlsFor(command.deck)?.gridBpm(command.op);
      return;
    case 'bpm-commit':
      deckControlsFor(command.deck)?.gridBpmAdjust(command.deltaBpm);
      return;
  }
}

type ButtonAction = Extract<MidiAction, { kind: 'button' }>;
type AbsoluteAction = Extract<MidiAction, { kind: 'absolute' }>;
type RelativeAction = Extract<MidiAction, { kind: 'relative' }>;

function dispatchRelative(target: RelativeAction['target'], ticks: number): void {
  switch (target.control) {
    case 'jog':
      // Rim and touch flow through the chord fold first (midi-performance-
      // ops 06): armed decks nudge the grid, unarmed decks pass through to
      // the audible surface unchanged.
      runGridChord({ type: 'jog-ticks', deck: target.deck, stream: 'rim', ticks });
      return;
    case 'jog-touch':
      runGridChord({ type: 'jog-ticks', deck: target.deck, stream: 'touch', ticks });
      return;
    case 'jog-seek':
      audibleJog()?.shiftRimTicks(target.deck, ticks);
      return;
    case 'selection-move': {
      const surface = browseSurface();
      if (!surface) return; // no browse surface in this view: no-op
      const step = ticks > 0 ? 1 : -1;
      const count = Math.min(Math.abs(ticks), MAX_SELECTION_STEPS);
      for (let i = 0; i < count; i++) surface.navigate(step);
      return;
    }
  }
}

function dispatchButton(target: ButtonAction['target'], edge: 'down' | 'up'): void {
  switch (target.control) {
    case 'transport': {
      if (edge !== 'down') return;
      audibleTransport()?.togglePlay(target.deck);
      return;
    }
    case 'cue': {
      const transport = audibleTransport();
      if (!transport) return; // boot-order edge: holder not registered yet
      if (edge === 'down') transport.cueDown?.(target.deck);
      else transport.cueUp?.(target.deck);
      return;
    }
    case 'hot-cue': {
      const pads = audiblePads();
      if (!pads) return; // holder registered no pads: the class drops
      if (edge === 'down') pads.hotCueDown(target.deck, target.pad);
      else pads.hotCueUp?.(target.deck, target.pad);
      return;
    }
    case 'hot-cue-clear': {
      if (edge !== 'down') return;
      audiblePads()?.hotCueClear(target.deck, target.pad);
      return;
    }
    case 'beatjump': {
      if (edge !== 'down') return;
      audibleJumps()?.beatjump(target.deck, target.direction);
      return;
    }
    case 'loop-toggle': {
      if (edge !== 'down') return;
      audibleLoops()?.toggleLoop(target.deck);
      return;
    }
    case 'beatjump-size': {
      if (edge !== 'down') return;
      deckControlsFor(target.deck)?.beatjumpSize(target.change);
      return;
    }
    case 'match': {
      if (edge !== 'down') return;
      deckControlsFor(target.deck)?.match();
      return;
    }
    case 'pfl': {
      // Mixer-class button (headphone-cue 02): straight to the mixer
      // surface like the absolutes — cueing works from any view and is
      // outside the audible-surface arbiter (the Cue bus belongs to the
      // shared Mixer, ADR 0013 untouched).
      if (edge !== 'down') return;
      midiMixerControls()?.togglePfl(target.channel);
      return;
    }
    case 'loop-preset': {
      // Loops gesture class (ADR 0019, midi-performance-ops 02): dropped
      // where the audible surface registers no loops (e.g. the editor).
      if (edge !== 'down') return;
      audibleLoops()?.loopPreset(target.deck, target.beats);
      return;
    }
    case 'loop-or-jump-size': {
      // State-disambiguated overload (midi-performance-ops 03): a running
      // loop consumes the press as a resize (loops gesture class); idle —
      // or where the audible surface registers no loops — it falls back
      // to the registry-direct beatjump-size meaning, unchanged.
      if (edge !== 'down') return;
      if (audibleLoops()?.resizeActiveLoop(target.deck, target.change)) return;
      deckControlsFor(target.deck)?.beatjumpSize(target.change);
      return;
    }
    case 'load': {
      // Load policy is VIEW-owned (editor-midi 03, ADR 0019): the browse
      // surface registration carries the embedding view's policy. No
      // browse surface or no selection: no-op.
      if (edge !== 'down') return;
      const surface = browseSurface();
      const track = surface?.getSelectedTrack();
      if (!surface || !track) return;
      surface.load(target.deck, track);
      return;
    }
    case 'grid-nudge': {
      // Grid edits are stored-data operations, not playback gestures —
      // registry-direct regardless of the audible surface (ADR 0019,
      // midi-performance-ops 05). Chorded since issue 06: the down edge
      // ARMS spin-to-nudge; the release decides tap (±10ms step) vs
      // commit (accumulated net offset). No timers — the reducer's
      // zero-tick discriminator does all the work.
      runGridChord({
        type: edge === 'down' ? 'pad-down' : 'pad-up',
        deck: target.deck,
        direction: target.direction,
      });
      return;
    }
    case 'grid-anchor': {
      if (edge !== 'down') return;
      deckControlsFor(target.deck)?.gridSetDownbeat();
      return;
    }
    case 'grid-bpm': {
      // Grow/shrink are chorded like the nudge pads (hold + jog = fine
      // BPM adjust, in-session decision 2026-07-06); halve/double stay
      // plain taps.
      if (target.change === 'grow' || target.change === 'shrink') {
        runGridChord({
          type: edge === 'down' ? 'bpm-pad-down' : 'bpm-pad-up',
          deck: target.deck,
          op: target.change,
        });
        return;
      }
      if (edge !== 'down') return;
      deckControlsFor(target.deck)?.gridBpm(target.change);
      return;
    }
    case 'quantize': {
      // Registry-direct sticky state (midi-performance-ops 07, ADR 0019).
      // The registry exists for React-owned capabilities; Quantize lives
      // in a module-level store, so dispatch writes it the same way the
      // TopBar Q button does — no indirection to drift through.
      if (edge !== 'down') return;
      setQuantize(!isQuantizeOn());
      return;
    }
    case 'key-lock': {
      // SHIFT+Q (midi-performance-ops 07): the Deck's Key Lock. The live
      // state is engine-owned (React), so this goes through the registry
      // like beatjump-size — registry-direct, never surface-routed.
      if (edge !== 'down') return;
      deckControlsFor(target.deck)?.toggleKeyLock();
      return;
    }
    case 'follow-macro': {
      // Assistant button (midi-performance-ops 08): registry-direct like
      // the other sticky/browse-adjacent state — Follow means the same
      // thing regardless of the audible surface. The registered handler
      // owns reading playing/loaded (React-owned) and runs the pure
      // decision (follow/model.ts: followMacroToggles).
      if (edge !== 'down') return;
      midiFollowMacro()?.();
      return;
    }
    default:
      return;
  }
}

/**
 * Map a normalized 0..1 position to -1..1 with an exact center. Hardware
 * center detents don't land on 0.5 exactly (14-bit center is 8192/16383,
 * 7-bit is 64/127 — both a hair high), and a centered pitch fader must mean
 * exactly 0% for beatmatching. Snap a half-7-bit-step-wide window to zero.
 */
const CENTER_SNAP = 0.008; // ±half a 7-bit step, scaled to -1..1
function bipolar(value: number): number {
  const scaled = value * 2 - 1;
  return Math.abs(scaled) <= CENTER_SNAP ? 0 : scaled;
}

/**
 * Soft takeover for every absolute target (midi-controller 15 pitch,
 * extended to the whole class in 17): each physical control folds through
 * a pickup state machine (softTakeover.ts — the tested seam) before
 * applying, so a mismatched fader/knob can't jump the parameter. Keyed by
 * the control's identity (per deck/channel/band).
 */
const takeovers = new Map<string, SoftTakeover>();

function takeoverFor(key: string, tolerance: number): SoftTakeover {
  let takeover = takeovers.get(key);
  if (!takeover) {
    takeover = new SoftTakeover(tolerance);
    takeovers.set(key, takeover);
  }
  return takeover;
}

export function _resetSoftTakeoverForTests(): void {
  takeovers.clear();
}

/** One absolute target, resolved: identity, domain value, read, write. */
interface AbsoluteRoute {
  key: string;
  tolerance: number;
  /** Incoming hardware position in the target's own domain. */
  value: number;
  /** Current software value (base state — never the automation overlay). */
  current: number;
  apply: (value: number) => void;
}

/**
 * Resolve an absolute target to its route. The translator normalizes to
 * 0..1; bipolar targets (pitch/filter/crossfader) rescale here to the
 * engine/Mixer conventions. Null = drop (unregistered, or gated).
 */
function routeAbsolute(target: AbsoluteAction['target'], value: number): AbsoluteRoute | null {
  switch (target.control) {
    case 'pitch': {
      // Deck rate is the AUDIBLE surface's business (ADR 0022): in the
      // editor the conductor owns B's rate (tempo-match), so a hardware
      // pitch move there would fight the arrangement math (perpetual
      // drift-correct re-seeks). Dropped like any unregistered gesture;
      // mixer-class controls below stay live pass-throughs by design.
      if (audibleHolder() !== 'shared') return null;
      const controls = deckControlsFor(target.deck);
      if (!controls) return null;
      return {
        key: takeoverKey.pitch(target.deck),
        tolerance: PITCH_PICKUP_TOLERANCE,
        value: bipolar(value) * PITCH_RANGE_PERCENT,
        current: controls.getPitch(),
        apply: (v) => controls.setPitch(v),
      };
    }
    case 'trim': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.trim(target.channel),
        tolerance: UNIPOLAR_PICKUP_TOLERANCE,
        value,
        current: mixer.getChannelState(target.channel).trim,
        apply: (v) => mixer.setTrim(target.channel, v),
      };
    }
    case 'eq': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.eq(target.channel, target.band),
        tolerance: UNIPOLAR_PICKUP_TOLERANCE,
        value,
        current: mixer.getChannelState(target.channel).eq[target.band],
        apply: (v) => mixer.setEq(target.channel, target.band, v),
      };
    }
    case 'filter': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.filter(target.channel),
        tolerance: BIPOLAR_PICKUP_TOLERANCE,
        value: bipolar(value),
        current: mixer.getChannelState(target.channel).filter,
        apply: (v) => mixer.setFilter(target.channel, v),
      };
    }
    case 'channel-fader': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.channelFader(target.channel),
        tolerance: UNIPOLAR_PICKUP_TOLERANCE,
        value,
        current: mixer.getChannelState(target.channel).fader,
        apply: (v) => mixer.setFader(target.channel, v),
      };
    }
    case 'crossfader': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.crossfader(),
        tolerance: BIPOLAR_PICKUP_TOLERANCE,
        value: bipolar(value),
        current: mixer.getCrossfader(),
        apply: (v) => mixer.setCrossfader(v),
      };
    }
    case 'master': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.master(),
        tolerance: UNIPOLAR_PICKUP_TOLERANCE,
        value,
        current: mixer.getMaster(),
        apply: (v) => mixer.setMaster(v),
      };
    }
    case 'cue-level': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.cueLevel(),
        tolerance: UNIPOLAR_PICKUP_TOLERANCE,
        value,
        current: mixer.getCueLevel(),
        apply: (v) => mixer.setCueLevel(v),
      };
    }
    case 'cue-mix': {
      const mixer = midiMixerControls();
      if (!mixer) return null;
      return {
        key: takeoverKey.cueMix(),
        tolerance: UNIPOLAR_PICKUP_TOLERANCE,
        value,
        current: mixer.getCueMix(),
        apply: (v) => mixer.setCueMix(v),
      };
    }
  }
}

function dispatchAbsolute(target: AbsoluteAction['target'], value: number): void {
  const route = routeAbsolute(target, value);
  if (!route) return;
  if (!takeoverFor(route.key, route.tolerance).feed(route.value, route.current)) {
    // Waiting for pickup: tell the on-screen control which way the hand
    // must move (midi-controller 18).
    reportSuppressed(route.key, route.value < route.current ? 'up' : 'down');
    return;
  }
  reportPickedUp(route.key);
  route.apply(route.value);
}
