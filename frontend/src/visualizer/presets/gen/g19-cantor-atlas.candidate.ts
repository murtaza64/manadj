/**
 * "g19 cantor-atlas" (gen-19 NOVEL, nested-timescale abstract geometry —
 * SUBDIVISION JOURNEY: fractal depth as the long axis). A screen-tiling
 * 3x3 subdivision fractal (Cantor-carpet family): each cell subdivides; a
 * 9-bit VOID MASK decides which sub-cells carve out (escape, colored by
 * escape level) and which stay solid (recurse; deepest solid cells read as
 * tiles with dark grout).
 *
 * Nested timescales:
 *   BEAT    = one top-level cell accents (chroma rotation, luminance held),
 *             marching through the nine positions.
 *   BAR     = the COMPLEMENT LEVEL cycles — one recursion level renders its
 *             mask inverted; which level steps per bar (hard structural
 *             churn, distributed across the field, not a luminance flash).
 *   SECTION = the mask RE-ROLLS (a new subdivision rule = instantly
 *             different texture) + palette rotation; DEPTH steps along the
 *             ladder [1,2,2,3,3,4,4,5].
 *   EPOCH   = 128 bars: depth collapses back to 1, the mask table
 *             reshuffles, the palette family steps. Minute-1 is a coarse
 *             9-cell poster; minute-10 is depth-5 lace.
 *
 * Masks always keep the center solid with 5-7 solid bits (a spine to
 * recurse down). No zoom, no rotation — the only smooth motion is a slow
 * domain drift (translation) riding bandsSlow.mid. Kick = grout widens
 * (solid inset pump); snare = the complement level's escape cells brighten;
 * hats = grout-line glints. Flat fills, no feedback buffer. Mask ships as a
 * float bitfield (exp2/mod extraction — no dynamic uniform-array indexing
 * in GLSL ES 1.0 fragment shaders).
 */

import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

const SECTION_BARS = 16;
const EPOCH_SECTIONS = 8;
const EPOCH_BARS = SECTION_BARS * EPOCH_SECTIONS;
const DEPTH_LADDER = [1, 2, 2, 3, 3, 4, 4, 5];

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_depth;
uniform float u_mask;
uniform float u_flipLevel;
uniform vec2 u_drift;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_beatCell;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_fg;
uniform vec3 u_bg;

float bitAt(float m, float idx) {
  return mod(floor(m / exp2(idx)), 2.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / min(u_res.x, u_res.y) + u_drift;
  vec2 p = fract(uv);
  float escape = -1.0;
  float cell0 = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    if (fi < u_depth && escape < 0.0) {
      vec2 c = floor(p * 3.0);
      float idx = c.y * 3.0 + c.x;
      float b = bitAt(u_mask, idx);
      if (abs(fi - u_flipLevel) < 0.5) b = 1.0 - b;
      if (i == 0) cell0 = idx;
      if (b < 0.5) escape = fi;
      p = fract(p * 3.0);
    }
  }
  vec3 col;
  if (escape < -0.5) {
    // Solid to full depth: a tile with dark grout; kick widens the grout.
    float d = max(abs(p.x - 0.5), abs(p.y - 0.5));
    float grout = 0.44 - u_kick * 0.07;
    if (d > grout) {
      col = u_bg + vec3(u_hat * 0.25);
    } else {
      col = u_fg;
    }
  } else {
    float ci = mod(escape + cell0, 4.0);
    col = u_c0;
    if (ci > 0.5) col = u_c1;
    if (ci > 1.5) col = u_c2;
    if (ci > 2.5) col = u_c3;
    col *= 1.0 - 0.06 * escape;
    if (abs(escape - u_flipLevel) < 0.5) col += vec3(u_snare * 0.3);
  }
  if (abs(cell0 - u_beatCell) < 0.5) {
    col = mix(col, col.gbr, 0.45);
  }
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

/** A 9-bit void mask: center always solid, 5-7 solid bits total. */
function makeMask(r: () => number): number {
  const solidCount = 5 + Math.floor(r() * 3); // 5..7
  const idxs = [0, 1, 2, 3, 5, 6, 7, 8];
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = idxs[i];
    idxs[i] = idxs[j];
    idxs[j] = t;
  }
  let mask = 16; // bit 4 (center) solid
  for (let i = 0; i < solidCount - 1; i++) mask += Math.pow(2, idxs[i]);
  return mask;
}

