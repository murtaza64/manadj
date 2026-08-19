/**
 * "g08 odyssey-ink" (gen-8, MEDIUM REPLACEMENT of odyssey's dust wash).
 *
 * The screenshot proved the voyage/odyssey family all reads as the same
 * translucent fine-dust feedback wash. This candidate keeps odyssey's
 * phrase/section THEATRE skeleton (genome mutates on metric boundaries)
 * but REPLACES the medium: instead of gas, it is THICK OPAQUE BILLOWING
 * INK — dense rolling clouds with SHARP defined edges, high absorption,
 * strong edge gradients. Advected feedback is the engine (ink language
 * raided from g01-ink-vortex) but the LOOK is heavy strokes, not a wash.
 *
 * The anti-wash technique: the feedback field carries an ink DENSITY in
 * the alpha-like luminance; every frame the density is passed through a
 * hard smoothstep so mid densities snap to either "solid ink" or "clear",
 * producing sharp billow boundaries instead of a soft gradient haze. Mass
 * is injected in THICK strokes at a few moving points, not sprayed.
 *
 * Band mapping (law: LOWS = mass, MIDS = color, HIGHS = edge detail):
 *   LOWS  → ink density / mass injection amount (bass = thick heavy ink).
 *   MIDS  → ink COLOR (committed crimson/cyan duo-chrome identity; the
 *           palette param swaps among 3 committed duos — never blue-wash).
 *   HIGHS → fine tendril curl detail at billow EDGES only.
 *
 * Transients / structure:
 *   kick     → a pressure burst PUNCHES a clearing through the ink: the
 *              impact is NEGATIVE SPACE (light shows where ink ISN'T).
 *   snare    → a sharp ink flick curls off a billow (localized stroke).
 *   beat     → the injection points advance around the frame on a
 *              QUANTIZED grid (beat.ladderBarIndex ?? beat.barIndex + phase).
 *   drop     → the ink BOILS (fast billowing everywhere) riding
 *              max(drop, energy).
 *   buildup  → the ink THICKENS and slows (dread).
 *   section  → odyssey transformation: the ink INVERTS — a light field with
 *              dark ink flips to a dark field with luminous ink.
 *
 * Palette duos (committed, MIDS param swaps among the three):
 *   0 crimson / cyan   (identity)
 *   1 orange / violet
 *   2 magenta / lime
 *
 * Hard rules honoured: GLSL ES 1.0, no backticks in GLSL, injection-point
 * arrays are flat u_-arrays read with a constant-index loop; chroma-
 * preserving soft knee (ink especially — never per-channel clamp);
 * photosafe (no full-field strobe; the kick clearing is localized negative
 * space, the inversion crossfades over a bar); bright saturated colors.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { UniformValue } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

/** Number of ink injection points that walk the quantized beat grid. */
const INJECT_N = 4;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_boil;         // billow speed (drop = boils)
uniform float u_thick;        // buildup = thick/slow dread
uniform float u_invert;       // 0 dark-ink/light-field .. 1 luminous-ink/dark
uniform float u_edgeCurl;     // HIGHS: tendril curl detail at edges
uniform float u_beatPump;
uniform vec2 u_punch;         // kick pressure-burst center (negative space)
uniform float u_punchAge;     // seconds since the burst
uniform float u_punchAmp;
uniform vec2 u_flick;         // snare ink-flick origin
uniform float u_flickAge;
uniform vec3 u_inkA;          // MIDS: committed duo, ink color A
uniform vec3 u_inkB;          // committed duo, ink color B
uniform vec2 u_inject[4];     // flat injection-point array (beat grid)

const float PI = 3.141592653589793;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// Constant-index lookup into the flat injection-point array (GLSL ES 1.0
// forbids dynamic indexing of a uniform array).
vec2 injectAt(int idx) {
  vec2 v = vec2(0.5);
  for (int k = 0; k < 4; k++) {
    if (k == idx) v = u_inject[k];
  }
  return v;
}

