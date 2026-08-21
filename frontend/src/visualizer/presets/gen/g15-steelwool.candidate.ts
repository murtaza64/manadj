/**
 * g15-steelwool (gen-15 NOVEL, feedback-space optics lens).
 *
 * SPUN FIRE, LONG EXPOSURE. Two optics live inside the resample loop:
 *
 * 1. ANISOTROPIC STREAK TAPS — the previous frame is sampled with 5 taps
 *    distributed along the local TANGENTIAL arc (a rotation-aligned motion
 *    blur), plus a small outward radial fling and a downward ember sag.
 *    Anything stamped into the field smears into circular fire-arcs, the
 *    way spinning steel wool paints with sparks in a long exposure.
 * 2. CHROMATIC DECAY — decay is a vec3: red persists longest, blue dies
 *    fastest. Every trail runs the blackbody cooling ramp for free:
 *    white-hot head -> gold arc -> ember -> deep red -> black. Material
 *    aging as a property of the feedback loop itself.
 *
 * MEDIUM: 18 discrete spark heads on JS-integrated circular orbits
 * (countable individuals, no powder): 10 GOLD mid sparks (bands.mid),
 * 6 fast BLUE-WHITE inner sparks (bands.high), 2 slow GIANT embers.
 * Committed warm palette identity (anti blue-wash): white/gold/ember on
 * black, with the blue-white inner ring as the single cool accent.
 *
 * MUSIC MAPPING:
 *   BASS     molten wool core — radius + voltage-jitter rim ride low/kick
 *            (solid response).
 *   KICK     radial shower: fling surge (radial bump env ~1.2 s), core
 *            flare, and a traveling ripple that LIGHTS arcs it crosses.
 *   SNARE    the spark nearest the core flares white + sheds a fragment.
 *   BUILDUP  orbits tighten inward, spin lifts, shower starved.
 *   DROP     shower plateau riding max(drop, energy).
 *   SECTION  (ladderBarIndex ?? barIndex, 16 bars) the constellation
 *            re-seeds from the trackId genome (dominantChannel LAW).
 *
 * CONTRACTION: vec3 decay < 1 componentwise always; whole-field grade
 * capped at 0.99; chroma-preserving soft knee. Spin/fling rates ride
 * bandsSlow (erratic-motion law); the kick lift is a bounded transient
 * envelope (photosafe). GLSL ES 1.0, no backticks in GLSL.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const N = 18; // 10 gold mid + 6 blue-white high + 2 giant embers

const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

// No backticks inside this GLSL string (GLSL ES 1.0).
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_kick;
uniform float u_rotStep;    // tangential smear step this frame (radians)
uniform float u_fling;      // outward radial drift step
uniform float u_sag;        // downward ember sag step
uniform vec3 u_decay;       // CHROMATIC decay: r persists, b dies first
uniform float u_grade;      // whole-field grade, capped <= 0.99 JS-side
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_coreR;      // molten core radius
uniform float u_coreGain;
uniform float u_px[${N}];   // spark positions (aspect-centered coords)
uniform float u_py[${N}];
uniform float u_pb[${N}];   // spark brightness
uniform float u_pc[${N}];   // spark family: 0 gold, 1 blue-white, 2 giant

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

vec2 rot2(vec2 p, float a) {
  float cs = cos(a);
  float sn = sin(a);
  return mat2(cs, -sn, sn, cs) * p;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Anisotropic streak: 5 taps along the tangential arc (backward
  // along the spin), radial fling outward, ember sag downward.
  float flingK = 1.0 / (1.0 + u_fling);
  vec2 sagV = vec2(0.0, -u_sag); // sample above -> content sinks
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float w = 1.0 - fi * 0.16;
    vec2 p = rot2(c, -u_rotStep * fi) * flingK + sagV * fi * 0.25;
    vec2 s = p / vec2(aspect, 1.0) + 0.5;
    acc += texture2D(u_prev, s).rgb * w;
    wsum += w;
  }
  vec3 streak = acc / wsum;
  // Unsharp against a tiny cross blur so spark cores survive resampling.
  vec2 s0 = rot2(c, 0.0) * flingK / vec2(aspect, 1.0) + 0.5;
  vec3 blur = (texture2D(u_prev, s0 + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, s0 - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, s0 + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, s0 - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 field = max(vec3(0.0), streak * 1.22 - blur * 0.22);
  // CHROMATIC decay: the cooling ramp. Componentwise < 1 (contraction).
  field *= u_decay;

  // Traveling kick ripple LIGHTS the arcs it passes (reverb idiom).
  // CONTRACTION: the boost must stay below the inter-kick decay budget —
  // 1.9x compounded ring-on-ring in the smoke run (orange washout);
  // 1.45x * decay^30 frames < 1, so rings die between kicks.
  float waveFront = 0.1 + u_rippleAge * 1.1;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.6) * u_rippleAmp;
  field *= 1.0 + 0.45 * rippleWave;
  field = min(field, vec3(1.2));

  // ---- Fresh emission.
  vec3 fresh = vec3(0.0);
  // Molten wool core: voltage-jittered rim, whitens under kicks.
  float volt = (noise(vec2(atan(c.y, c.x) * 16.0 + t * 4.0, t * 26.0)) - 0.5);
  float coreR = u_coreR * (1.0 + volt * (0.06 + 0.2 * u_kick));
  float core = exp(-pow(r / coreR, 2.0) * 8.0);
  float rim = exp(-pow((r - coreR) * 44.0, 2.0));
  vec3 coreCol = mix(vec3(1.0, 0.42, 0.1), vec3(1.0, 0.93, 0.8), min(1.0, 0.35 + 0.8 * u_kick));
  fresh += coreCol * core * u_coreGain * (0.3 + 0.7 * u_low + 1.1 * u_kick);
  fresh += vec3(1.0, 0.75, 0.4) * rim * (0.06 + 0.35 * u_low + 0.9 * u_kick);
  // Spark heads: tight cores + a hot halo; the streak taps grow the tails.
  for (int i = 0; i < ${N}; i++) {
    vec2 d = c - vec2(u_px[i], u_py[i]);
    float d2 = dot(d, d);
    float b = u_pb[i];
    if (b > 0.004) {
      float head = exp(-d2 * 5200.0) * 4.5 + exp(-d2 * 900.0) * 0.3;
      vec3 col = u_pc[i] < 0.5
        ? vec3(1.0, 0.78, 0.32)                     // gold
        : (u_pc[i] < 1.5
          ? vec3(0.72, 0.86, 1.0)                   // blue-white accent
          : vec3(1.0, 0.5, 0.16));                  // giant ember
      col = mix(col, vec3(1.0), min(0.6, b * 0.5)); // hot heads whiten
      fresh += col * head * b;
    }
  }
  field += fresh * (1.0 - min(u_decay.r, 0.995)) * 2.4;

  // Whole-field grade (capped JS-side at 0.99) + fine grain.
  field *= u_grade;
  field += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * 0.008;

  // Chroma-preserving soft knee.
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.8) {
    field *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

interface Spark {
  theta: number;
  baseR: number;
  speed: number; // relative angular speed (signed)
  family: 0 | 1 | 2;
  phase: number; // radial breathing phase
  bumpV: number; // kick shower radial velocity
  bumpR: number; // kick shower radial displacement
  flare: number; // snare flare envelope
}

const buildSparks = (seed: number): Spark[] => {
  const sparks: Spark[] = [];
  for (let i = 0; i < N; i++) {
    const h1 = splitmix01(seed * 1e6 + i * 37 + 1);
    const h2 = splitmix01(seed * 1e6 + i * 37 + 2);
    const h3 = splitmix01(seed * 1e6 + i * 37 + 3);
    const family: 0 | 1 | 2 = i < 10 ? 0 : i < 16 ? 1 : 2;
    const baseR =
      family === 0 ? 0.2 + 0.16 * h1 : family === 1 ? 0.09 + 0.08 * h1 : 0.34 + 0.08 * h1;
    const speed =
      (family === 0 ? 0.7 + 0.5 * h2 : family === 1 ? 1.6 + 0.9 * h2 : 0.28 + 0.15 * h2) *
      (h3 > 0.82 ? -1 : 1); // a few counter-rotators for depth
    sparks.push({
      theta: h2 * Math.PI * 2 + i,
      baseR,
      speed,
      family,
      phase: h3 * Math.PI * 2,
      bumpV: 0,
      bumpR: 0,
      flare: 0,
    });
  }
  return sparks;
};

const preset: VisualizerPreset = {
  id: 'g15-steelwool',
  name: 'g15 Steel Wool',
  hiRes: true,
  params: [
    { id: 'persistence', label: 'trail persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'spin', label: 'spin speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'shower', label: 'shower gain', min: 0.2, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let sparks = buildSparks(0.137);
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let flingEnv = 0;
    let lastSection = -1;
    let lastAnchorTrack: number | null = null;
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const pb = new Float32Array(N);
    const pc = new Float32Array(N);
    for (let i = 0; i < N; i++) pc[i] = sparks[i].family;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(1 / 240, frame.dt || 1 / 60));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        const energyMotion = energyOf(motion);
        const alpha = 1 - Math.exp(-dt / 0.35);
        if (frame.regime) {
          smoothDrop += (Math.max(frame.regime.dropTransition, frame.regime.sustained) - smoothDrop) * alpha;
          smoothBuildup += (frame.regime.buildup - smoothBuildup) * alpha;
        } else {
          const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
          smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
          smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        }
        const drive = Math.max(smoothDrop, Math.min(1, energy * 1.3));
        // Genome + section reseed (dominantChannel LAW).
        if (frame.dominantChannel) {
          const deck = frame.decks.find((d) => d.channel === frame.dominantChannel);
          if (deck && deck.trackId !== null && deck.trackId !== lastAnchorTrack) {
            lastAnchorTrack = deck.trackId;
          }
        }
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        if (bar !== null) {
          const section = Math.floor(bar / 16);
          if (section !== lastSection) {
            lastSection = section;
            sparks = buildSparks(splitmix01((lastAnchorTrack ?? 1) * 131 + section));
            for (let i = 0; i < N; i++) pc[i] = sparks[i].family;
          }
        }
        // Kick: ripple + fling surge + shower bump on every spark.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
          const shower = (frame.params.shower ?? 1) * Math.min(1, frame.impulse.low * 1.1);
          for (const s of sparks) s.bumpV += 0.55 * shower * (0.6 + 0.4 * splitmix01(s.phase * 1e4));
        }
        flingEnv = flingEnv * Math.exp(-dt / 0.5) + frame.impulse.low * 0.06;
        // Snare: nearest-to-core spark flares.
        if (frame.impulse.mid > 0.4) {
          let best = 0;
          let bestR = 1e9;
          for (let i = 0; i < N; i++) {
            const rr = sparks[i].baseR + sparks[i].bumpR;
            if (rr < bestR) {
              bestR = rr;
              best = i;
            }
          }
          sparks[best].flare = Math.min(1.4, sparks[best].flare + frame.impulse.mid * 1.2);
        }
        // Integrate orbits: rates ride bandsSlow (motion law); buildups
        // tighten the cage inward.
        const spinParam = frame.params.spin ?? 1;
        const baseRate = (0.5 + 1.6 * energyMotion + 0.8 * drive) * spinParam;
        const contract = 1 - 0.22 * smoothBuildup;
        for (let i = 0; i < N; i++) {
          const s = sparks[i];
          s.theta += s.speed * baseRate * dt * (s.family === 1 ? 1.35 : 1);
          s.bumpV *= Math.exp(-dt / 0.45);
          s.bumpR = (s.bumpR + s.bumpV * dt) * Math.exp(-dt / 1.2);
          s.flare *= Math.exp(-dt / 0.28);
          // Eccentric wobble: orbits are arcs, not perfect circles — the
          // long-exposure disk stays airy instead of filling solid.
          const breathe =
            1 + 0.12 * Math.sin(frame.time * 0.7 + s.phase) + 0.1 * Math.sin(s.theta * 2 + s.phase);
          const rr = (s.baseR * contract * breathe + s.bumpR);
          px[i] = Math.cos(s.theta) * rr;
          py[i] = Math.sin(s.theta) * rr * 0.92; // slight squash: a spun cage
          const bandGain =
            s.family === 0 ? frame.bands.mid : s.family === 1 ? frame.bands.high : 0.3 + 0.7 * drive;
          pb[i] =
            Math.min(1.5, (0.12 + 1.15 * bandGain) * (0.45 + 0.55 * drive) + s.flare) /
            (1 + 0.9 * smoothBuildup);
        }
        const persistence = frame.params.persistence ?? 1;
        // CHROMATIC decay: red persists, blue dies first (cooling ramp).
        const k = 1 / persistence;
        const decayR = Math.min(0.993, 1 - (1 - 0.975) * k);
        const decayG = Math.min(0.993, 1 - (1 - 0.952) * k);
        const decayB = Math.min(0.993, 1 - (1 - 0.92) * k);
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_kick: frame.impulse.low,
          // motion law: smear step rides slow bands, never raw impulses
          u_rotStep: dt * (0.35 + 1.5 * energyMotion + 0.7 * drive) * spinParam,
          u_fling: dt * (0.02 + 0.1 * energyMotion) + flingEnv * dt * 3.0,
          u_sag: dt * 0.006,
          u_decay: [decayR, decayG, decayB] as [number, number, number],
          u_grade: Math.min(0.99, 0.9 + 0.09 * drive - 0.04 * smoothBuildup),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_coreR: 0.055 + 0.05 * frame.bands.low + 0.02 * frame.impulse.low,
          u_coreGain: 0.7 + 0.5 * drive,
          u_px: px,
          u_py: py,
          u_pb: pb,
          u_pc: pc,
        };
      },
    });
  },
};

export default preset;
