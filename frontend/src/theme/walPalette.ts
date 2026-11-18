/**
 * wal-palette/1 -> manaDJ theme overrides (wallpaper-theme, gh#470 / gh#471).
 *
 * PURE module: no IO, no DOM, no settings, no playback/session/capture
 * mutation. The caller (not this module) owns reading
 * ~/.cache/wal/palette.json, watching it for live updates, and applying the
 * returned overrides on top of the installed theme.
 *
 * Contract:
 *  - Strict schema: anything that is not a complete, well-formed
 *    wal-palette/1 document is REFUSED wholesale (never partially applied),
 *    so a missing/invalid palette always preserves a coherent existing theme.
 *  - mapWalPalette returns DETACHED CSS custom-property overrides (safe to
 *    layer over CSS_VARS) plus an optional deck-color proposal. Deck
 *    identities stay fixed by default; the proposal is only data until a
 *    user opts into the wallpaper-deck variant (mockup-labeled per gh#470).
 *  - Design rules (DESIGN.md / gh#470): neutrals (base/surface/text/canvas)
 *    are chroma-clamped in OKLCH at <= 0.02 so the look stays mostly-neutral;
 *    the accent is taken fully saturated; success/warning/danger/orange/
 *    playhead/hotcue/stem/energy semantics are NEVER overridden.
 */

export const WAL_PALETTE_VERSION = 'wal-palette/1' as const;

/** CSS custom-property overrides keyed by variable name. */
export type CssVarMap = Record<string, string>;

export interface WalPalette {
  version: typeof WAL_PALETTE_VERSION;
  colors: {
    background: string;
    foreground: string;
    cursor: string;
    /** color0..color15, ANSI order, each '#rrggbb'. */
    ansi: string[];
  };
}

export type WalPaletteRefusal =
  | 'not-an-object'
  | 'bad-version'
  | 'missing-colors'
  | 'incomplete-ansi'
  | 'invalid-color';

export type WalPaletteValidation =
  | { ok: true; palette: WalPalette }
  | { ok: false; reason: WalPaletteRefusal; detail: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function validateWalPalette(input: unknown): WalPaletteValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'not-an-object', detail: 'palette must be a JSON object' };
  }
  const doc = input as Record<string, unknown>;
  if (doc.version !== WAL_PALETTE_VERSION) {
    return {
      ok: false,
      reason: 'bad-version',
      detail: `version must be exactly "${WAL_PALETTE_VERSION}" (got ${JSON.stringify(doc.version)})`,
    };
  }
  const colors = doc.colors;
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    return { ok: false, reason: 'missing-colors', detail: 'colors object required' };
  }
  const c = colors as Record<string, unknown>;
  for (const key of ['background', 'foreground', 'cursor'] as const) {
    if (typeof c[key] !== 'string' || !HEX.test(c[key] as string)) {
      return { ok: false, reason: 'invalid-color', detail: `colors.${key} must be '#rrggbb'` };
    }
  }
  if (!Array.isArray(c.ansi) || c.ansi.length !== 16) {
    return { ok: false, reason: 'incomplete-ansi', detail: 'colors.ansi must hold exactly 16 entries' };
  }
  for (let i = 0; i < 16; i++) {
    if (typeof c.ansi[i] !== 'string' || !HEX.test(c.ansi[i])) {
      return { ok: false, reason: 'invalid-color', detail: `colors.ansi[${i}] must be '#rrggbb'` };
    }
  }
  // Detach: callers may mutate their copy; the mapper never retains theirs.
  return {
    ok: true,
    palette: {
      version: WAL_PALETTE_VERSION,
      colors: {
        background: (c.background as string).toLowerCase(),
        foreground: (c.foreground as string).toLowerCase(),
        cursor: (c.cursor as string).toLowerCase(),
        ansi: (c.ansi as string[]).map((v) => v.toLowerCase()),
      },
    },
  };
}

// ── OKLCH helpers (pure; Björn Ottosson's sRGB<->OKLab matrices) ─────────

interface Oklch { l: number; c: number; h: number }

