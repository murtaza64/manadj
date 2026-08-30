/**
 * Domain markers — the shared 2D draw helpers, geometry, and tables for the
 * elements that ride on top of every waveform surface: hotcue flags, the
 * main-cue marker, the beatgrid tier tables, the playhead identity registry,
 * and the waveform-surface constants (DESIGN.md "Domain element specs" D11;
 * gh#201).
 *
 * Why a theme module and not per-surface literals: manadj paints the same
 * markers on the GL renderer, the CPU ladder port, three DOM/2D minimaps, the
 * routine timeline, the session replay, and the perf-diff diagnostic. Before
 * this module each surface grew its own copy of the geometry, the cue-color
 * fallback, and the tier weights — they drifted (a 13px flag here, a 16px one
 * there; a `c.color ?? …` that skipped validation; a stale 0.55 brightness
 * comment). One spec, imported everywhere, is the fix.
 *
 * Values live here (or in tokens.ts for colors); UI code imports, never
 * re-types. Colors come from tokens.ts via hex / hexToGlFloats — never a fresh
 * literal.
 */
import { ORANGE, PLAYHEAD, VOID, FONT_MONO, hexToGlFloats } from './tokens';
import { HOT_CUE_CSS_COLORS } from './tokens';

// ── Cue-color validation (single source) ─────────────────────────────────
// Stored cue colors are Engine-import hex, but not trusted — an arbitrary
// stored string must never reach a canvas/DOM fill. Every surface resolves a
// cue color through this one regex (was duplicated in hotcues/palette.ts and
// WaveformRendererV2.ts; OverviewLadder skipped it entirely — gh#201 item 2).
export const CUE_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** '#RRGGBB' → 0–1 float triple; null for anything else (caller falls back to
 * the slot palette). The GL renderer's cue path. */
export function parseCueColor(color: string | null | undefined): [number, number, number] | null {
  if (!color || !CUE_COLOR_RE.test(color)) return null;
  return hexToGlFloats(color);
}

// ── Cue flag geometry + draw (D11) ───────────────────────────────────────
// A cue flag is a 2px full-height pole flying a square flag off its top edge.
// Two variants, one shape language:
//   full — a 16px numbered square, slot number knocked out in dark ink.
//   mini — a 5×5 unnumbered square (minimaps / dense ladder rows).
// The ink is deliberately near-black so the number reads on any cue color.

/** Numbered-flag square edge (CSS px). */
export const CUE_FLAG_FULL_SIZE = 16;
/** Unnumbered minimap-flag square edge (CSS px). */
export const CUE_FLAG_MINI_SIZE = 5;
/** Pole width (CSS px), both variants. */
export const CUE_FLAG_POLE_W = 2;
/** Knockout ink for the slot number — near-black, reads on any cue color. */
export const CUE_FLAG_INK = 'rgb(17, 17, 17)';

export type CueFlagVariant = 'full' | 'mini';

export interface CueFlagOpts {
  /** Flag color (already resolved — cue hex or slot palette). */
  color: string;
  /** 'full' numbered square, or 'mini' unnumbered. */
  variant: CueFlagVariant;
  /** Full-height extent of the pole (CSS px). */
  height: number;
  /** Slot number for the 'full' variant's knockout label. */
  slot?: number;
  /** Which edge the flag flies off: 'top' (default) or 'bottom'. */
  edge?: 'top' | 'bottom';
  /** Device-pixel scale for crisp geometry on HiDPI GL overlays (default 1;
   * DOM/CSS-px surfaces leave it 1). */
  scale?: number;
}

/**
 * Draw one cue flag at pixel `x` into a 2D context: a `scale`-px pole spanning
 * the full height, plus the variant's flag square off the pole's top-right
 * (or bottom-right when `edge: 'bottom'`). The `full` variant knocks the slot
 * number out in dark ink using the app's mono font.
 *
 * The GL overlay draws its poles as shader rects (accumulated in the batch)
 * and calls this only for the numbered squares; every other surface draws the
 * whole flag here.
 */