/** Per-epoch mask table: one rule per section, reshuffled each epoch. */
function epochMasks(genomeSeed: number, epoch: number): number[] {
  const r = splitmix(genomeSeed ^ Math.imul(epoch + 1, 0x85ebca6b));
  const masks: number[] = [];
  for (let s = 0; s < EPOCH_SECTIONS; s++) masks.push(makeMask(r));
  return masks;
}

function createRenderer() {
  let driftX = 0;
  let driftY = 0;
  let kickEnv = 0;
  let snareEnv = 0;
  let hatEnv = 0;
  let pseudoBeat = 0;
  let seeded = false;
  let genomeSeed = 1;
  let genomeHue = 0;
  let dirX = 1;
  let dirY = 0.4;
  let masks: number[] = epochMasks(1, 0);
  let maskEpoch = -1;

  return createGlRenderer({
    fragment: FRAGMENT,
    uniforms: (frame) => {
      const dt = Math.min(0.1, Math.max(0, frame.dt));
      const bands = frame.bands;
      const slow = frame.bandsSlow ?? frame.bands;
      const energy = Math.min(1, bands.low * 0.5 + bands.mid * 0.3 + bands.high * 0.2);

      const trackId = dominantTrackId(frame);
      if (!seeded || (trackId != null && trackId !== genomeSeed)) {
        if (!seeded || trackId != null) {
          genomeSeed =
            trackId ??
            (Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1);
          const r = splitmix(genomeSeed);
          genomeHue = r() * 360;
          const angle = r() * Math.PI * 2;
          dirX = Math.cos(angle);
          dirY = Math.sin(angle);
          maskEpoch = -1;
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

      if (epoch !== maskEpoch) {
        masks = epochMasks(genomeSeed, epoch);
        maskEpoch = epoch;
      }
      const depth = DEPTH_LADDER[section];
      const mask = masks[section];
      // BAR: complement level cycles through -1 (clean), 0..depth-1.
      const flipLevel = mod(bar, depth + 1) - 1;
      // BEAT: top-level cell march.
      const beatCount = bar * 4 + Math.floor(barPhase * 4);
      const beatCell = mod(beatCount, 9);

      // Only smooth motion: slow drift riding bandsSlow.mid.
      const speed = (frame.params.drift ?? 1) * (0.006 + 0.035 * slow.mid);
      driftX += dt * speed * dirX;
      driftY += dt * speed * dirY;

      kickEnv = Math.max(kickEnv * Math.exp(-dt / 0.16), frame.impulse.low);
      snareEnv = Math.max(snareEnv * Math.exp(-dt / 0.18), frame.impulse.mid);
      hatEnv = Math.max(hatEnv * Math.exp(-dt / 0.1), frame.impulse.high);

      // Palette: epoch family + section rotation + slow centroid tilt.
      const base = genomeHue + epoch * 67 + section * 29 + (frame.centroid - 0.5) * 40;
      const c0 = hslRgb(base, 0.9, 0.5);
      const c1 = hslRgb(base + 45, 0.92, 0.52);
      const c2 = hslRgb(base + 160, 0.88, 0.48);
      const c3 = hslRgb(base + 205, 0.9, 0.52);
      const fg = hslRgb(base + 95, 0.95, 0.55);
      const bg = hslRgb(base + 230, 0.45, 0.05);

      return {
        u_depth: depth,
        u_mask: mask,
        u_flipLevel: flipLevel,
        u_drift: [mod(driftX, 1), mod(driftY, 1)] as [number, number],
        u_kick: kickEnv,
        u_snare: snareEnv,
        u_hat: hatEnv,
        u_beatCell: beatCell,
        u_c0: c0,
        u_c1: c1,
        u_c2: c2,
        u_c3: c3,
        u_fg: fg,
        u_bg: bg,
      };
    },
  });
}

const params: PresetParam[] = [
  { id: 'drift', label: 'drift speed', min: 0, max: 3, step: 0.05, default: 1 },
];

const g19CantorAtlasPreset: VisualizerPreset = {
  id: 'g19-cantor-atlas',
  name: 'g19 cantor-atlas',
  params,
  hiRes: true,
  create: createRenderer,
};

export default g19CantorAtlasPreset;
