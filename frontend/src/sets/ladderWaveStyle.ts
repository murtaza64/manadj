// CPU/2D port of the Waveform style system for the Set overview ladder
// (sets 30). The ladder draws 40+ clip canvases — far past the browser's
// live-WebGL-context cap — so instead of the V2 shader it interprets the
// SAME style slots (waveform/styleSlots) on the CPU: same blob LOD
// pyramids, same amplitude math (dequant + displayGamma, group RMS, soft
// limit, master), same per-style color logic, same colors
// (params.colors ?? style defaults).
//
// Port fidelity (target: "recognizably the same style" at ~30px tall):
// - Every styleColor() variant in waveform/styles.ts has a hand-ported
//   twin in STYLE_PAINTERS below. If a style is added/changed there, this
//   module must follow (a registry-coverage test guards the id list).
// - Color is evaluated per COLUMN as piecewise-constant vertical segments
//   (each style's color is constant between its height thresholds), not
//   per pixel — exact for every current style, and cheap.
// Deliberate simplifications (vs WaveformRendererV2's body pass):
// - Columns are CSS pixels, not device pixels (matches the ladder's
//   previous drawing resolution).
// - Time is constant within a column (the shader's v_uv.x varies across a
//   device pixel; invisible at ladder scale) — transient-flux samples its
//   smoothed bands/flux at the column midpoint for the same reason.
// - No modulation pass (u_modTex — ladder clips are static previews).
// - The mirrored-lane layout supplies orientation; the style/slot anchor
//   is ignored (ladder layout wins — issue 30 constraint).
// - Body brightness matches the GL minimap's 0.55x dim (MINIMAP_BRIGHTNESS
//   below): the ladder renders the minimap slot, and full brightness read
//   as oversaturated next to the deck minimaps (review feedback 2026-07-05).

import type { DecodedWaveform, LodPack } from '../waveform/blob';
import type { RGB, StyleParams } from '../waveform/styles';
import { getStyle } from '../waveform/styles';

/** Shader background (BODY_PRELUDE's BG). */
const BG: RGB = [0.03, 0.03, 0.05];

/** One constant-color vertical run of a column; y in amplitude coords
 * (0 = baseline at the center line, 1 = full lane height). */
export interface WaveSegment {
  y0: number;
  y1: number;
  css: string;
}

export interface StyledColumn {
  /** Column start falls outside the track: fill with dimmed background. */
  outOfTrack: boolean;
  segments: WaveSegment[];
}

// ---------------------------------------------------------------- helpers

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x: number) => clamp(x, 0, 1);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** GLSL hsv2rgb port (waveform shader prelude). */
function hsv2rgb(h: number, s: number, v: number): RGB {
  const chan = (n: number) => {
    const frac = h + n - Math.floor(h + n);
    const p = Math.abs(frac * 6 - 3);
    return v * (1 + s * (clamp01(p - 1) - 1));
  };
  return [chan(0), chan(2 / 3), chan(1 / 3)];
}

