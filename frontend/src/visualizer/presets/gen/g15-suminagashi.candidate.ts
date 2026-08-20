/**
 * "g15 suminagashi" (gen-15, fluids/flow lens — novel): paper marbling on
 * black water. Real marbling grammar: pigments DISPLACE, they never mix —
 * so the image keeps razor edges forever instead of decaying into wash.
 *
 * The cycle (suminagashi/ebru): kicks DROP stacks of concentric pigment
 * rings (alternating ink/clear, stamped as opaque MIXes into the feedback
 * field, not additive glow) at a slowly wandering point; on each phrase
 * boundary a COMB rakes the surface — a sinusoidal shear velocity field
 * (axis alternating per phrase) drags the rings into nonpareil feathering
 * for ~1s, then stops. Between rakes a gentle curl drift keeps the water
 * alive. Every luminance edge wears a thin surface-tension GLOSS line
 * riding the highs (the meniscus). Section boundaries sweep a clearing
 * front across the bath — fresh water for the next marbling.
 *
 * Pigment identity: 4 committed ink sets, anchored per track
 * (frame.dominantChannel trackId genome, per the dominance law); the
 * pigment index advances with every drop; hue travels slowly with the
 * spectral centroid (CPU-side, value-stable).
 *
 * Laws honoured: feedback contraction (all stamps are bounded mixes; the
 * gloss injection is (1-decay)-normalized; decay < 1), motion smoothness
 * (drift/rake rates on bandsSlow; the rake is an event envelope), kicks =
 * SOLID ring drops, photosafe (no full-field flash — the wipe darkens),
 * GLSL ES 1.0 (no backticks, constant loops), chroma-preserving soft knee.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

/** splitmix-style bit mix folded to [0,1) — per-track genome anchor. */
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

/** hsl → rgb (h in degrees). CPU-side pigment mixing. */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Committed pigment sets (hues): luminance-matched vivid inks. */
const PIGMENT_SETS: number[][] = [
  [350, 22, 48, 230], // crimson / vermilion / gold / indigo
  [310, 268, 190, 95], // magenta / violet / cyan / lime
  [8, 175, 55, 215], // coral / teal / yellow / azure
  [330, 32, 152, 252], // pink / orange / mint / royal
];

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_decay;
uniform float u_drift;      // curl drift rate (units/s), bandsSlow-driven
uniform float u_tendril;    // fine high-band curl rate (units/s), bandsSlow
uniform float u_gloss;      // meniscus gloss gain (instant highs OK: brightness)
uniform float u_rakeAmp;    // comb shear amplitude (event envelope, units/s)
uniform float u_rakeK;      // comb tine frequency
uniform float u_rakePhase;
uniform float u_rakeAxis;   // 0 = x-shear varying with y, 1 = y-shear with x
uniform vec2 u_dropPos;     // current ring-drop point (field coords)
uniform float u_dropAge;    // seconds since the drop
uniform float u_dropAmp;
uniform float u_ringFreq;
uniform vec3 u_dropColor;
uniform float u_kick;
uniform vec2 u_flickA;
uniform vec2 u_flickB;
uniform vec2 u_flickC;
uniform float u_flickAmp;
uniform vec3 u_flickColor;
uniform float u_wipeAge;    // section clearing front
uniform float u_wipeAmp;
uniform vec3 u_accent;      // front-line tint

