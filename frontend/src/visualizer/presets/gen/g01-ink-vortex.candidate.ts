/**
 * "g01 ink-vortex" (genetic arena, generation 01 — novel): viscous liquid
 * ink caught in a slow curl vortex. The GL feedback pass ADVECTS the frame
 * around the center (rotational curl + a viscous inward creep), so every
 * pigment smears like fluid rather than translating. The three waveform
 * band inks (ADDITIVE_COLORS: low = red, mid = green, high = blue) are
 * injected at three radii and swirled together. A kick drops a heavy ink
 * blob with a radial displacement splash; snares spatter fine specks; and
 * the live stereo scope is drawn as a luminous ink filament tracing the
 * waveform curve wound into the vortex.
 *
 * Assigned tech: stereo wave (wantsWave). frame.wave may be null when the
 * feed doesn't carry it — the filament simply drops out and the vortex
 * keeps churning on band injection alone.
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

  // --- Advection: curl vortex. Tangential velocity falls off with radius
  // (a real vortex spins fastest near the eye) and a slight inward creep
  // gives the pigment its viscous, draining swirl.
  float swirl = u_swirl * (0.35 + 0.65 * u_energy) / (r * 6.0 + 0.35);
  float creep = u_viscosity * (0.10 + 0.25 * u_energy);
  vec2 tangent = vec2(-field.y, field.x) / (r + 1e-4);
  vec2 inward = -field / (r + 1e-4);
  vec2 vel = tangent * swirl + inward * creep;
  vel += tangent * 0.10 * sin(r * 9.0 - u_time * 0.7);
  vec2 srcField = field - vel * u_dt * 3.0;
  vec2 srcUv = vec2(srcField.x / aspect, srcField.y) + 0.5;
  vec3 ink = texture2D(u_prev, srcUv).rgb * u_decay;

  // --- Band inks injected as swirling annuli at three radii.
  float ringLow = exp(-pow((r - 0.12) * 7.0, 2.0));
  float ringMid = exp(-pow((r - 0.26) * 6.0, 2.0));
  float ringHigh = exp(-pow((r - 0.40) * 5.5, 2.0));
  float lobeLow = 0.5 + 0.5 * sin(ang * 3.0 + u_time * 0.9);
  float lobeMid = 0.5 + 0.5 * sin(ang * 5.0 - u_time * 0.7);
  float lobeHigh = 0.5 + 0.5 * sin(ang * 7.0 + u_time * 1.3);
  ink += u_inkLow * u_low * ringLow * (0.25 + 0.75 * lobeLow) * 0.9;
  ink += u_inkMid * u_mid * ringMid * (0.25 + 0.75 * lobeMid) * 0.9;
  ink += u_inkHigh * u_high * ringHigh * (0.25 + 0.75 * lobeHigh) * 0.9;

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

  // --- Waveform filament: the live scope curve wound into the vortex.
  float turns = 1.5;
  float aNorm = (ang / (2.0 * PI)) + 0.5;
  float wpos = fract(aNorm * turns) * (WAVE_COUNT - 1.0);
  float wi = floor(wpos);
  float wf = wpos - wi;
  float sampled = mix(waveAt(wi), waveAt(min(wi + 1.0, WAVE_COUNT - 1.0)), wf);
  float guideR = 0.30 + sampled * u_waveAmp;
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

const g01InkVortexPreset: VisualizerPreset = {
  id: 'g01-ink-vortex',
  name: 'g01 ink-vortex',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'swirl', label: 'swirl', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'viscosity', label: 'viscosity', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'trail', label: 'trail length', min: 0.5, max: 1.4, step: 0.05, default: 1 },
    { id: 'waveAmp', label: 'wave trace', min: 0, max: 0.18, step: 0.005, default: 0.09 },
  ],
  create: () => {
    let lastTime = 0;
    let dropAngle = Math.random() * Math.PI * 2;
    const wave = new Float32Array(WAVE_N);

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

        dropAngle += dt * 0.35 + kick * 1.1;
        const dropRadius = 0.18 + 0.12 * Math.sin(frame.time * 0.5);
        const drop: [number, number] = [
          0.5 + Math.cos(dropAngle) * dropRadius,
          0.5 + Math.sin(dropAngle) * dropRadius,
        ];

        if (snare > 0.25 && snare > lastSnare + 0.05) {
          for (const p of spatter) {
            const a = Math.random() * Math.PI * 2;
            const rr = 0.18 + Math.random() * 0.28;
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

export default g01InkVortexPreset;
