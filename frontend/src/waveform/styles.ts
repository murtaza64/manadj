// Waveform styles (ADR 0015; glossary: "Waveform style").
//
// A style = a GLSL styleColor() variant + the shared tunable parameter set.
// All aesthetics live here as data; the renderer core has no look constants.
// Group colors are uniforms: params.colors overrides a style's defaults
// (spectral-hue derives its own colors and ignores them).

export type RGB = [number, number, number];

/** Shared tunable parameters — every style consumes this one set. */
export interface StyleParams {
  /** Extra display exponent applied to de-quantized amplitudes. */
  displayGamma: number;
  /** Master amplitude scale. */
  master: number;
  /** Low/mid/high group gains. (The flux style reads gains[2] as sensitivity.) */
  gains: [number, number, number];
  /** Bands [0..b1) form the low group. */
  b1: number;
  /** Bands [b1..b2) mid, [b2..8) high. */
  b2: number;
  /** Interpolate band frames (and smooth flux lobes); off = raw 12ms steps. */
  smooth: boolean;
  /** Low/mid/high group colors (0-1 RGB); null = the style's own defaults. */
  colors: [RGB, RGB, RGB] | null;
}

/** User-approved additive-RGB tuning (2026-07-04 prototype session).
 * master < 1 leaves headroom at the container edges: drops otherwise pin
 * heights to full height and bury cue/beatgrid markers (user feedback after
 * the issue-04 swap). */
export const DEFAULT_PARAMS: StyleParams = {
  displayGamma: 1.0,
  master: 0.85,
  gains: [0.7, 1.05, 1.5],
  b1: 3,
  b2: 5,
  smooth: true,
  colors: null,
};

export interface WaveformStyle {
  id: string;
  name: string;
  /** Group colors when params.colors is null. */
  defaultColors: [RGB, RGB, RGB];
  /** GLSL: vec3 styleColor(float yA, float p, vec3 g, float b[8]) */
  source: string;
}

export const DEFAULT_STYLE_ID = 'additive-rgb';

const ADDITIVE_COLORS: [RGB, RGB, RGB] = [
  [1.0, 0.1, 0.1],
  [0.0, 1.0, 0.25],
  [0.2, 0.45, 1.0],
];

/**
 * Built-in styles, all proven in the waveform-overhaul prototype. Each is a
 * ~20-line shader variant over the same data; keeping the losers costs
 * nothing until selected (programs compile lazily) and preserves the
 * exploration surface for the style panel.
 */
export const STYLE_REGISTRY: WaveformStyle[] = [
  {
    id: 'additive-rgb',
    name: 'Additive RGB',
    defaultColors: ADDITIVE_COLORS,
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = BG;
  if (yA < g.x) c += u_colorLow;
  if (yA < g.y) c += u_colorMid;
  if (yA < g.z) c += u_colorHigh;
  return min(c, vec3(1.0));
}`,
  },
  {
    id: 'additive-soft',
    name: 'Additive RGB, dominant core',
    defaultColors: ADDITIVE_COLORS,
    source: `
// Additive at the fringes; where groups overlap (drops), the core is
// recolored by the groups' ENERGY BALANCE at full brightness, not the raw
// channel sum — sum hues are palette artifacts (red+green = yellow no
// matter the music), while the dominant hue says what the drop is made of.
// Extreme stacking blooms gently toward white so "loud" still reads.
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = vec3(0.0);
  if (yA < g.x) c += u_colorLow;
  if (yA < g.y) c += u_colorMid;
  if (yA < g.z) c += u_colorHigh;
  float m = max(c.r, max(c.g, c.b));
  if (m > 1.0) {
    vec3 w = g * g;
    vec3 d = (w.x * u_colorLow + w.y * u_colorMid + w.z * u_colorHigh)
           / (w.x + w.y + w.z + 1e-6);
    d /= max(d.r, max(d.g, d.b)) + 1e-6;
    float bloom = clamp(0.35 * (m - 1.0), 0.0, 0.6);
    c = mix(d, vec3(1.0), bloom);
  }
  return BG + min(c, vec3(1.0));
}`,
  },
  {
    id: 'additive-screen',
    name: 'Additive RGB, screen blend',
    defaultColors: ADDITIVE_COLORS,
    source: `