const vec3 WATER = vec3(0.012, 0.014, 0.022);

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

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 field = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 px = 1.0 / u_res;

  // ---- Advection velocity (units/s).
  // Gentle curl drift keeps the bath alive; rate rides slow bands only.
  vec2 vel = (vec2(
    fbm(field * 2.2 + u_time * 0.05),
    fbm(field * 2.2 + vec2(9.7, 3.3) - u_time * 0.04)
  ) - 0.5) * u_drift;
  // Fine tendril curl at billow edges (slow-high driven, tiny scale).
  vel += (vec2(
    noise(field * 16.0 + u_time * 0.6),
    noise(field * 16.0 + vec2(4.1, 8.3) - u_time * 0.5)
  ) - 0.5) * u_tendril;
  // The comb: sinusoidal shear stripes — the marbling rake.
  float tine = mix(field.y, field.x, u_rakeAxis);
  float shear = sin(tine * u_rakeK + u_rakePhase);
  vel += mix(vec2(1.0, 0.0), vec2(0.0, 1.0), u_rakeAxis) * shear * u_rakeAmp;
  // Kick drop displaces the water around it (solid physical push).
  vec2 dd = field - u_dropPos;
  float rr = length(dd);
  vec2 ddir = rr > 1e-4 ? dd / rr : vec2(0.0);
  vel += ddir * u_kick * 0.09 * exp(-rr * 5.0) * exp(-u_dropAge * 6.0);

  vec2 src = field - vel * u_dt;
  vec2 srcUv = src / vec2(aspect, 1.0) + 0.5;
  float edgeFade = smoothstep(0.0, 0.012, srcUv.x) * smoothstep(0.0, 0.012, 1.0 - srcUv.x)
    * smoothstep(0.0, 0.012, srcUv.y) * smoothstep(0.0, 0.012, 1.0 - srcUv.y);

  // Unsharp tap: marbling boundaries stay razor-sharp through resampling.
  vec3 tap = texture2D(u_prev, srcUv).rgb;
  vec3 blur = (texture2D(u_prev, srcUv + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, srcUv - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, srcUv + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, srcUv - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sharp = max(vec3(0.0), tap * 1.34 - blur * 0.34);
  vec3 ink = mix(WATER, mix(WATER, sharp, edgeFade), u_decay);

  // ---- Meniscus gloss: surface-tension highlight on pigment boundaries.
  // (1-decay)-normalized injection: steady state is bounded (~gain).
  float edge = length(tap - blur);
  float glossLine = clamp(edge * 2.6, 0.0, 1.0);
  // steady state = gain (injection a with decay d converges to a/(1-d)).
  ink += vec3(1.0, 0.97, 0.88) * glossLine * glossLine
    * (0.22 + 1.2 * u_gloss) * 0.9 * (1.0 - u_decay);

  // ---- Ring drop: opaque concentric stamp, alternating pigment/clear.
  if (u_dropAge < 0.6 && u_dropAmp > 0.01) {
    float ringsSin = sin(rr * u_ringFreq);
    float env = u_dropAmp * exp(-u_dropAge * 7.0);
    float reach = exp(-rr * rr * 26.0);
    float inkBand = smoothstep(0.08, 0.5, ringsSin);
    float clrBand = smoothstep(0.08, 0.5, -ringsSin);
    ink = mix(ink, u_dropColor, clamp(inkBand * reach * env, 0.0, 1.0) * 0.88);
    ink = mix(ink, WATER, clamp(clrBand * reach * env, 0.0, 1.0) * 0.8);
  }

  // ---- Snare flicks: three tiny opaque specks.
  if (u_flickAmp > 0.01) {
    float fA = exp(-dot(field - u_flickA, field - u_flickA) * 2400.0);
    float fB = exp(-dot(field - u_flickB, field - u_flickB) * 3200.0);
    float fC = exp(-dot(field - u_flickC, field - u_flickC) * 2800.0);
    float fl = clamp((fA + fB + fC) * u_flickAmp, 0.0, 1.0);
    ink = mix(ink, u_flickColor, fl * 0.9);
  }

  // ---- Section wipe: a clearing front sweeps fresh water across the bath.
  if (u_wipeAmp > 0.01) {
    float fx = -aspect * 0.5 - 0.2 + u_wipeAge * 1.5;
    float behind = smoothstep(fx + 0.03, fx - 0.14, field.x);
    ink = mix(ink, WATER, behind * u_wipeAmp * 0.22);
    float frontLine = exp(-pow((field.x - fx) * 34.0, 2.0));
    ink = mix(ink, u_accent, frontLine * u_wipeAmp * 0.35);
  }

  // Chroma-preserving soft knee.
  float m = max(ink.r, max(ink.g, ink.b));
  if (m > 0.8) {
    ink *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(ink, 0.0), 1.0);
}
`;

const g15SuminagashiPreset: VisualizerPreset = {
  id: 'g15-suminagashi',
  name: 'g15 suminagashi',
  hiRes: true,
  params: [
    { id: 'rake', label: 'rake strength', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'rings', label: 'ring density', min: 30, max: 110, step: 1, default: 62 },
    { id: 'drift', label: 'drift', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 1.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    // Ring drops.
    let dropAngle = Math.random() * Math.PI * 2;
    let dropAge = 999;
    let dropAmp = 0;
    let dropPos: [number, number] = [0, 0];
    let pigmentIndex = 0;
    // Rake events.
    let rakeAmp = 0;
    let rakeK = 22;
    let rakePhase = 0;
    let rakeAxis = 0;
    let lastPhrase: number | null = null;
    let lastRakeFallback = 0;
    // Section wipe.
    let lastSection: number | null = null;
    let wipeAge = 999;
    // Snare flicks.
    const flicks: [number, number][] = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    let flickAmp = 0;
    // Genome: pigment set per track, hue travel with slow centroid.
    let slowCentroid = 0.5;
    let setIndex = 0;
    let lastTrack: number | null = null;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const motion = frame.bandsSlow ?? frame.bands;

        // Genome: dominant deck (per the dominance law) anchors the set.
        const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
        const track = dom?.trackId ?? null;
        if (track !== null && track !== lastTrack) {
          lastTrack = track;
          setIndex = Math.floor(splitmix01(track) * PIGMENT_SETS.length) % PIGMENT_SETS.length;
        }
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.2));
        const hues = PIGMENT_SETS[setIndex];
        const hueShift = (slowCentroid - 0.5) * 70;
        const pigment = (i: number) => hsl(hues[i % hues.length] + hueShift, 0.92, 0.56);

        // Kick → ring drop at a wandering point (refractory 0.16s).
        dropAge += dt;
        const kick = frame.impulse.low;
        if (kick > 0.32 && dropAge > 0.16) {
          dropAge = 0;
          dropAmp = Math.min(1, kick * 1.25);
          pigmentIndex = (pigmentIndex + 1) % 4;
          dropAngle += 1.9 + Math.random() * 1.4;
          const rad = 0.1 + 0.24 * Math.random();
          dropPos = [Math.cos(dropAngle) * rad, Math.sin(dropAngle) * rad];
        }

        // Phrase boundary → rake stroke (ladder tiers; time fallback).
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
        const phrase = bar !== null ? Math.floor(bar / 4) : null;
        const trigger = () => {
          rakeAxis = rakeAxis === 0 ? 1 : 0;
          rakeK = 14 + Math.random() * 22;
          rakePhase = Math.random() * Math.PI * 2;
          rakeAmp = 0.14 * (frame.params.rake ?? 1) * (0.5 + 0.5 * Math.min(1, frame.trend.slow * 2));
          lastRakeFallback = frame.time;
        };
        if (phrase !== null) {
          if (lastPhrase !== null && phrase !== lastPhrase) trigger();
          lastPhrase = phrase;
        } else if (frame.time - lastRakeFallback > 8) {
          trigger();
        }
        rakeAmp *= Math.exp(-dt / 0.45);

        // Section boundary → clearing wipe.
        const section = bar !== null ? Math.floor(bar / 16) : null;
        if (section !== null) {
          if (lastSection !== null && section !== lastSection) wipeAge = 0;
          lastSection = section;
        }
        wipeAge += dt;
        const wipeAmp = wipeAge < 2.2 ? 1 : 0;

        // Snare → flicks near the drop point.
        const snare = frame.impulse.mid;
        if (snare > 0.3) {
          for (const f of flicks) {
            const a = Math.random() * Math.PI * 2;
            const r = 0.06 + Math.random() * 0.3;
            f[0] = dropPos[0] + Math.cos(a) * r;
            f[1] = dropPos[1] + Math.sin(a) * r;
          }
          flickAmp = Math.min(1, snare * 1.2);
        } else {
          flickAmp *= Math.exp(-dt / 0.08);
        }

        const persistence = frame.params.persistence ?? 1;
        const decay = Math.min(0.9985, 1 - (1 - 0.9962) / persistence);
        const driftParam = frame.params.drift ?? 1;

        return {
          u_time: frame.time,
          u_dt: dt,
          u_decay: decay,
          // Motion rates on slow bands only (erratic-motion law).
          u_drift: (0.006 + 0.05 * motion.mid) * driftParam,
          u_tendril: 0.014 * motion.high * driftParam,
          u_gloss: frame.bands.high,
          u_rakeAmp: rakeAmp,
          u_rakeK: rakeK,
          u_rakePhase: rakePhase,
          u_rakeAxis: rakeAxis,
          u_dropPos: dropPos,
          u_dropAge: dropAge,
          u_dropAmp: dropAmp,
          u_ringFreq: frame.params.rings ?? 62,
          u_dropColor: pigment(pigmentIndex),
          u_kick: kick,
          u_flickA: flicks[0],
          u_flickB: flicks[1],
          u_flickC: flicks[2],
          u_flickAmp: flickAmp,
          u_flickColor: pigment(pigmentIndex + 2),
          u_wipeAge: wipeAge,
          u_wipeAmp: wipeAmp,
          u_accent: pigment(pigmentIndex + 1),
        };
      },
    });
  },
};

export default g15SuminagashiPreset;