function hexToOklch(hex: string): Oklch {
  const v = parseInt(hex.slice(1), 16);
  const srgb = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff].map((u) => {
    const s = u / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = srgb;
  const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l3 = Math.cbrt(l_), m3 = Math.cbrt(m_), s3 = Math.cbrt(s_);
  const L = 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3;
  const a = 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3;
  const b2 = 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3;
  return { l: L, c: Math.hypot(a, b2), h: (Math.atan2(b2, a) * 180) / Math.PI };
}

function oklchToHex({ l, c, h }: Oklch): string {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr), b2 = c * Math.sin(hr);
  const l3 = l + 0.3963377774 * a + 0.2158037573 * b2;
  const m3 = l - 0.1055613458 * a - 0.0638541728 * b2;
  const s3 = l - 0.0894841775 * a - 1.291485548 * b2;
  const l_ = l3 ** 3, m_ = m3 ** 3, s_ = s3 ** 3;
  const lin = [
    +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((x) => Math.min(1, Math.max(0, x)));
  const chan = lin.map((x) => {
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255);
  });
  return `#${chan.map((u) => u.toString(16).padStart(2, '0')).join('')}`;
}

/** Neutral-chroma clamp (gh#470: near-neutral canvas/surface/text, ~0.02). */
export const NEUTRAL_CHROMA_MAX = 0.02;

function clampChroma(hex: string, cMax: number): string {
  const o = hexToOklch(hex);
  if (o.c <= cMax) return hex.toLowerCase();
  return oklchToHex({ ...o, c: cMax });
}

/** Scale lightness toward a target, keeping hue/chroma (for derived steps). */
function withLightness(hex: string, l: number): string {
  const o = hexToOklch(hex);
  return oklchToHex({ ...o, l: Math.min(1, Math.max(0, l)) });
}

// ── The mapper ───────────────────────────────────────────────────────────

export interface WalThemeProposal {
  /**
   * Detached CSS overrides for the wallpaper-owned variables ONLY: the
   * neutral ramp (base/mantle/crust/void, surfaces, text, overlays) and the
   * generic accent (+ its -rgb triplet). Semantic state colors, deck
   * identities, hotcue/stem/energy sets are deliberately absent.
   */
  cssOverrides: Record<string, string>;
  /** Optional wallpaper-deck variant (gh#470: off by default, mockup-labeled
   * until contrast/CVD-verified). Keys are deck ids A..D. */
  deckProposal?: Record<'A' | 'B' | 'C' | 'D', string>;
}

export interface MapOptions {
  /** Include a deck-color proposal derived from the saturated ANSI colors. */
  withDeckProposal?: boolean;
}

function rgbTriplet(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return `${(v >> 16) & 0xff}, ${(v >> 8) & 0xff}, ${v & 0xff}`;
}

export function mapWalPalette(palette: WalPalette, opts: MapOptions = {}): WalThemeProposal {
  const { background, foreground, ansi } = palette.colors;

  // Neutral ramp: background-derived, chroma-clamped, manaDJ elevation steps.
  const base = clampChroma(background, NEUTRAL_CHROMA_MAX);
  const baseL = hexToOklch(base).l;
  const text = clampChroma(foreground, NEUTRAL_CHROMA_MAX);
  const textL = hexToOklch(text).l;

  // Fully saturated accent: pywal color4 (blue) is the conventional accent;
  // no chroma clamp on accents (DESIGN.md D4).
  const accent = ansi[4];

  const cssOverrides: Record<string, string> = {
    '--base': base,
    '--mantle': withLightness(base, Math.max(0, baseL - 0.03)),
    '--crust': withLightness(base, Math.max(0, baseL - 0.06)),
    '--void': withLightness(base, Math.max(0, baseL - 0.08)),
    '--surface0': withLightness(base, baseL + 0.09),
    '--surface1': withLightness(base, baseL + 0.16),
    '--surface2': withLightness(base, baseL + 0.22),
    '--text': text,
    '--subtext1': withLightness(text, textL - 0.08),
    '--subtext0': withLightness(text, textL - 0.16),
    '--overlay0': withLightness(text, textL - 0.4),
    '--overlay1': withLightness(text, textL - 0.33),
    '--overlay2': withLightness(text, textL - 0.26),
    '--accent': accent,
    '--accent-rgb': rgbTriplet(accent),
  };

  const proposal: WalThemeProposal = { cssOverrides };
  if (opts.withDeckProposal) {
    // Saturated, distinct ANSI slots; still a PROPOSAL — deck identities
    // remain fixed unless the user opts into the wallpaper-deck variant.
    proposal.deckProposal = { A: ansi[6], B: ansi[5], C: ansi[3], D: ansi[13] };
  }
  return proposal;
    }
