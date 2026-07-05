import { audibleTransport } from '../playback/audibleSurface';
import { PITCH_RANGE_PERCENT } from '../playback/tempo';
import type { MidiAction } from './actions';
import { browseSurface, deckControlsFor, midiMixerControls } from './controlRegistry';

/** Encoder detents per action are tiny; cap steps so a burst can't warp the
 * selection across the whole library in one message. */
const MAX_SELECTION_STEPS = 8;

/**
 * Thin glue, view-blind forever. Two routing classes (ADR 0013):
 *
 * - Transport-class gestures (transport, cue) go through the AUDIBLE
 *   SURFACE's transport — never to decks directly, never synthetic key
 *   events. The shared surface carries the library/performance guards; the
 *   Transition editor maps both PLAYs to its one mix transport and registers
 *   no cue handlers, so CUE drops there like keyboard F.
 *
 * - Everything else aims at the shared decks' registered controls
 *   (controlRegistry). While the editor is audible the shared decks are
 *   silenced and the engine's mayStart tripwire keeps stabs inert.
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
      deckControlsFor(target.deck)?.jogTicks(ticks);
      return;
    case 'jog-touch':
      deckControlsFor(target.deck)?.jogTouchTicks(ticks);
      return;
    case 'jog-seek':
      deckControlsFor(target.deck)?.jogSeekTicks(ticks);
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
      const controls = deckControlsFor(target.deck);
      if (edge === 'down') controls?.hotCueDown(target.pad);
      else controls?.hotCueUp(target.pad);
      return;
    }
    case 'hot-cue-clear': {
      if (edge !== 'down') return;
      deckControlsFor(target.deck)?.hotCueClear(target.pad);
      return;
    }
    case 'beatjump': {
      if (edge !== 'down') return;
      deckControlsFor(target.deck)?.beatjump(target.direction);
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
    case 'load': {
      if (edge !== 'down') return;
      const track = browseSurface()?.getSelectedTrack();
      if (!track) return; // no browse surface or no selection: no-op
      deckControlsFor(target.deck)?.load(track);
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
  }
}