/** Final pixel color: BG + (c - BG) * brightness, as a css string. */
function toCss(c: RGB, brightness: number): string {
  const ch = (i: number) =>
    Math.round(clamp01(BG[i] + (clamp01(c[i]) - BG[i]) * brightness) * 255);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

const isBg = (c: RGB) =>
  Math.abs(c[0] - BG[0]) < 1e-3 && Math.abs(c[1] - BG[1]) < 1e-3 && Math.abs(c[2] - BG[2]) < 1e-3;

// ---------------------------------------------------------------- sampler

/** Pick the pyramid level so a column covers <= 8 elements (shader's
 * lodLevel). */
function lodLevel(elemsPerPx: number, pack: LodPack): { level: number; scale: number } {
  let level = 0;
  let scale = 1;
  while (level < pack.numLevels - 1 && elemsPerPx / scale > 8) {
    level++;
    scale *= 4;
  }
  return { level, scale };
}

interface Sampler {
  peakColumn(t0: number, t1: number): number;
  bands8Column(t0: number, t1: number, out: Float64Array): void;
  bands8Smooth(t: number, w: number, secPerPx: number, out: Float64Array): void;
  transientFlux(t: number, secPerPx: number): number;
  groupAmps(b: Float64Array): [number, number, number];
}

/** CPU twin of the shader prelude's sampling/grouping functions, bound to
 * one decoded blob + one parameter set. */
function createSampler(d: DecodedWaveform, params: StyleParams): Sampler {
  const { sampleRate, peakHop, bandHop, stftWindow, gamma } = d.header;
  const invGamma = 1 / gamma;
  const smooth = params.smooth ? 1 : 0;
  /** De-quantize + display gamma (shader amp()). v in 0..1. */
  const amp = (v: number) => Math.pow(Math.pow(v, invGamma), params.displayGamma);

  const peakColumn = (t0: number, t1: number): number => {
    const pps = sampleRate / peakHop;
    const { level, scale } = lodLevel((t1 - t0) * pps, d.peaks);
    const count = d.peaks.levelCounts[level];
    const off = d.peaks.levelOffsets[level];
    const i0 = clamp(Math.floor((t0 * pps) / scale), 0, count - 1);
    const i1 = clamp(Math.floor((t1 * pps) / scale), i0, Math.min(i0 + 8, count - 1));
    let m = 0;
    for (let i = i0; i <= i1; i++) m = Math.max(m, d.peaks.data[off + i]);
    return amp(m / 255);
  };

  /** Linearly-interpolated band sample at one instant (shader bands8At). */
  const bands8At = (t: number, secPerPx: number, out: Float64Array): void => {
    const fps = sampleRate / bandHop;
    const { level, scale } = lodLevel(secPerPx * fps, d.bandsLo);
    const count = d.bandsLo.levelCounts[level];
    const off = d.bandsLo.levelOffsets[level];
    const fIdx = (t * sampleRate - stftWindow * 0.5) / bandHop / scale;
    const i0 = clamp(Math.floor(fIdx), 0, count - 1);
    const i1 = Math.min(i0 + 1, count - 1);
    const fr = clamp01(fIdx - i0) * smooth;
    const lo = d.bandsLo.data;
    const hi = d.bandsHi.data;
    for (let k = 0; k < 4; k++) {
      out[k] = amp((lo[(off + i0) * 4 + k] + (lo[(off + i1) * 4 + k] - lo[(off + i0) * 4 + k]) * fr) / 255);
      out[4 + k] = amp((hi[(off + i0) * 4 + k] + (hi[(off + i1) * 4 + k] - hi[(off + i0) * 4 + k]) * fr) / 255);
    }
  };

  /** Column-integrated band sample: box-filter mean (shader bands8Column). */
  const bands8Column = (t0: number, t1: number, out: Float64Array): void => {
    const fps = sampleRate / bandHop;
    const { level, scale } = lodLevel((t1 - t0) * fps, d.bandsLo);
    const x0 = (t0 * sampleRate - stftWindow * 0.5) / bandHop / scale;
    const x1 = (t1 * sampleRate - stftWindow * 0.5) / bandHop / scale;
    if (x1 - x0 < 1) {
      bands8At((t0 + t1) * 0.5, t1 - t0, out);
      return;
    }
    const count = d.bandsLo.levelCounts[level];
    const off = d.bandsLo.levelOffsets[level];
    const i0 = clamp(Math.floor(x0), 0, count - 1);
    const i1 = clamp(Math.floor(x1), i0, Math.min(i0 + 8, count - 1));
    const lo = d.bandsLo.data;
    const hi = d.bandsHi.data;
    const inv = 1 / (i1 - i0 + 1);
    for (let k = 0; k < 4; k++) {
      let sLo = 0;
      let sHi = 0;
      for (let i = i0; i <= i1; i++) {
        sLo += lo[(off + i) * 4 + k];
        sHi += hi[(off + i) * 4 + k];
      }
      out[k] = amp((sLo * inv) / 255);
      out[4 + k] = amp((sHi * inv) / 255);
    }
  };

  const scratchA = new Float64Array(8);
  const scratchB = new Float64Array(8);
  const scratchC = new Float64Array(8);

  /** Temporally-smoothed band sample (shader bands8Smooth). */
  const bands8Smooth = (t: number, w: number, secPerPx: number, out: Float64Array): void => {
    bands8At(t - w, secPerPx, scratchA);
    bands8At(t, secPerPx, scratchB);
    bands8At(t + w, secPerPx, scratchC);
    const ws = 0.25 * smooth;
    for (let i = 0; i < 8; i++) out[i] = ws * scratchA[i] + (1 - 2 * ws) * scratchB[i] + ws * scratchC[i];
  };

  /** Positive band-energy delta over ~60ms (shader transientFlux). */
  const transientFlux = (t: number, secPerPx: number): number => {
    bands8At(t, secPerPx, scratchA);
    bands8At(t - 0.06, secPerPx, scratchB);
    let f = 0;
    for (let i = 0; i < 8; i++) {
      f += Math.max(0, scratchA[i] - scratchB[i]) * (0.4 + (0.6 * i) / 7);
    }
    return f;
  };

  /** Soft-knee limiter (shader softLimit): linear below 0.6, asymptotic
   * to 1 above. */
  const softLimit = (x: number): number => {
    const knee = 0.6;
    return x <= knee ? x : knee + (1 - knee) * (1 - Math.exp(-(x - knee) / (1 - knee)));
  };

  /** Group RMS -> gains -> soft limit -> master (shader groupAmps). */
  const groupAmps = (b: Float64Array): [number, number, number] => {
    let e0 = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < 8; i++) {
      const e = b[i] * b[i];
      if (i < params.b1) e0 += e;
      else if (i < params.b2) e1 += e;
      else e2 += e;
    }
    return [
      softLimit(Math.sqrt(e0) * params.gains[0]) * params.master,
      softLimit(Math.sqrt(e1) * params.gains[1]) * params.master,
      softLimit(Math.sqrt(e2) * params.gains[2]) * params.master,
    ];
  };

  return { peakColumn, bands8Column, bands8Smooth, transientFlux, groupAmps };
}

