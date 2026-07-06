import type { EqBand } from '../playback/graph';
import type { ChannelId } from '../playback/mixer';
import type { Track } from '../types';

/**
 * Module-level registry for non-transport Controller targets (midi-controller
 * 02+). Mirrors playback/audibleSurface.ts: the MIDI layer lives outside
 * React, so React-owned capabilities (hot-cue curation is React Query,
 * beatjump size is DeckProvider state, the Mixer lives in DeckProvider)
 * register handlers here and dispatch looks them up per action. Unregistered
 * targets drop silently, same as unmapped messages.
 *
 * Per ADRs 0013/0019 these stay aimed at the shared decks directly — never
 * through the audible-surface arbiter. Gesture-CLASS routing (transport,
 * pads, jumps, jog) goes through the arbiter in dispatch; what remains
 * registry-direct is state (mixer controls, beatjump size) plus the
 * handlers the audible surface's sections delegate back to. Since ADR
 * 0022 the editor plays through these same decks, so dispatch gates the
 * few registry-direct controls the conductor owns (pitch) on audibility.
 */

export interface MidiDeckControls {
  /** Press a hot cue pad: set-at-playhead when unset, jump/preview when set. */
  hotCueDown(pad: number): void;
  /** Release a hot cue pad: ends a hold-to-preview. */
  hotCueUp(pad: number): void;
  /** SHIFT+pad: delete the slot's hot cue (no-op when empty). */
  hotCueClear(pad: number): void;
  /** Jump by the deck's current beatjump size. */
  beatjump(direction: 'back' | 'forward'): void;
  /** Halve/double the deck's beatjump size (shared with on-screen controls). */
  beatjumpSize(change: 'halve' | 'double'): void;
  /** Absolute pitch in percent (±PITCH_RANGE_PERCENT; the engine clamps). */
  setPitch(percent: number): void;
  /** Stateless one-shot BPM match against the other deck (on-screen MATCH). */
  match(): void;
  /** Jog rim ticks (signed): bend when playing, seek when paused. */
  jogTicks(ticks: number): void;
  /** Jog touch-surface ticks (signed): fine seek when paused only. */
  jogTouchTicks(ticks: number): void;
  /** SHIFT+jog ticks (signed): deliberate fast seek, playing or paused. */
  jogSeekTicks(ticks: number): void;
}

/**
 * The active browse surface — whatever browse list is currently visible:
 * the mounted Library instance (any view), or the Set pane when a Set
 * replaces the track table (sets 33 — the Library yields while a Set is
 * viewed). Views without a browse surface simply leave this empty:
 * encoder/LOAD no-op (PRD scope decision).
 */
export interface MidiBrowseSurface {
  /** Move the selection up (-1) / down (+1), scrolling it into view. */
  navigate(delta: 1 | -1): void;
  getSelectedTrack(): Track | null;
  /**
   * Load a Track — with the EMBEDDING VIEW's policy (editor-midi 03, ADR
   * 0019): load policy is view-owned, not audibility-owned. The editor
   * assigns to the pair, the Performance view keeps its load lock (silent
   * refusal), the library view replaces freely.
   */
  load(deck: ChannelId, track: Track): void;
}

/**
 * The mixer surface — structurally a subset of playback/mixer.ts's Mixer,
 * so the registrar can register the Mixer instance itself. Values use the
 * Mixer's own conventions: 0..1 for trim/EQ/fader/master, -1..1 for
 * filter/crossfader (dispatch rescales the translator's 0..1).
 */
export interface MidiMixerControls {
  setTrim(channel: ChannelId, value: number): void;
  setEq(channel: ChannelId, band: EqBand, value: number): void;
  setFilter(channel: ChannelId, position: number): void;
  setFader(channel: ChannelId, value: number): void;
  setCrossfader(position: number): void;
  setMaster(value: number): void;
  /** PFL this channel into the Cue bus (headphone-cue 02). */
  togglePfl(channel: ChannelId): void;
  /** Cue bus volume, 0..1 (headphone-cue 03). */
  setCueLevel(value: number): void;
  /** Cue/mix blend, 0 (cue only) .. 1 (master only) (headphone-cue 03). */
  setCueMix(value: number): void;
}

const deckControls = new Map<ChannelId, MidiDeckControls>();
let mixerControls: MidiMixerControls | null = null;
// A stack, not a slot: views mount/unmount overlapping during switches;
// the most recently mounted surface wins and unregistration is orderless.
const browseSurfaces: MidiBrowseSurface[] = [];

/** Register a deck's controls; returns an unregister function. */
export function registerDeckControls(deck: ChannelId, controls: MidiDeckControls): () => void {
  deckControls.set(deck, controls);
  return () => {
    if (deckControls.get(deck) === controls) deckControls.delete(deck);
  };
}

export function deckControlsFor(deck: ChannelId): MidiDeckControls | null {
  return deckControls.get(deck) ?? null;
}

/** Register the mixer surface; returns an unregister function. */
export function registerMixerControls(controls: MidiMixerControls): () => void {
  mixerControls = controls;
  return () => {
    if (mixerControls === controls) mixerControls = null;
  };
}

export function midiMixerControls(): MidiMixerControls | null {
  return mixerControls;
}

/** Register the active browse surface; returns an unregister function. */
export function registerBrowseSurface(surface: MidiBrowseSurface): () => void {
  browseSurfaces.push(surface);
  return () => {
    const index = browseSurfaces.indexOf(surface);
    if (index !== -1) browseSurfaces.splice(index, 1);
  };
}

export function browseSurface(): MidiBrowseSurface | null {
  return browseSurfaces[browseSurfaces.length - 1] ?? null;
}

export function _resetMidiControlsForTests(): void {
  deckControls.clear();
  mixerControls = null;
  browseSurfaces.length = 0;
}
