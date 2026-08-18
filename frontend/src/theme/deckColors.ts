/**
 * Deck colors (deck-colors 01) — THE single source of truth for the
 * per-Deck identity colors (CONTEXT.md: Deck color). A cyan and B magenta
 * come from the Transition editor; C orange and D violet extend the set.
 * Identity only: state colors
 * (green = active, blue = accent) never denote a Deck.
 *
 * TS/canvas consumers import DECK_COLORS; CSS consumers use the variables
 * installed at boot (main.tsx), one pair per fixed Deck: `--deck-a` …
 * `--deck-d` (hex) and `--deck-a-rgb` … `--deck-d-rgb` (comma-separated
 * triplets, for `rgba(var(--deck-c-rgb), 0.14)` alpha washes).
 */
import { CHANNEL_IDS } from '../playback/mixer';
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

// ── HSV gradient stops (sessions 22: take-chip deck gradients) ──────────
// SVG interpolates gradients in sRGB, which drags two saturated deck
// colors through gray (cyan → magenta sags into murk). Sample the HSV
// path (hue via the shortest arc) into discrete stops instead — the blend
// stays fully saturated, matching the project's color language.

function hexToHsv(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 0xff) / 255;
  const g = ((v >> 8) & 0xff) / 255;
  const b = (v & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255);
  };
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(f(5))}${to2(f(3))}${to2(f(1))}`;
}

/** `steps` hex colors sampling the HSV interpolation from → to (hue via
 * the shortest arc; gray endpoints inherit the other side's hue). */
export function hsvGradientStops(from: string, to: string, steps = 9): string[] {
  const [h1, s1, v1] = hexToHsv(from);
  const [h2, s2, v2] = hexToHsv(to);
  // A gray endpoint has no meaningful hue: hold the other side's.
  const a = s1 === 0 ? h2 : h1;
  const b = s2 === 0 ? h1 : h2;
  const dh = ((b - a + 540) % 360) - 180;
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push(hsvToHex((a + dh * t + 360) % 360, s1 + (s2 - s1) * t, v1 + (v2 - v1) * t));
  }
  return out;
}

/** Install the CSS variables on the root element. Called once at boot. */
export function installDeckColorVars(
  root: { style: { setProperty(name: string, value: string): void } } = document.documentElement
): void {
  for (const deck of CHANNEL_IDS) {
    root.style.setProperty(`--deck-${deck.toLowerCase()}`, DECK_COLORS[deck]);
    root.style.setProperty(`--deck-${deck.toLowerCase()}-rgb`, hexToRgbTriplet(DECK_COLORS[deck]));
  }
}