// Screen-blended stacking: overlap brightens asymptotically, never slams
// into the clip ceiling — softer core than plain addition.
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = vec3(0.0);
  if (yA < g.x) c = 1.0 - (1.0 - c) * (1.0 - 0.82 * u_colorLow);
  if (yA < g.y) c = 1.0 - (1.0 - c) * (1.0 - 0.82 * u_colorMid);
  if (yA < g.z) c = 1.0 - (1.0 - c) * (1.0 - 0.82 * u_colorHigh);
  return BG + c;
}`,
  },
  {
    id: 'layered-opaque',
    name: 'Layered opaque (3Band)',
    defaultColors: [
      [0.08, 0.22, 1.0],
      [1.0, 0.56, 0.0],
      [1.0, 1.0, 1.0],
    ],
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = BG;
  if (yA < p) c = vec3(0.15, 0.15, 0.20);
  if (yA < g.x) c = u_colorLow;
  if (yA < g.y) c = u_colorMid;
  if (yA < g.z) c = u_colorHigh;
  return c;
}`,
  },
  {
    id: 'dominant-band',
    name: 'Dominant band',
    defaultColors: [
      [1.0, 0.15, 0.1],
      [0.1, 1.0, 0.25],
      [0.25, 0.55, 1.0],
    ],
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  if (yA >= p) return BG;
  vec3 w = g * g * g;
  float sum = w.x + w.y + w.z + 1e-6;
  vec3 c = (w.x * u_colorLow + w.y * u_colorMid + w.z * u_colorHigh) / sum;
  float energy = clamp(max(g.x, max(g.y, g.z)), 0.0, 1.0);
  return c * (0.45 + 0.55 * energy);
}`,
  },
  {
    id: 'spectral-hue',
    name: 'Spectral hue',
    defaultColors: ADDITIVE_COLORS, // unused: hue derives from spectral content
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  if (yA >= p) return BG;
  float num = 0.0;
  float den = 1e-6;
  for (int i = 0; i < 8; i++) { num += float(i) * b[i]; den += b[i]; }
  float spectralCenter = num / den / 7.0;
  float hue = mix(0.0, 0.72, spectralCenter);
  float total = clamp(den * u_master * 0.6, 0.0, 1.0);
  return hsv2rgb(vec3(hue, 0.95, 0.35 + 0.65 * total));
}`,
  },
  {
    id: 'transient-flux',
    name: 'Engine-ish transient (flux)',
    defaultColors: [
      [0.02, 0.3, 1.0],
      [0.0, 0.85, 0.3],
      [0.93, 1.0, 0.97], // the onset wedge
    ],
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  float t = u_startTime + v_uv.x * u_visibleSeconds;
  float bs[8];
  bands8Smooth(t, 0.03, bs);
  vec3 gs = groupAmps(bs);
  vec3 c = BG;
  if (yA < clamp(gs.x, 0.0, 1.0)) c = u_colorLow;
  if (yA < clamp(gs.y, 0.0, 1.0)) c = u_colorMid;
  float flux = transientFlux(t) * u_groupGains.z * u_master * 1.6;
  if (yA < clamp(flux, 0.0, 1.0)) c = u_colorHigh;
  return c;
}`,
  },
  {
    id: 'additive-ticks',
    name: 'Additive RGB + attack ticks',
    defaultColors: ADDITIVE_COLORS,
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = BG;
  if (yA < g.x) c += u_colorLow;
  if (yA < g.y) c += u_colorMid;
  if (yA < g.z) c += u_colorHigh;
  c = min(c, vec3(1.0));
  float t = u_startTime + v_uv.x * u_visibleSeconds;
  float px = u_visibleSeconds / u_canvasWidth;
  float pPrev = clamp(peakColumn(t - px, t) * u_master, 0.0, 1.0);
  float rise = p - pPrev;
  if (rise > 0.15 && yA < p) {
    c = mix(c, vec3(1.0), clamp((rise - 0.15) / 0.25, 0.0, 1.0));
  }
  return c;
}`,
  },
];

export function getStyle(id: string): WaveformStyle {
  return STYLE_REGISTRY.find((s) => s.id === id) ?? STYLE_REGISTRY[0];
}