// ---------------------------------------------------------------- styles

/** Everything a style's color function may consult for one column. */
interface ColumnCtx {
  /** Broadband peak, post-master, clamped. */
  p: number;
  /** Group heights, post-groupAmps, clamped. */
  g: [number, number, number];
  /** The 8 band amplitudes. */
  b: Float64Array;
  /** Previous column's p (additive-ticks). */
  pPrev: number;
  /** Smoothed group heights (transient-flux), else g. */
  gs: [number, number, number];
  /** Onset wedge height (transient-flux), else 0. */
  flux: number;
  colors: [RGB, RGB, RGB];
  params: StyleParams;
}

interface StylePainter {
  /** Height thresholds between which the color is constant. */
  cuts(c: ColumnCtx): number[];
  /** styleColor() twin: color at amplitude coordinate yA. */
  color(yA: number, c: ColumnCtx): RGB;
  /** Style needs bands8Smooth + transientFlux per column. */
  wantsFlux?: boolean;
  /** Style needs the previous column's peak. */
  wantsPrevPeak?: boolean;
}

function additiveRgb(yA: number, c: ColumnCtx): RGB {
  let r = BG[0];
  let g = BG[1];
  let b = BG[2];
  for (let i = 0; i < 3; i++) {
    if (yA < c.g[i]) {
      r += c.colors[i][0];
      g += c.colors[i][1];
      b += c.colors[i][2];
    }
  }
  return [Math.min(r, 1), Math.min(g, 1), Math.min(b, 1)];
}

const groupCuts = (c: ColumnCtx) => [c.g[0], c.g[1], c.g[2]];

