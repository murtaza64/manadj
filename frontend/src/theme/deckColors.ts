/**
 * Deck colors (deck-colors 01) — THE single source of truth for the
 * per-Deck identity colors (CONTEXT.md: Deck color). A cyan and B magenta
 * come from the Transition editor; C orange and D violet extend the set.
 * Identity only: state colors
 * (green = active, blue = accent) never denote a Deck.
 *
 * TS/canvas consumers import DECK_COLORS; CSS consumers use the variables
 * installed at boot by theme/tokens.ts installTheme(), one pair per fixed
 * Deck: `--deck-a` … `--deck-d` (hex) and `--deck-a-rgb` …
 * `--deck-d-rgb` (comma-separated triplets, for
 * `rgba(var(--deck-c-rgb), 0.14)` alpha washes).
 */
import type { ChannelId } from '../playback/mixer';

export const DECK_COLORS: Record<ChannelId, string> = {
  A: '#00e5ff',
  B: '#ff2d95',
  C: '#ff7a00',
  D: '#8f4dff',
};

/** '#rrggbb' → 'r, g, b' (for rgba(var(--…-rgb), alpha) washes). */
export function hexToRgbTriplet(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}`;
}
