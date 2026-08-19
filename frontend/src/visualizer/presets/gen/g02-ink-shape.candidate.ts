/**
 * "g02 ink-shape" (genetic arena, generation 02 — tweak of g01-ink-vortex):
 * the winning viscous ink vortex, now SHAPED by spectral texture. Two new
 * levers steer the fluid:
 *
 *   FLATNESS = viscosity. Tonal material (flatness → 0) reads as THICK,
 *   slow, laminar: the vortex creeps inward, the swirl smears in fat
 *   coherent sheets, pigment lingers. Noisy material (flatness → 1) reads
 *   as THIN, turbulent, fast-diffusing: the advection gains chaotic curl
 *   and the ink flings outward and dissipates.
 *
 *   SPREAD = ink dispersion radius + palette breadth. A narrow sound
 *   (spread → 0) concentrates into ONE tight ink at the eye of the vortex,
 *   the dominant band's color dominating. A wide sound (spread → 1) throws
 *   all three band inks (ADDITIVE_COLORS: low = red, mid = green, high =
 *   blue) fully out to their annuli, palette at maximum breadth.
 *
 * Everything g01 won on survives: the three swirling band inks, the kick
 * ink-drop with its displacement splash, the snare spatter, and the live
 * stereo waveform filament wound into the vortex.
 *
 * Assigned tech: spread + flatness (+ stereo wave, wantsWave). frame.wave
 * may be null when the feed doesn't carry it — the filament drops out and
 * the vortex keeps churning on band injection alone.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';
import { ADDITIVE_COLORS } from '../../../waveform/styles';

/** Downsampled waveform resolution handed to GLSL as uniform float[WAVE_N]. */
const WAVE_N = 64;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_energy;
uniform float u_decay;
uniform float u_swirl;
uniform float u_viscosity;
uniform float u_flatness;
uniform float u_spread;
uniform float u_kick;
uniform float u_snare;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_waveAmp;
uniform vec2 u_drop;
uniform vec2 u_spatterA;
uniform vec2 u_spatterB;
uniform vec2 u_spatterC;
uniform vec3 u_inkLow;
uniform vec3 u_inkMid;
uniform vec3 u_inkHigh;
uniform float u_wave[64];

const float WAVE_COUNT = 64.0;
const float PI = 3.14159265;

// Constant-loop lookup into the waveform uniform (GLSL ES 1.0 forbids
// dynamic array indexing).
float waveAt(float idx) {
  float v = 0.0;
  for (int k = 0; k < 64; k++) {
    if (float(k) == idx) v = u_wave[k];
  }
  return v;
}