const STYLE_PAINTERS: Record<string, StylePainter> = {
  'additive-rgb': { cuts: groupCuts, color: additiveRgb },

  'additive-soft': {
    cuts: groupCuts,
    color: (yA, c) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < 3; i++) {
        if (yA < c.g[i]) {
          r += c.colors[i][0];
          g += c.colors[i][1];
          b += c.colors[i][2];
        }
      }
      const over = clamp01(Math.max(r, g, b) - 1);
      let cr = Math.min(r, 1);
      let cg = Math.min(g, 1);
      let cb = Math.min(b, 1);
      if (over > 0) {
        const w = [c.g[0] * c.g[0], c.g[1] * c.g[1], c.g[2] * c.g[2]];
        const wSum = w[0] + w[1] + w[2] + 1e-6;
        const d = [0, 1, 2].map(
          (k) => (w[0] * c.colors[0][k] + w[1] * c.colors[1][k] + w[2] * c.colors[2][k]) / wSum,
        );
        const dMax = Math.max(d[0], d[1], d[2]) + 1e-6;
        const white = clamp01(c.params.coreWhite + c.params.coreBloom * over);
        const core = d.map((v) => v / dMax + (1 - v / dMax) * white);
        const t = smoothstep(0, 0.5, over);
        cr += (core[0] - cr) * t;
        cg += (core[1] - cg) * t;
        cb += (core[2] - cb) * t;
      }
      return [BG[0] + Math.min(cr, 1), BG[1] + Math.min(cg, 1), BG[2] + Math.min(cb, 1)];
    },
  },

  'additive-screen': {
    cuts: groupCuts,
    color: (yA, c) => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < 3; i++) {
        if (yA < c.g[i]) {
          r = 1 - (1 - r) * (1 - 0.82 * c.colors[i][0]);
          g = 1 - (1 - g) * (1 - 0.82 * c.colors[i][1]);
          b = 1 - (1 - b) * (1 - 0.82 * c.colors[i][2]);
        }
      }
      return [BG[0] + r, BG[1] + g, BG[2] + b];
    },
  },

  'layered-opaque': {
    cuts: (c) => [c.p, c.g[0], c.g[1], c.g[2]],
    color: (yA, c) => {
      let out: RGB = BG;
      if (yA < c.p) out = [0.15, 0.15, 0.2];
      if (yA < c.g[0]) out = c.colors[0];
      if (yA < c.g[1]) out = c.colors[1];
      if (yA < c.g[2]) out = c.colors[2];
      return out;
    },
  },

  'dominant-band': {
    cuts: (c) => [c.p],
    color: (yA, c) => {
      if (yA >= c.p) return BG;
      const w = [c.g[0] ** 3, c.g[1] ** 3, c.g[2] ** 3];
      const sum = w[0] + w[1] + w[2] + 1e-6;
      const energy = clamp01(Math.max(c.g[0], c.g[1], c.g[2]));
      const scale = 0.45 + 0.55 * energy;
      return [0, 1, 2].map(
        (k) =>
          ((w[0] * c.colors[0][k] + w[1] * c.colors[1][k] + w[2] * c.colors[2][k]) / sum) * scale,
      ) as RGB;
    },
  },

  'spectral-hue': {
    cuts: (c) => [c.p],
    color: (yA, c) => {
      if (yA >= c.p) return BG;
      let num = 0;
      let den = 1e-6;
      for (let i = 0; i < 8; i++) {
        num += i * c.b[i];
        den += c.b[i];
      }
      const hue = 0.72 * (num / den / 7);
      const total = clamp01(den * c.params.master * 0.6);
      return hsv2rgb(hue, 0.95, 0.35 + 0.65 * total);
    },
  },

  'transient-flux': {
    wantsFlux: true,
    cuts: (c) => [clamp01(c.gs[0]), clamp01(c.gs[1]), clamp01(c.flux)],
    color: (yA, c) => {
      let out: RGB = BG;
      if (yA < clamp01(c.gs[0])) out = c.colors[0];
      if (yA < clamp01(c.gs[1])) out = c.colors[1];
      if (yA < clamp01(c.flux)) out = c.colors[2];
      return out;
    },
  },

  'additive-ticks': {
    wantsPrevPeak: true,
    cuts: (c) => [c.g[0], c.g[1], c.g[2], c.p],
    color: (yA, c) => {
      const base = additiveRgb(yA, c);
      const rise = c.p - c.pPrev;
      if (rise > 0.15 && yA < c.p) {
        const t = clamp01((rise - 0.15) / 0.25);
        return [base[0] + (1 - base[0]) * t, base[1] + (1 - base[1]) * t, base[2] + (1 - base[2]) * t];
      }
      return base;
    },
  },
};

/** Style ids this module can paint — coverage-tested against the
 * registry so a new style can't silently fall back. */
export const PAINTABLE_STYLE_IDS = Object.keys(STYLE_PAINTERS);

// ---------------------------------------------------------------- render

/**
 * Interpret a style slot over one clip's track-time range as per-column
 * segment lists. `cols` columns spanning [t0, t1].
 */
