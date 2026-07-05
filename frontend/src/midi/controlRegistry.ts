import type { ChannelId } from '../playback/mixer';

/**
 * Module-level registry for non-transport Controller targets (midi-controller
 * 02+). Mirrors playback/audibleSurface.ts: the MIDI layer lives outside
 * React, so React-owned capabilities (hot-cue curation is React Query,
 * beatjump size is DeckProvider state) register handlers here and dispatch
 * looks them up per action. Unregistered targets drop silently, same as
 * unmapped messages.
 *
 * Per ADR 0013 these stay aimed at the shared decks directly — never through
 * the audible-surface arbiter. While the editor holds audibility the shared
 * decks are silenced and the engine's mayStart tripwire keeps stabs from
 * resuming audio, so no arbiter routing is needed here.
 */

export interface DeckPadControls {
  /** Press a hot cue pad: set-at-playhead when unset, jump/preview when set. */
  hotCueDown(pad: number): void;
  /** Release a hot cue pad: ends a hold-to-preview. */
  hotCueUp(pad: number): void;
  /** Jump by the deck's current beatjump size. */
  beatjump(direction: 'back' | 'forward'): void;
  /** Halve/double the deck's beatjump size (shared with on-screen controls). */
  beatjumpSize(change: 'halve' | 'double'): void;
}

const deckControls = new Map<ChannelId, DeckPadControls>();

/** Register a deck's pad controls; returns an unregister function. */
export function registerDeckControls(deck: ChannelId, controls: DeckPadControls): () => void {
  deckControls.set(deck, controls);
  return () => {
    if (deckControls.get(deck) === controls) deckControls.delete(deck);
  };
}

export function deckControlsFor(deck: ChannelId): DeckPadControls | null {
  return deckControls.get(deck) ?? null;
}

export function _resetMidiControlsForTests(): void {
  deckControls.clear();
}