// Aspect-corrected vector from center in "square" space so the vortex
// stays round on a wide canvas.
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

  // --- Viscosity from flatness: tonal = thick (high viscosity, laminar);
  // noisy = thin (low viscosity, turbulent). visc runs high when flatness
  // is low. turb is the complementary chaos knob.
  float visc = u_viscosity * (1.35 - 0.9 * u_flatness);
  float turb = u_flatness;

  // --- Advection: curl vortex. Tangential velocity falls off with radius
  // (a real vortex spins fastest near the eye). Thick ink creeps inward and
  // drains; thin ink flings outward with turbulent curl and diffuses.
  float swirl = u_swirl * (0.35 + 0.65 * u_energy) / (r * 6.0 + 0.35);
  swirl *= (0.7 + 0.6 * turb);
  float creep = visc * (0.10 + 0.25 * u_energy);
  vec2 tangent = vec2(-field.y, field.x) / (r + 1e-4);
  vec2 inward = -field / (r + 1e-4);
  // Laminar drain when thick; outward turbulent flit when thin.
  vec2 radial = mix(inward, -inward, turb);
  vec2 vel = tangent * swirl + radial * creep;
  // Coherent wobble when laminar; jittery high-frequency curl when noisy.
  float wob = 0.10 * (1.0 - 0.5 * turb);
  vel += tangent * wob * sin(r * (9.0 + 14.0 * turb) - u_time * (0.7 + 1.4 * turb));
  vel += tangent * (0.10 * turb) * sin(ang * 11.0 + r * 30.0 - u_time * 2.3);
  vec2 srcField = field - vel * u_dt * 3.0;
  vec2 srcUv = vec2(srcField.x / aspect, srcField.y) + 0.5;
  vec3 ink = texture2D(u_prev, srcUv).rgb * u_decay;

  // --- Band inks injected as swirling annuli. SPREAD sets the dispersion
  // radius: narrow sound pulls all three inks toward one concentrated eye
  // ring; wide sound throws them out to their distinct annuli. Ring width
  // also tightens with spread so a broad sound spreads the palette fully.
  float disp = 0.25 + 0.75 * u_spread;
  float rLow = 0.12 * disp;
  float rMid = mix(0.14, 0.26, u_spread);
  float rHigh = mix(0.16, 0.40, u_spread);
  float wLow = mix(11.0, 7.0, u_spread);
  float wMid = mix(9.0, 6.0, u_spread);
  float wHigh = mix(8.5, 5.5, u_spread);
  float ringLow = exp(-pow((r - rLow) * wLow, 2.0));
  float ringMid = exp(-pow((r - rMid) * wMid, 2.0));
  float ringHigh = exp(-pow((r - rHigh) * wHigh, 2.0));
  float lobeLow = 0.5 + 0.5 * sin(ang * 3.0 + u_time * 0.9);
  float lobeMid = 0.5 + 0.5 * sin(ang * 5.0 - u_time * 0.7);
  float lobeHigh = 0.5 + 0.5 * sin(ang * 7.0 + u_time * 1.3);
  // Palette breadth: narrow sound damps the two quieter inks toward the
  // dominant one; wide sound lets all three ring at full strength.
  float breadth = 0.35 + 0.65 * u_spread;
  ink += u_inkLow * u_low * ringLow * (0.25 + 0.75 * lobeLow) * 0.9;
  ink += u_inkMid * u_mid * ringMid * (0.25 + 0.75 * lobeMid) * 0.9 * breadth;
  ink += u_inkHigh * u_high * ringHigh * (0.25 + 0.75 * lobeHigh) * 0.9 * breadth;

  // --- Kick: a heavy ink drop with a displacement splash.
  vec2 dropField = toField(u_drop);
  vec2 dd = field - dropField;
  float dr = length(dd);
  float crown = exp(-pow(dr * 8.0, 2.0));
  float push = u_kick * 0.06 * exp(-dr * 6.0);
  vec2 pushUv = vec2((field - normalize(dd + 1e-4) * push).x / aspect,
                     (field - normalize(dd + 1e-4) * push).y) + 0.5;
  ink = mix(ink, texture2D(u_prev, pushUv).rgb * u_decay, clamp(u_kick * crown, 0.0, 0.85));
  vec3 dropInk = mix(u_inkLow, vec3(1.0), 0.35);
  ink += dropInk * u_kick * exp(-pow(dr * 10.0, 2.0)) * 1.4;
  ink += mix(u_inkLow, u_inkHigh, 0.5) * u_kick * exp(-pow((dr - 0.05) * 22.0, 2.0)) * 0.6;

  // --- Snare: fine spatter — a few tight specks of mid/high ink.
  vec2 sA = toField(u_spatterA);
  vec2 sB = toField(u_spatterB);
  vec2 sC = toField(u_spatterC);
  float spat = 0.0;
  spat += exp(-pow(length(field - sA) * 55.0, 2.0));
  spat += exp(-pow(length(field - sB) * 70.0, 2.0));
  spat += exp(-pow(length(field - sC) * 60.0, 2.0));
  ink += mix(u_inkMid, u_inkHigh, 0.5) * u_snare * spat * 1.3;

  // --- Waveform filament: the live scope curve wound into the vortex. Its
  // guide radius sits with the ink dispersion so the trace stays inside the
  // shaped palette.
  float turns = 1.5;
  float aNorm = (ang / (2.0 * PI)) + 0.5;
  float wpos = fract(aNorm * turns) * (WAVE_COUNT - 1.0);
  float wi = floor(wpos);
  float wf = wpos - wi;
  float sampled = mix(waveAt(wi), waveAt(min(wi + 1.0, WAVE_COUNT - 1.0)), wf);
  float guideR = mix(0.20, 0.34, u_spread) + sampled * u_waveAmp;
  float dline = abs(r - guideR);
  float filament = exp(-pow(dline * 42.0, 2.0));
  vec3 filInk = mix(u_inkHigh, u_inkMid, 0.5 + 0.5 * sampled);
  ink += filInk * filament * (0.35 + 0.9 * u_energy);

  // --- Chroma-preserving soft knee (silk lineage).
  float m = max(ink.r, max(ink.g, ink.b));
  if (m > 0.8) {
    ink *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(ink, 1.0);
}
`;

/** 0-1 RGB tuple → GL vec3 uniform triple. */
function inkVec(rgb: readonly [number, number, number]): [number, number, number] {
  return [rgb[0], rgb[1], rgb[2]];
}

const g02InkShapePreset: VisualizerPreset = {
  id: 'g02-ink-shape',
  name: 'g02 ink-shape',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'swirl', label: 'swirl', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'viscosity', label: 'viscosity', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'trail', label: 'trail length', min: 0.5, max: 1.4, step: 0.05, default: 1 },
    { id: 'waveAmp', label: 'wave trace', min: 0, max: 0.18, step: 0.005, default: 0.09 },
    { id: 'shape', label: 'spectral shape', min: 0, max: 1.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let dropAngle = Math.random() * Math.PI * 2;
    const wave = new Float32Array(WAVE_N);

    // Smoothed spectral levers — flatness and spread jitter frame-to-frame,
    // so ease them to keep the fluid's viscosity/dispersion from strobing.
    let smFlatness = 0.5;
    let smSpread = 0.5;

    const spatter: [number, number][] = [
      [0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5],
    ];
    let lastSnare = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const kick = frame.impulse.low;
        const snare = Math.max(frame.impulse.mid, frame.impulse.high);

        // Downsample the stereo mid waveform; degrade gracefully to flat.
        const w = frame.wave;
        if (w && w.left.length > 0) {
          const src = w.left;
          const other = w.right;
          const n = Math.min(src.length, other.length);
          const step = n / WAVE_N;
          for (let i = 0; i < WAVE_N; i++) {
            const idx = Math.min(n - 1, Math.floor(i * step));
            wave[i] = (src[idx] + other[idx]) * 0.5;
          }
        } else {
          wave.fill(0);
        }

        // Ease the spectral levers. `shape` param scales how hard flatness
        // and spread bite (0 = ignore spectral shape, back to plain vortex).
        const shape = frame.params.shape ?? 1;
        const flatTarget = Math.min(1, Math.max(0, frame.flatness));
        const spreadTarget = Math.min(1, Math.max(0, frame.spread));
        smFlatness += (flatTarget - smFlatness) * Math.min(1, dt * 6);
        smSpread += (spreadTarget - smSpread) * Math.min(1, dt * 6);
        const flatness = 0.5 + (smFlatness - 0.5) * shape;
        const spread = 0.5 + (smSpread - 0.5) * shape;

        dropAngle += dt * 0.35 + kick * 1.1;
        const dropRadius = 0.18 + 0.12 * Math.sin(frame.time * 0.5);
        const drop: [number, number] = [
          0.5 + Math.cos(dropAngle) * dropRadius,
          0.5 + Math.sin(dropAngle) * dropRadius,
        ];

        if (snare > 0.25 && snare > lastSnare + 0.05) {
          for (const p of spatter) {
            const a = Math.random() * Math.PI * 2;
            // Wider sound flings spatter further out.
            const rr = 0.18 + Math.random() * (0.18 + 0.24 * spread);
            p[0] = 0.5 + Math.cos(a) * rr;
            p[1] = 0.5 + Math.sin(a) * rr;
          }
        }
        lastSnare = snare;

        return {
          u_time: frame.time,
          u_dt: dt,
          u_energy: energy,
          u_decay: Math.min(0.995, 0.982 - 0.03 * energy + ((frame.params.trail ?? 1) - 1) * 0.02),
          u_swirl: frame.params.swirl ?? 1,
          u_viscosity: frame.params.viscosity ?? 1,
          u_flatness: flatness,
          u_spread: spread,
          u_kick: kick,
          u_snare: snare,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_waveAmp: frame.params.waveAmp ?? 0.09,
          u_drop: drop,
          u_spatterA: spatter[0],
          u_spatterB: spatter[1],
          u_spatterC: spatter[2],
          u_inkLow: inkVec(ADDITIVE_COLORS[0]),
          u_inkMid: inkVec(ADDITIVE_COLORS[1]),
          u_inkHigh: inkVec(ADDITIVE_COLORS[2]),
          u_wave: wave,
        };
      },
    });
  },
};

export default g02InkShapePreset;
