/**
 * The Performance view's two-handed key map (PRD decision) — one table
 * shared by the key bindings (DeckKeys) and the on-control kbd hints, so
 * they can't drift. Mirrored hands: left = Deck A, right = Deck B.
 *
 * Space is deliberately absent (unbound in the Performance view —
 * single-deck muscle-memory hazard, confirmed decision). Pads 5-8 are
 * mouse-only. No curation keys; beatgrid/mixer stay mouse-only.
 */
import type { ChannelId } from '../../playback/mixer';

export interface DeckKeyMap {
  /** Hold-cue (CDJ style). */
  cue: string;
  play: string;
  jumpBack: string;
  jumpForward: string;
  /** Hold-to-nudge (momentary bend). */
  nudgeBack: string;
  nudgeForward: string;
  /** Hot cue pads 1-4, in slot order. */
  pads: [string, string, string, string];
}

/** True while the user is typing somewhere keys must not be stolen from. */
export function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.contentEditable === 'true'
  );
}

/**
 * Library-hub-parity keydown guard: no keys while typing or with
 * ctrl/meta/alt. Keyups must NOT use this — releases have to land even if a
 * modifier went down mid-hold (input focus is the only keyup guard, exactly
 * like the library hub), or a held cue would stick.
 */
export function isGuardedKeyEvent(event: KeyboardEvent): boolean {
  return isTypingTarget(event) || event.ctrlKey || event.metaKey || event.altKey;
}

export const DECK_KEYS: Record<ChannelId, DeckKeyMap> = {
  A: {
    cue: 'f',
    play: 'd',
    jumpBack: 'a',
    jumpForward: 's',
    nudgeBack: 'w',
    nudgeForward: 'e',
    pads: ['z', 'x', 'c', 'v'],
  },
  B: {
    cue: 'j',
    play: 'k',
    jumpBack: 'l',
    jumpForward: ';',
    nudgeBack: 'i',
    nudgeForward: 'o',
    pads: ['m', ',', '.', '/'],
  },
};
