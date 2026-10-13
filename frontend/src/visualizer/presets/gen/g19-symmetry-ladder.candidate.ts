/**
 * "g19 symmetry-ladder" (gen-19 NOVEL, nested-timescale abstract geometry —
 * SYMMETRY ORDER as the long axis). A GL kaleidoscope whose angular fold
 * count climbs the ladder 1 -> 2 -> 3 -> 4 -> 6 -> 8 -> 12 -> 16, one step
 * per 16-bar section: every section boundary is a single-frame symmetry
 * jump (immediate contrast), and the ladder's climb across an 8-section
 * 128-bar epoch is the long evolution — minute-1 is a lone asymmetric
 * banner, minute-10 a dense 16-fold rose. EVEN epochs ascend, ODD epochs
 * descend, and each epoch swaps the palette bank (reversed + hue-shifted:
 * the rebuild reads inverted).
 *
 * Quantized grammar (hardcut lesson — quantized beats smooth):
 *   BEAT    = one wedge lights, marching around the rose (structural
 *             counter; chroma-leaning, luminance held).
 *   BAR     = ring registration shifts one hard step.
 *   PHRASE  = the banded motif re-rolls (hard cut, one frame).
 *   SECTION = fold order jumps along the ladder + motif layer count climbs
 *             (2 -> 6 across the epoch: late sections denser AND more
 *             symmetric).
 *   EPOCH   = ladder direction flips + palette bank swap.
 *
 * The ONLY smooth motion is a slow rotation riding bandsSlow.mid. Kick =
 * solid inward ring pump (impulse.low); snare = fold-seam flash; hats =
 * fine ring glints. Flat fills, no glow, no feedback buffer; center disc
 * held dark (no singular moire).
 */

import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

const FOLD_LADDER = [1, 2, 3, 4, 6, 8, 12, 16];
const LAYER_LADDER = [2, 3, 3, 4, 4, 5, 5, 6];
const SECTION_BARS = 16;
const EPOCH_SECTIONS = 8;
const EPOCH_BARS = SECTION_BARS * EPOCH_SECTIONS;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_fold;
uniform float u_rot;
uniform float u_seed;
uniform float u_barStep;
uniform float u_layers;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_beatWedge;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_bg;

const float TAU = 6.2831853;