vec2 toField(vec2 uv) {
  vec2 c = uv - 0.5;
  c.x *= u_res.x / u_res.y;
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 field = toField(uv);
  float r = length(field);
  float ang = atan(field.y, field.x);
  float t = u_time;

  // ---- Advection: a slow rolling billow field. A curl-noise velocity
  // carries the ink so it TUMBLES and folds (rolling clouds), sped up when
  // the drop boils, slowed and thickened in a buildup. NOT a radial vortex
  // wash — the motion is turbulent and mass-preserving-looking.
  float boil = 0.15 + 1.3 * u_boil;
  vec2 curl = vec2(
    fbm(field * 2.4 + vec2(0.0, t * boil * 0.3)) - 0.5,
    fbm(field * 2.4 + vec2(5.3, 1.7) - t * boil * 0.27) - 0.5
  );
  // A gentle overall roll so billows migrate across the frame.
  vec2 roll = vec2(0.05 + 0.1 * u_drop, 0.02) * (1.0 - 0.6 * u_thick);
  vec2 vel = (curl * (0.9 + 1.6 * u_boil) + roll) * (1.0 - 0.5 * u_thick);
  vec2 srcField = field - vel * u_dt * 1.6;
  vec2 srcUv = vec2(srcField.x / aspect, srcField.y) + 0.5;

  // Sample the previous ink. Slight chroma split at edges for wet sheen.
  vec2 dirW = r > 1e-4 ? field / r : vec2(0.0);
  vec2 ab = dirW * (0.001 + 0.004 * u_kick) / vec2(aspect, 1.0);
  vec3 prevInk = vec3(
    texture2D(u_prev, srcUv + ab).r,
    texture2D(u_prev, srcUv).g,
    texture2D(u_prev, srcUv - ab).b
  );
  vec3 ink = prevInk * u_decay;

  // ---- THICK STROKE injection at the quantized points. Each point lays a
  // dense opaque blob (not a spray) whose color is the committed duo. Bass
  // drives the mass; the blobs stack into heavy billows.
  float inject = 0.0;
  vec3 injectCol = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 p = toField(injectAt(k));
    float d = length(field - p);
    // A thick core + a rolling skirt textured by fbm so the stroke edge is
    // ragged (billowing), not a clean circle.
    float skirt = fbm(field * 5.0 + float(k) * 7.3 + t * boil * 0.2);
    float blob = exp(-pow(d * 5.5, 2.0)) + 0.5 * exp(-pow((d - 0.04 * skirt) * 4.0, 2.0));
    float amt = blob * (0.15 + 1.4 * u_low) * (0.6 + 0.6 * u_drop);
    inject += amt;
    // Alternate the two duo colors across the points so both stay present.
    float sel = 0.5 + 0.5 * sin(float(k) * 2.4 + t * 0.3 * (0.4 + u_mid) + u_centroid * 2.0);
    injectCol += mix(u_inkA, u_inkB, sel) * amt;
  }
  if (inject > 1e-4) injectCol /= inject;
  ink += injectCol * inject;

  // ---- HARD EDGE: pass the accumulated density through a steep smoothstep
  // so mid densities snap to solid-or-clear. THIS is the anti-wash step:
  // billows get sharp defined boundaries instead of a translucent gradient.
  float dens = max(ink.r, max(ink.g, ink.b));
  float edgeLo = 0.14 + 0.05 * u_thick;
  float edgeHi = edgeLo + 0.14 - 0.06 * u_high; // highs tighten the edge
  float solid = smoothstep(edgeLo, edgeHi, dens);
  // Reconstruct the ink at full saturation where it is solid; the field
  // between billows goes fully clear (opaque mass, sharp edges).
  vec3 inkHue = dens > 1e-4 ? ink / dens : u_inkA;
  ink = inkHue * solid * dens;

  // ---- HIGHS: fine tendril curl detail at the EDGES only (where solid
  // transitions clear). A high-freq curl noise modulates the boundary.
  float edgeBand = solid * (1.0 - solid) * 4.0; // peaks on the boundary
  float tendril = fbm(field * (16.0 + 20.0 * u_edgeCurl) + t * 0.8 + ang * 3.0);
  ink += inkHue * edgeBand * pow(tendril, 2.5) * u_edgeCurl * (0.4 + 1.2 * u_high);

  // ---- KICK: a pressure burst PUNCHES a clearing — NEGATIVE SPACE as the
  // impact. Ink is carved away in an expanding ring; light shows through
  // where the ink is gone. This is the bass response (solid, not powder).
  float punchR = 0.02 + u_punchAge * 0.9;
  vec2 pf = toField(u_punch);
  float pd = length(field - pf);
  float clearing = exp(-pow((pd - punchR) * 5.0, 2.0)) * exp(-u_punchAge * 2.2) * u_punchAmp;
  // Carve: remove ink in the clearing (the hole), and rim it with a bright
  // pressure edge so the negative space reads as an impact, not a fade.
  ink *= 1.0 - clamp(clearing * 1.6, 0.0, 1.0);
  ink += mix(u_inkA, vec3(1.0), 0.6) * exp(-pow((pd - punchR) * 22.0, 2.0))
    * exp(-u_punchAge * 2.2) * u_punchAmp * 0.8;

  // ---- SNARE: a sharp ink flick curling off a billow (a thin stroke).
  vec2 ff = toField(u_flick);
  vec2 fd = field - ff;
  float fang = atan(fd.y, fd.x);
  float flickCurl = exp(-pow((length(fd) - 0.06) * 16.0, 2.0))
    * pow(0.5 + 0.5 * sin(fang * 5.0 + u_seed), 3.0)
    * exp(-u_flickAge * 5.0);
  ink += mix(u_inkB, vec3(1.0), 0.4) * flickCurl * 1.3;

  // ---- SECTION INVERSION (odyssey transformation): crossfade between
  // "dark ink on a lit field" and "luminous ink on a dark field". u_invert
  // eases across a bar so it is a theatrical flip, never a strobe.
  float inkLuma = max(ink.r, max(ink.g, ink.b));
  // Normal render: bright background, ink darkens it (subtractive feel).
  vec3 litField = mix(u_inkA * 0.15 + 0.08, vec3(0.02), inkLuma) + ink * 0.4;
  // Inverted render: black field, ink glows.
  vec3 darkField = ink * (1.2 + 0.6 * u_sustain);
  vec3 shown = mix(darkField, litField, u_invert);

  // Beat pump + drop bloom / buildup dim, riding max(drop, sustain).
  shown *= 1.0 + 0.06 * u_beatPump;
  shown *= 0.72 + 0.5 * max(u_drop, u_sustain) - 0.14 * u_buildup;

  // ---- Chroma-preserving soft knee (INK especially — a per-channel clamp
  // would desaturate the crimson/cyan into a wash; compress luma, keep hue).
  float m = max(shown.r, max(shown.g, shown.b));
  if (m > 0.82) {
    shown *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }

  // Store the raw ink density (not the shown composite) so the feedback
  // buffer keeps advecting the mass regardless of the inversion state.
  // gl_FragColor.rgb is what the copy pass shows AND what u_prev reads next
  // frame; blend so the medium persists but the presentation is the shown.
  vec3 outCol = mix(ink, shown, 0.6);
  gl_FragColor = vec4(max(outCol, 0.0), 1.0);
}
`;

type Rgb = [number, number, number];

/** Three committed duo-chrome ink pairs [A, B]. Bright, fully saturated. */
const DUOS: [Rgb, Rgb][] = [
  [[1.0, 0.08, 0.18], [0.05, 0.9, 1.0]], // 0 crimson / cyan (identity)
  [[1.0, 0.45, 0.0], [0.6, 0.1, 1.0]], // 1 orange / violet
  [[1.0, 0.1, 0.8], [0.55, 1.0, 0.1]], // 2 magenta / lime
];

export const g08OdysseyInkPreset: VisualizerPreset = {
  id: 'g08-odyssey-ink',
  name: 'g08 odyssey-ink',
  hiRes: true,
  params: [
    { id: 'mass', label: 'ink mass (bass drive)', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'duo (0 crimson/cyan, 1 orange/violet, 2 magenta/lime)', min: 0, max: 2, step: 1, default: 0 },
    { id: 'trail', label: 'ink persistence', min: 0.5, max: 1.2, step: 0.05, default: 1 },
    { id: 'curl', label: 'edge tendril detail', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;

    // Injection points walking the quantized beat grid.
    const inject = new Float32Array(INJECT_N * 2);
    for (let k = 0; k < INJECT_N; k++) {
      const a = (k / INJECT_N) * Math.PI * 2;
      inject[k * 2] = 0.5 + Math.cos(a) * 0.22;
      inject[k * 2 + 1] = 0.5 + Math.sin(a) * 0.22;
    }
    let gridStep = 0; // advances one notch per beat
    let prevBeatCount: number | null = null;

    // Drop / buildup.
    let smoothDrop = 0;
    let smoothBuildup = 0;

    // Section inversion genome.
    let invertTarget = 0;
    let invert = 0;
    let prevSectionTier: number | null = null;

    // Kick pressure burst (negative-space clearing).
    const punch: [number, number] = [0.5, 0.5];
    let punchAge = 99;
    let punchAmp = 0;

    // Snare flick.
    const flick: [number, number] = [0.5, 0.5];
    let flickAge = 99;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData): Record<string, UniformValue> => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const beat = frame.beat;

        const mass = frame.params.mass ?? 1;
        const trail = frame.params.trail ?? 1;
        const curl = frame.params.curl ?? 1;
        const duoIdx = Math.max(0, Math.min(2, Math.round(frame.params.palette ?? 0)));
        const [inkA, inkB] = DUOS[duoIdx];

        // ---- Drop / buildup split (odyssey pattern), smoothed ~0.35 s.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(smoothDrop, 0.7 * sustained);

        // ---- Ladder-correct tiers; fall back to raw barIndex.
        const tierBar = beat ? beat.ladderBarIndex ?? beat.barIndex : null;
        const sectionTier = tierBar !== null ? Math.floor(tierBar / 16) : null;

        // ---- Beat-quantized injection advance: each new whole beat, the
        // injection points step one notch around the frame.
        const beatCount = beat
          ? (tierBar ?? 0) * beat.beatsPerBar + beat.beatInBar
          : null;
        if (beatCount !== null && beatCount !== prevBeatCount) {
          gridStep += 1;
          prevBeatCount = beatCount;
        } else if (beatCount === null) {
          gridStep += dt * 0.6; // gridless creep so points never freeze
        }
        for (let k = 0; k < INJECT_N; k++) {
          // Points sit on a circle, stepping by an eighth turn per beat,
          // each offset so they spread around the frame.
          const a = (k / INJECT_N) * Math.PI * 2 + gridStep * (Math.PI / 4);
          const rad = 0.2 + 0.06 * Math.sin(gridStep * 0.5 + k);
          inject[k * 2] = 0.5 + Math.cos(a) * rad * (frame.time > 0 ? 1 : 1);
          inject[k * 2 + 1] = 0.5 + Math.sin(a) * rad;
        }

        // ---- Section inversion: flip the ink/light field on section lines,
        // crossfaded across ~1 s (theatrical, photosafe).
        if (sectionTier !== null && sectionTier !== prevSectionTier) {
          if (prevSectionTier !== null) {
            invertTarget = invertTarget > 0.5 ? 0 : 1;
          }
          prevSectionTier = sectionTier;
        }
        invert += (invertTarget - invert) * (1 - Math.exp(-dt / 1.0));

        // ---- Kick pressure burst: punch a clearing at a fresh point.
        punchAge += dt;
        if (frame.impulse.low > 0.35 && punchAge > 0.15) {
          punchAge = 0;
          punchAmp = Math.min(1, frame.impulse.low * 1.3);
          const a = Math.random() * Math.PI * 2;
          const rr = 0.1 + Math.random() * 0.22;
          punch[0] = 0.5 + Math.cos(a) * rr;
          punch[1] = 0.5 + Math.sin(a) * rr;
        }

        // ---- Snare flick: a mid transient flicks ink off a billow.
        flickAge += dt;
        if (frame.impulse.mid > 0.3 && flickAge > 0.15) {
          flickAge = 0;
          const a = Math.random() * Math.PI * 2;
          const rr = 0.15 + Math.random() * 0.25;
          flick[0] = 0.5 + Math.cos(a) * rr;
          flick[1] = 0.5 + Math.sin(a) * rr;
        }

        return {
          u_time: frame.time,
          u_dt: dt,
          u_low: Math.min(1, frame.bands.low * mass),
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: sustained,
          u_centroid: frame.centroid,
          // Buildups THICKEN (raise persistence -> ink lingers, slows).
          u_decay: Math.min(0.99, (0.9 + 0.06 * trail) - 0.03 * energy + 0.05 * smoothBuildup),
          u_seed: Math.floor(frame.time * 20),
          // Drop boils; buildup slows. Rides max(drop, energy) on the body.
          u_boil: Math.min(1, lift),
          u_thick: smoothBuildup,
          u_invert: invert,
          u_edgeCurl: curl,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_punch: punch,
          u_punchAge: punchAge,
          u_punchAmp: punchAmp,
          u_flick: flick,
          u_flickAge: flickAge,
          u_inkA: [inkA[0], inkA[1], inkA[2]],
          u_inkB: [inkB[0], inkB[1], inkB[2]],
          u_inject: inject,
        };
      },
    });
  },
};

export default g08OdysseyInkPreset;
