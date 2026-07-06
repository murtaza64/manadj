import {
  audibleHolder,
  audibleJog,
  audibleJumps,
  audibleLoops,
  audiblePads,
  audibleTransport,
} from '../playback/audibleSurface';
import { PITCH_RANGE_PERCENT } from '../playback/tempo';
import type { MidiAction } from './actions';
import { browseSurface, deckControlsFor, midiMixerControls } from './controlRegistry';

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

type ButtonAction = Extract<MidiAction, { kind: 'button' }>;
type AbsoluteAction = Extract<MidiAction, { kind: 'absolute' }>;
type RelativeAction = Extract<MidiAction, { kind: 'relative' }>;

function dispatchRelative(target: RelativeAction['target'], ticks: number): void {
  switch (target.control) {
    case 'jog':
      audibleJog()?.rimTicks(target.deck, ticks);
      return;
    case 'jog-touch':
      audibleJog()?.touchTicks(target.deck, ticks);
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
 * Jump semantics (PRD decision): the incoming position applies immediately,
 * no soft takeover. The translator normalizes to 0..1; bipolar targets
 * (pitch/filter/crossfader) rescale here to the engine/Mixer conventions.
 */
function dispatchAbsolute(target: AbsoluteAction['target'], value: number): void {
  switch (target.control) {
    case 'pitch':
      // Deck rate is the AUDIBLE surface's business (ADR 0022): in the
      // editor the conductor owns B's rate (tempo-match), so a hardware
      // pitch move there would fight the arrangement math (perpetual
      // drift-correct re-seeks). Dropped like any unregistered gesture;
      // mixer-class controls below stay live pass-throughs by design.
      if (audibleHolder() !== 'shared') return;
      deckControlsFor(target.deck)?.setPitch(bipolar(value) * PITCH_RANGE_PERCENT);
      return;
    case 'trim':
      midiMixerControls()?.setTrim(target.channel, value);
      return;
    case 'eq':
      midiMixerControls()?.setEq(target.channel, target.band, value);
      return;
    case 'filter':
      midiMixerControls()?.setFilter(target.channel, bipolar(value));
      return;
    case 'channel-fader':
      midiMixerControls()?.setFader(target.channel, value);
      return;
    case 'crossfader':
      midiMixerControls()?.setCrossfader(bipolar(value));
      return;
    case 'master':
      midiMixerControls()?.setMaster(value);
      return;
    case 'cue-level':
      midiMixerControls()?.setCueLevel(value);
      return;
    case 'cue-mix':
      midiMixerControls()?.setCueMix(value);
      return;
  }
}