float hash1(float x) {
  return fract(sin(x * 127.1) * 43758.5453);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float r = length(p) * 2.0;
  float ang = atan(p.y, p.x) + u_rot;
  float n = max(1.0, u_fold);
  float wedge = TAU / n;
  float am = mod(ang, TAU);
  float wedgeId = floor(am / wedge);
  float aw = mod(ang, wedge);
  float af = abs(aw - wedge * 0.5) / (wedge * 0.5);

  float rr = r - u_kick * 0.05;

  float idx = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi < u_layers) {
      float freq = 3.0 + fi * 2.5 + floor(hash1(u_seed + fi * 3.7) * 3.0);
      float chevron = (hash1(u_seed + fi * 13.1) - 0.5) * 5.0;
      float band = floor(
        rr * freq + af * chevron + u_barStep * (0.25 + 0.25 * fi) +
        hash1(u_seed * 1.7 + fi) * 7.0
      );
      idx += band * (1.0 + floor(hash1(u_seed + fi * 29.3) * 2.0));
    }
  }
  float ci = mod(idx, 4.0);
  vec3 col = u_c0;
  if (ci > 0.5) col = u_c1;
  if (ci > 1.5) col = u_c2;
  if (ci > 2.5) col = u_c3;

  if (abs(wedgeId - u_beatWedge) < 0.5) {
    col = mix(col, col.gbr, 0.4) + vec3(0.05);
  }

  float seam = smoothstep(0.9, 1.0, af);
  col += seam * u_snare * 0.4;

  float glint = step(0.94, fract(rr * 22.0 + hash1(u_seed) * 3.0));
  col += glint * u_hat * 0.22;

  float body = smoothstep(0.085, 0.1, r) * (1.0 - smoothstep(1.3, 1.7, r));
  col = mix(u_bg, col, body);
  col = min(col, vec3(1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function splitmix(key: number): () => number {
  let state = (Math.round(key) >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

function dominantTrackId(frame: VisualizerFrameData): number | null {
  const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (dom && dom.trackId != null) return dom.trackId;
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (!deck.playing || deck.trackId == null) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck.trackId;
    }
  }
  return best;
}

/** HSL → RGB triple in [0,1] (saturated committed banks, luminance parity). */
function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = mod(h, 360) / 30;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(mod(hh, 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hh < 1) rgb = [c, x, 0];
  else if (hh < 2) rgb = [x, c, 0];
  else if (hh < 3) rgb = [0, c, x];
  else if (hh < 4) rgb = [0, x, c];
  else if (hh < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

/** Four committed hues per epoch bank, luminance-par (L fixed); odd epochs
 * read inverted: order reversed + 180deg hue shift. */
function epochPalette(
  genomeHue: number,
  epoch: number,
  section: number
): [number, number, number][] {
  const inverted = mod(epoch, 2) === 1;
  const base = genomeHue + epoch * 53 + section * 9 + (inverted ? 180 : 0);
  const offsets = [0, 42, 165, 205];
  const colors = offsets.map((o) => hslRgb(base + o, 0.92, 0.52));
  if (inverted) colors.reverse();
  return colors as [number, number, number][];
}

function createRenderer() {
  let rot = 0;
  let kickEnv = 0;
  let snareEnv = 0;
  let hatEnv = 0;
  let pseudoBeat = 0;
  let seeded = false;
  let genomeSeed = 1;
  let genomeHue = 0;
  let dir = 1;

  return createGlRenderer({
    fragment: FRAGMENT,
    uniforms: (frame) => {
      const dt = Math.min(0.1, Math.max(0, frame.dt));
      const bands = frame.bands;
      const slow = frame.bandsSlow ?? frame.bands;
      const energy = Math.min(1, bands.low * 0.5 + bands.mid * 0.3 + bands.high * 0.2);

      const trackId = dominantTrackId(frame);
      const seedNow =
        trackId ??
        (Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1);
      if (!seeded || (trackId != null && trackId !== genomeSeed)) {
        if (!seeded || trackId != null) {
          genomeSeed = seedNow;
          const r = splitmix(genomeSeed);
          genomeHue = r() * 360;
          dir = r() < 0.5 ? 1 : -1;
          seeded = true;
        }
      }

      // Meter (ladder tiers; pseudo-meter fallback).
      const beat = frame.beat;
      const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
      let bar: number;
      let barPhase: number;
      if (beat && tierBar !== null) {
        bar = tierBar;
        barPhase = clamp01(beat.barPhase);
      } else {
        pseudoBeat += dt * (0.6 + 2.0 * energy);
        bar = Math.floor(pseudoBeat / 4);
        barPhase = clamp01(mod(pseudoBeat, 4) / 4);
      }
      const epoch = Math.floor(bar / EPOCH_BARS);
      const barInEpoch = mod(bar, EPOCH_BARS);
      const section = Math.floor(barInEpoch / SECTION_BARS);
      const ascending = mod(epoch, 2) === 0;
      const step = ascending ? section : EPOCH_SECTIONS - 1 - section;
      const fold = FOLD_LADDER[step];
      const layers = LAYER_LADDER[step];

      // PHRASE motif seed (hard re-roll every 4 bars, genome-anchored).
      const phrase = Math.floor(bar / 4);
      const seed = splitmix(genomeSeed ^ Math.imul(phrase + 1, 0x85ebca6b))() * 100 + 1;

      // BEAT wedge counter.
      const beatCount = bar * 4 + Math.floor(barPhase * 4);
      const beatWedge = mod(beatCount, Math.max(1, fold));

      // Only smooth motion: slow rotation riding bandsSlow.mid.
      const speed = frame.params.speed ?? 1;
      rot += dt * dir * speed * (0.03 + 0.2 * slow.mid);

      // Impulse envelopes (instant attack, fast decay).
      kickEnv = Math.max(kickEnv * Math.exp(-dt / 0.16), frame.impulse.low);
      snareEnv = Math.max(snareEnv * Math.exp(-dt / 0.18), frame.impulse.mid);
      hatEnv = Math.max(hatEnv * Math.exp(-dt / 0.1), frame.impulse.high);

      const [c0, c1, c2, c3] = epochPalette(genomeHue, epoch, section);
      const bg = hslRgb(genomeHue + epoch * 53 + 220, 0.4, 0.045);

      return {
        u_fold: fold,
        u_rot: rot,
        u_seed: seed,
        u_barStep: mod(bar, 4),
        u_layers: layers,
        u_kick: kickEnv,
        u_snare: snareEnv,
        u_hat: hatEnv,
        u_beatWedge: beatWedge,
        u_c0: c0,
        u_c1: c1,
        u_c2: c2,
        u_c3: c3,
        u_bg: bg,
      };
    },
  });
}

const params: PresetParam[] = [
  { id: 'speed', label: 'rotation speed', min: 0, max: 2.5, step: 0.05, default: 1 },
];

const g19SymmetryLadderPreset: VisualizerPreset = {
  id: 'g19-symmetry-ladder',
  name: 'g19 symmetry-ladder',
  params,
  hiRes: true,
  create: createRenderer,
};

export default g19SymmetryLadderPreset;
