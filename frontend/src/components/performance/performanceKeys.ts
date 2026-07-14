/**
 * The Performance view's two-handed key map (PRD decision) — one table
 * shared by the key bindings (DeckKeys) and the on-control kbd hints, so
 * they can't drift. Its two entries are the two HANDS, not two Decks: the
 * left hand's keys and the right hand's mirrored keys. Which physical Deck
 * a hand drives is Control focus, not the key map — the left hand follows
 * A↔C and the right hand B↔D. The map stays two-valued because a keyboard
 * has two hands; four Decks are reached by re-focusing, never by more keys.
 *
 * Space is deliberately absent (unbound in the Performance view —
 * single-deck muscle-memory hazard, confirmed decision). Pads 5-8 are
 * mouse-only. No curation keys; beatgrid/mixer stay mouse-only.
 */
export interface DeckKeyMap {
  /** Hold-cue (CDJ style). */
  cue: string;
  play: string;
  jumpBack: string;
  jumpForward: string;
  /** Hold-to-nudge (momentary bend). */
  nudgeBack: string;
  nudgeForward: string;
  /** Auto-loop engage/release toggle (looping 03). */
  loop: string;
  /** Hot cue pads 1-4, in slot order. */
  pads: [string, string, string, string];
}

export const CONTROL_FOCUS_KEYS = { left: '[', right: ']' } as const;

import type { ChannelId } from '../../playback/mixer';
import type { ControlFocus } from '../../performance/controlFocus';

/**
 * The Performance browse surface's focus-aware Load target (issue 22): the
 * key decides a side, Control focus decides which physical Deck that side
 * currently addresses. ← / Enter target the focused left Deck (A or C), →
 * the focused right Deck (B or D). Any other key is not a Load key → null.
 * Pure so the A–D routing is testable without a DOM (ADR 0002); the view
 * feeds the result through its single load-lock path.
 */
export function browseLoadTarget(key: string, focus: ControlFocus): ChannelId | null {
  if (key === 'ArrowLeft' || key === 'Enter') return focus.left;
  if (key === 'ArrowRight') return focus.right;
  return null;
}

/** INPUT types that take typed text (keyboard-focus 01: a focused
 * checkbox/radio/range must NOT silence the hubs — the no-focus rule
 * keeps them from focusing at all; this guard makes any leak non-fatal). */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'url', 'email', 'password']);

/** True while the user is typing somewhere keys must not be stolen from. */
export function isTypingTarget(event: KeyboardEvent): boolean {
  return isTextEntryTarget(event.target);
}

/** The predicate behind isTypingTarget, on the target itself (testable). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.tagName === 'TEXTAREA') return true;
  if ((target as HTMLElement).contentEditable === 'true') return true;
  return target.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
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

// The two keys are the left/right HAND layouts, not Deck A/B: 'A' is the
// left-hand map (driving the A↔C-focused Deck), 'B' the right-hand map
// (driving B↔D). DeckKeys/DeckPanel pick a hand from the scope's side.
export const DECK_KEYS: Record<'A' | 'B', DeckKeyMap> = {
  A: {
    cue: 'f',
    play: 'd',
    jumpBack: 'a',
    jumpForward: 's',
    nudgeBack: 'w',
    nudgeForward: 'e',
    loop: 'r',
    pads: ['z', 'x', 'c', 'v'],
  },
  B: {
    cue: 'j',
    play: 'k',
    jumpBack: 'l',
    jumpForward: ';',
    nudgeBack: 'i',
    nudgeForward: 'o',
    loop: 'u',
    pads: ['m', ',', '.', '/'],
  },
};
