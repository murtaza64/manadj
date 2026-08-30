/**
 * Design tokens — THE single source of truth for the design system's
 * values (DESIGN.md; ADR 0031; gh#199).
 *
 * TS-first, not CSS-first, because half the app paints on canvas/WebGL,
 * which cannot read CSS custom properties. installTheme() (called once in
 * main.tsx, before mount) projects every token onto :root, so CSS keeps
 * consuming `var(--…)` exactly as before — styles/variables.css is
 * retired. TS/canvas consumers import the constants directly (hex, or
 * hexToGlFloats for the GL renderer).
 *
 * Rules (DESIGN.md): UI code never hardcodes a color literal — import a
 * token here (TS) or use `var(--…)` (CSS). New tokens are added here,
 * installed automatically, and documented in DESIGN.md.
 *
 * The one mirror that cannot import this file is
 * backend/hotcue_palette.py; tests/test_design_token_mirrors.py keeps it
 * honest (no comment discipline).
 */
import { DECK_COLORS, hexToRgbTriplet } from './deckColors';
import { ROUTINE_ACCENT, ROUTINE_ACCENT_INK, ROUTINE_ACCENT_RGB } from './routineColor';

// ── Neutrals ─────────────────────────────────────────────────────────────
// Pure grays (D2: the mostly-neutral look; Catppuccin's blue-tinted
// surfaces rejected). Text/overlays are deliberately slightly cool (D3).

/** Base backgrounds: app background, sunken panels, deepest chrome. */
export const BASE = '#1e1e1e';
export const MANTLE = '#181818';
export const CRUST = '#111111';

/** Canvas/waveform surface background (D2) — waveform surfaces sit darker
 * than UI panels. Replaces the #0b0b0b/#0b0b12/#0e0e0e scatter (gh#200/#201). */
export const VOID = '#0b0b0f';

/** Surfaces: panels, inputs, borders — ascending elevation. */
export const SURFACE0 = '#313136';
export const SURFACE1 = '#45454f';
export const SURFACE2 = '#58585b';

/** Text hierarchy (slightly cool on purpose). */
export const TEXT = '#cdd6f4';
export const SUBTEXT1 = '#bac2de';
export const SUBTEXT0 = '#a6adc8';

/** Overlays: disabled text, faint chrome, tick labels. */
export const OVERLAY0 = '#6c7086';
export const OVERLAY1 = '#7f849c';
export const OVERLAY2 = '#9399b2';

// ── Semantic accents (D4) — bright, fully saturated ─────────────────────

/** Generic interactive accent: selection, focus, links-as-actions.
 * Deliberately NOT Deck A's cyan (#00e5ff) — deck colors mean decks. */
export const ACCENT = '#4a9eff';
export const SUCCESS = '#00e676';
export const DANGER = '#ff2d55';
export const WARNING = '#ffcc00';
/** Machine orange: the Conductor's playheads, automation ghosts, the
 * alignment accent, and the Main cue marker (D6/D11). */
export const ORANGE = '#ff9500';

/** Transport playhead pink (D6) — the audible mix position, everywhere.
 * A named pastel exception (DESIGN.md): soft on purpose so it reads over
 * saturated waveform content without impersonating a hotcue. */
export const PLAYHEAD = '#f5c2e7';

// ── Hotcue slot palette (hotcue-colors 01; pastel rejected) ──────────────
// Fallback when a cue has no stored color. Consumed via
// hotcues/palette.cueCssColor (CSS/DOM) and as GL floats in
// WaveformRendererV2. Mirrored by backend/hotcue_palette.py (test-guarded).
export const HOT_CUE_CSS_COLORS: Record<number, string> = {
  1: '#1e90ff',
  2: '#ffd400',
  3: '#ff8800',
  4: '#ff4455',
  5: '#2ed573',
  6: '#ff5cc8',
  7: '#a855f7',
  8: '#00cec9',
};

// ── Stem kill-switch palette (stems #210) — bright, fully saturated,
// one identity per stem across every surface that will ever paint them
// (deck buttons now; lanes/viz later). Consumed as --stem-<name>.
export const STEM_COLORS = {
  vocals: '#ffd400',
  drums: '#ff4455',
  bass: '#a855f7',
  other: '#00cec9',
} as const;

// ── Energy gradient ──────────────────────────────────────────────────────
export const ENERGY_COLORS: Record<number, string> = {
  1: '#ffffcc',
  2: '#ffcc66',
  3: '#ff9933',
  4: '#ff4444',
  5: '#ff0000',
};

// ── Typography (D1) ──────────────────────────────────────────────────────

/** The app font. Declared once on body (styles/base.css); canvas code
 * builds ctx.font strings from this. Assumes local install; falls back to
 * generic monospace. */
export const FONT_MONO = "'UbuntuMono Nerd Font', monospace";

/** The 5-step scale + display (D1). 7/8/10/13px are abolished — rebucket
 * to the nearest step (knob labels → micro). */