export function drawCueFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  opts: CueFlagOpts,
): void {
  const s = opts.scale ?? 1;
  const size = (opts.variant === 'full' ? CUE_FLAG_FULL_SIZE : CUE_FLAG_MINI_SIZE) * s;
  const poleW = CUE_FLAG_POLE_W * s;
  const bottom = (opts.edge ?? 'top') === 'bottom';
  const squareY = bottom ? opts.height - size : 0;

  ctx.fillStyle = opts.color;
  // Pole centered on x.
  ctx.fillRect(x - poleW / 2, 0, poleW, opts.height);
  // Flag square off the pole's right edge.
  const squareX = x + poleW / 2;
  ctx.fillRect(squareX, squareY, size, size);

  if (opts.variant === 'full' && opts.slot !== undefined) {
    ctx.font = `bold ${CUE_FLAG_FULL_SIZE * 0.75 * s}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CUE_FLAG_INK;
    ctx.fillText(String(opts.slot), squareX + size / 2, squareY + size / 2);
    ctx.textAlign = 'left';
  }
}

// ── Main cue marker (D11) ────────────────────────────────────────────────
// The track's main cue: an orange 2px line with a bottom identity triangle.
// Same orange family as the Machine playhead — geometry disambiguates them
// (D11: chosen over recoloring). Orange comes from the --orange token.
export const MAIN_CUE_COLOR = ORANGE;
export const MAIN_CUE_COLOR_GL = hexToGlFloats(ORANGE);
/** Main-cue line width (CSS px). */
export const MAIN_CUE_LINE_W = 2;
/** Bottom-triangle half-width on minimaps (CSS px). */
export const MAIN_CUE_TRI_MINI_HALF = 5;
/** Bottom-triangle depth on minimaps (CSS px). */
export const MAIN_CUE_TRI_MINI_DEPTH = 8;

// ── Beatgrid tier tables (D11) ───────────────────────────────────────────
// Metric-ladder gridline styling as DATA: width (px) and alpha per tier,
// index 0 = bar … 4 = 16-bar boundary. Higher tiers escalate so phrase
// structure reads at a glance. Two intensity registers:
//   FULL — the waveform-body register (GL bodies, ladder wave rows). Bold.
//   DIM  — the lane-guide register (automation strips, session lanes). Sits
//          under breakpoints, so lighter.
// Every beat-domain surface renders tier-aware; dropping the hypermeter tiers
// silently (rendering only beat/downbeat) is a bug (gh#201 item 3).

export interface BeatTierTable {
  /** Per-tier line width (CSS px), index 0 = bar. */
  width: readonly number[];
  /** Per-tier alpha, index 0 = bar. */
  alpha: readonly number[];
  /** Weak-beat (sub-bar) line width + alpha. */
  weakWidth: number;
  weakAlpha: number;
}

/** Waveform-body register: bold gridlines on every waveform surface. */
export const BEAT_TIER_FULL: BeatTierTable = {
  width: [2, 2, 2.5, 3, 3.5],
  alpha: [0.3, 0.38, 0.48, 0.6, 0.75],
  weakWidth: 1,
  weakAlpha: 0.15,
};

/** Lane-guide register: dimmer, for automation/session lane strips. */
export const BEAT_TIER_DIM: BeatTierTable = {
  width: [1.5, 1.5, 2, 2.5, 3],
  alpha: [0.22, 0.28, 0.36, 0.45, 0.55],
  weakWidth: 1,
  weakAlpha: 0.09,
};

/** A tier's lines draw only when that tier's own spacing is at least this many
 * px (dpr-scaled): zoomed out, low tiers cull and only phrase-level lines
 * survive. */
export const TIER_MIN_SPACING_PX = 2.5;

/**
 * Resolve one gridline's width + alpha for a tier `position` relative to the
 * lowest visible level (0 = weak/thinnest, k > 0 = table[k−1]). The single
 * styling rule behind every tier-aware surface: the thinnest visible tier
 * wears the weak-beat style and the rest escalate from there, so zooming out
 * re-thins the surviving lines instead of leaving a wall of thick ones.
 */
export function beatTierStyle(
  position: number,
  table: BeatTierTable,
): { width: number; alpha: number } {
  if (position <= 0) return { width: table.weakWidth, alpha: table.weakAlpha };
  const i = Math.min(position - 1, table.width.length - 1);
  return { width: table.width[i], alpha: table.alpha[i] };
}

/** Metric-ladder authoring gold: Reset pennants and parenthetical
 * ("extra"/hypermeter) bars. Not a semantic token — an authoring accent that
 * marks metric fakeouts. Shared as an rgb triple and CSS string. */
export const LADDER_GOLD_GL: [number, number, number] = [1.0, 0.82, 0.4];
export const LADDER_GOLD_RGB = '255, 209, 102';

// ── Playhead identity registry (D6) ──────────────────────────────────────
// Every playhead color is a MEANING. Adding a playhead means picking a row,
// not a color (DESIGN.md "Playhead identity registry").
//   Transport — the audible mix position. Pink (--playhead).
//   Machine   — machine playback: the Conductor's position (editor + Set
//               ladder) and the session-replay position. Orange (--orange).
// Never a playhead: deck colors, --accent, white.

/** Transport playhead: the audible mix position. */
export const PLAYHEAD_TRANSPORT = PLAYHEAD;
export const PLAYHEAD_TRANSPORT_GL = hexToGlFloats(PLAYHEAD);

/** Machine playhead: Conductor + session-replay position. */
export const PLAYHEAD_MACHINE = ORANGE;
export const PLAYHEAD_MACHINE_GL = hexToGlFloats(ORANGE);

/**
 * Default fixed-playhead position as a fraction of the visible window in
 * follow mode (the playhead sits here; the waveform scrolls under it).
 * Per-surface overrides are legitimate and documented at their call site
 * (e.g. a 0 for a static comparison view, a 0.35 for a wider look-ahead) — but
 * they read this constant as the baseline instead of re-typing 0.25.
 */
export const PLAY_MARKER_FRACTION = 0.25;

// ── Waveform surface constants (D11) ─────────────────────────────────────

/** Canvas/GL waveform background, from the --void token. The GL body shader
 * derives its BG float from this; 2D surfaces fill with the CSS string. */
export const WAVE_BG_COLOR = VOID;
export const WAVE_BG_GL = hexToGlFloats(VOID);

/** GL minimap / CPU-ladder body dim: minimap mode multiplies body brightness
 * by this (markers stay full). The unplayed body reads brighter while the
 * played wash carries the contrast (performance-mode 09 review — 0.55 → 0.65;
 * the ladder renders the same minimap slot, so it dims identically). */
export const MINIMAP_BRIGHTNESS = 0.65;

/** Audibility / gain-fill alpha: a deck-color area chart behind a waveform row
 * at this alpha (session lanes, editor gain lanes, ladder). One constant so
 * the "how loud is this deck here" wash reads the same everywhere. */
export const AUDIBILITY_FILL_ALPHA = 0.16;

/** Resolve a cue color for GL float consumers: stored hex first, else the slot
 * palette, else white. Mirror of hotcues/palette.cueCssColor for the GL side. */
export function cueGlColor(slot: number, stored?: string | null): [number, number, number] {
  return (
    parseCueColor(stored) ??
    parseCueColor(HOT_CUE_CSS_COLORS[slot]) ??
    [1, 1, 1]
  );
}