export function computeStyledColumns(
  data: DecodedWaveform,
  styleId: string,
  params: StyleParams,
  t0: number,
  t1: number,
  cols: number,
  brightness = 1,
): StyledColumn[] {
  const style = getStyle(styleId);
  const painter = STYLE_PAINTERS[style.id] ?? STYLE_PAINTERS['additive-rgb'];
  const colors = params.colors ?? style.defaultColors;
  const sampler = createSampler(data, params);
  const px = Math.max(t1 - t0, 0.001) / cols;
  const b = new Float64Array(8);
  const gsScratch = new Float64Array(8);

  const out: StyledColumn[] = [];
  let pPrev = painter.wantsPrevPeak
    ? clamp01(sampler.peakColumn(t0 - px, t0) * params.master)
    : 0;
  for (let x = 0; x < cols; x++) {
    const tc = t0 + x * px;
    if (tc < 0 || tc > data.duration) {
      // Keep pPrev current across the gap (additive-ticks compares against
      // the immediately preceding column, like the shader's t - px sample).
      if (painter.wantsPrevPeak) {
        pPrev = clamp01(sampler.peakColumn(tc, tc + px) * params.master);
      }
      out.push({ outOfTrack: true, segments: [] });
      continue;
    }
    const p = clamp01(sampler.peakColumn(tc, tc + px) * params.master);
    sampler.bands8Column(tc, tc + px, b);
    const gRaw = sampler.groupAmps(b);
    const g: [number, number, number] = [clamp01(gRaw[0]), clamp01(gRaw[1]), clamp01(gRaw[2])];

    let gs = g;
    let flux = 0;
    if (painter.wantsFlux) {
      const tMid = tc + px * 0.5;
      sampler.bands8Smooth(tMid, 0.03, px, gsScratch);
      const gsRaw = sampler.groupAmps(gsScratch);
      gs = [gsRaw[0], gsRaw[1], gsRaw[2]];
      flux = sampler.transientFlux(tMid, px) * params.gains[2] * params.master * 1.6;
    }

    const ctx: ColumnCtx = { p, g, b, pPrev, gs, flux, colors, params };
    pPrev = p;

    // Piecewise-constant segments: evaluate the style at each interval's
    // midpoint between its sorted height thresholds.
    const cuts = painter
      .cuts(ctx)
      .map(clamp01)
      .filter((v) => v > 1e-4)
      .sort((a, z) => a - z);
    const segments: WaveSegment[] = [];
    let y = 0;
    for (const cut of cuts) {
      if (cut - y < 1e-5) continue;
      const rgb = painter.color((y + cut) / 2, ctx);
      if (!isBg(rgb)) segments.push({ y0: y, y1: cut, css: toCss(rgb, brightness) });
      y = cut;
    }
    out.push({ outOfTrack: false, segments });
  }
  return out;
}

/** The GL minimap's body dim (WaveformRendererV2 constructor: minimap mode
 * multiplies body brightness by 0.55 — markers stay full). The ladder
 * renders the same minimap slot, so it dims identically. */
export const MINIMAP_BRIGHTNESS = 0.55;

/** Canvas background matching the shader's BG. */
export const WAVE_BG_CSS = toCss(BG, 1);
const OUT_OF_TRACK_CSS = `rgb(${Math.round(BG[0] * 0.6 * 255)},${Math.round(
  BG[1] * 0.6 * 255,
)},${Math.round(BG[2] * 0.6 * 255)})`;

/**
 * Draw one clip's styled waveform into a 2D context. `dir` is the ladder's
 * mirrored-lane orientation: 'up' grows from the bottom edge (deck A,
 * above the center line), 'down' hangs from the top edge (deck B).
 */
export function drawStyledWave(
  ctx: CanvasRenderingContext2D,
  data: DecodedWaveform,
  styleId: string,
  params: StyleParams,
  opts: { width: number; height: number; dir: 'up' | 'down'; range: [number, number]; brightness?: number },
): void {
  const { width: w, height: h, dir } = opts;
  const [t0, t1] = opts.range;
  ctx.fillStyle = WAVE_BG_CSS;
  ctx.fillRect(0, 0, w, h);
  const columns = computeStyledColumns(data, styleId, params, t0, t1, w, opts.brightness ?? 1);
  for (let x = 0; x < w; x++) {
    const col = columns[x];
    if (col.outOfTrack) {
      ctx.fillStyle = OUT_OF_TRACK_CSS;
      ctx.fillRect(x, 0, 1, h);
      continue;
    }
    for (const seg of col.segments) {
      ctx.fillStyle = seg.css;
      const hgt = (seg.y1 - seg.y0) * h;
      ctx.fillRect(x, dir === 'up' ? h - seg.y1 * h : seg.y0 * h, 1, hgt);
    }
  }
}