export const FONT_SIZES = {
  micro: '9px', // canvas labels, cue numbers, tick labels, knob labels
  small: '11px', // dense tables, secondary text, badges
  body: '12px', // default UI text, buttons, inputs
  large: '14px', // section headers, emphasized values
  title: '16px', // pane/view titles
  display: '24px', // big readouts (BPM displays etc.)
} as const;

// ── Spacing (D8: 2px grid) ───────────────────────────────────────────────
export const SPACE_STEPS = [2, 4, 6, 8, 12, 16, 24] as const;

// ── Geometry (D5) ────────────────────────────────────────────────────────
/** 0 — flat geometric design. 50% stays legal for genuine circles (knob
 * dials, status dots). Any other rounding is a named DESIGN.md exception. */
export const RADIUS = '0';

// ── z-index tiers (D8) — cross-component layers only ────────────────────
// Local stacking inside a component keeps raw 1–5.
export const Z_TIERS = {
  sticky: 100,
  overlay: 1000,
  modal: 2000,
  toast: 3000,
} as const;

// ── Motion (D9: instant by default) ──────────────────────────────────────
// Transitions are named exceptions only (DESIGN.md); these tokens are the
// only legal durations.
export const TRANSITIONS = {
  fast: '0.1s ease',
  normal: '0.15s ease',
} as const;

// ── Derived forms ────────────────────────────────────────────────────────

/** '#rrggbb' → [r, g, b] 0–1 floats, for GL uniforms/vertex colors. */
export function hexToGlFloats(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

// ── The :root projection ─────────────────────────────────────────────────

/** Every CSS custom property the app may consume, assembled from the
 * constants above. Greppable: this map is the complete answer to "what
 * does var(--x) resolve to?". */
export const CSS_VARS: Record<string, string> = {
  // Base backgrounds
  '--base': BASE,
  '--mantle': MANTLE,
  '--crust': CRUST,
  '--void': VOID,

  // Surfaces
  '--surface0': SURFACE0,
  '--surface1': SURFACE1,
  '--surface2': SURFACE2,

  // Text hierarchy
  '--text': TEXT,
  '--subtext1': SUBTEXT1,
  '--subtext0': SUBTEXT0,

  // Overlays
  '--overlay0': OVERLAY0,
  '--overlay1': OVERLAY1,
  '--overlay2': OVERLAY2,

  // Semantic accents (+ rgb triplets for rgba(var(--x-rgb), α) washes)
  '--accent': ACCENT,
  '--accent-rgb': hexToRgbTriplet(ACCENT),
  '--success': SUCCESS,
  '--success-rgb': hexToRgbTriplet(SUCCESS),
  '--danger': DANGER,
  '--danger-rgb': hexToRgbTriplet(DANGER),
  '--warning': WARNING,
  '--warning-rgb': hexToRgbTriplet(WARNING),
  '--orange': ORANGE,
  '--orange-rgb': hexToRgbTriplet(ORANGE),
  '--playhead': PLAYHEAD,
  '--playhead-rgb': hexToRgbTriplet(PLAYHEAD),

  // Hotcue slots
  ...Object.fromEntries(
    Object.entries(HOT_CUE_CSS_COLORS).map(([slot, hex]) => [`--hc-${slot}`, hex]),
  ),
  ...Object.fromEntries(
    Object.entries(STEM_COLORS).map(([stem, hex]) => [`--stem-${stem}`, hex]),
  ),

  // Energy gradient
  ...Object.fromEntries(
    Object.entries(ENERGY_COLORS).map(([level, hex]) => [`--energy-${level}`, hex]),
  ),

  // Deck identity (CONTEXT.md: Deck color)
  ...Object.fromEntries(
    Object.entries(DECK_COLORS).flatMap(([deck, hex]) => [
      [`--deck-${deck.toLowerCase()}`, hex],
      [`--deck-${deck.toLowerCase()}-rgb`, hexToRgbTriplet(hex)],
    ]),
  ),

  // Routine accent (gh#170)
  '--routine-accent': ROUTINE_ACCENT,
  '--routine-accent-rgb': ROUTINE_ACCENT_RGB,
  '--routine-accent-ink': ROUTINE_ACCENT_INK,

  // Typography
  ...Object.fromEntries(
    Object.entries(FONT_SIZES).map(([step, size]) => [`--font-${step}`, size]),
  ),

  // Spacing
  ...Object.fromEntries(SPACE_STEPS.map((n) => [`--space-${n}`, `${n}px`])),

  // Geometry
  '--radius': RADIUS,

  // z tiers
  ...Object.fromEntries(Object.entries(Z_TIERS).map(([tier, z]) => [`--z-${tier}`, String(z)])),

  // Motion
  '--transition-fast': TRANSITIONS.fast,
  '--transition-normal': TRANSITIONS.normal,
};

/** Project every token onto :root. Called once at boot (main.tsx),
 * before React mounts — CSS never sees a missing var. */
export function installTheme(
  root: { style: { setProperty(name: string, value: string): void } } = document.documentElement,
): void {
  for (const [name, value] of Object.entries(CSS_VARS)) {
    root.style.setProperty(name, value);
  }
}
