/**
 * Deck colors (deck-colors 01) — THE single source of truth for the
 * per-Deck identity colors (CONTEXT.md: Deck color). A cyan, B magenta,
 * as established by the Transition editor. Identity only: state colors
 * (green = active, blue = accent) never denote a Deck.
 *
 * TS/canvas consumers import DECK_COLORS; CSS consumers use the variables
 * installed at boot (main.tsx): `--deck-a` / `--deck-b` (hex) and
 * `--deck-a-rgb` / `--deck-b-rgb` (comma-separated triplets, for
 * `rgba(var(--deck-b-rgb), 0.14)` alpha washes).
 */
import type { ChannelId } from '../playback/mixer';

export const DECK_COLORS: Record<ChannelId, string> = {
  A: '#00e5ff',
  B: '#ff2d95',
};

/** '#rrggbb' → 'r, g, b' (for rgba(var(--…-rgb), alpha) washes). */
export function hexToRgbTriplet(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}`;
}

/** Install the CSS variables on the root element. Called once at boot. */
export function installDeckColorVars(
  root: { style: { setProperty(name: string, value: string): void } } = document.documentElement
): void {
  for (const deck of ['A', 'B'] as const) {
    root.style.setProperty(`--deck-${deck.toLowerCase()}`, DECK_COLORS[deck]);
    root.style.setProperty(`--deck-${deck.toLowerCase()}-rgb`, hexToRgbTriplet(DECK_COLORS[deck]));
  }
}
