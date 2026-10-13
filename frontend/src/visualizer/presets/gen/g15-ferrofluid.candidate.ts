/**
 * "g15 ferrofluid" (gen-15, fluids/flow lens — novel): the Rosensweig
 * instability. A pool of glossy BLACK ferrofluid fills the frame; bass is
 * the magnet. Sustained lows pull the surface into a hexagonal spike
 * lattice (three 60°-spaced cosine waves sharpened into peaks — the real
 * instability pattern); a breakdown relaxes it to calm rippling gloss.
 *
 * The shading is the star (materia material-response lineage): numeric
 * normals over the analytic height field, near-black albedo, one tight
 * beat-orbiting key light with a chromatic R/B fringe on its highlights
 * (house aberration nod), and fresnel-gated THIN-FILM IRIDESCENCE on the
 * spike flanks — every spike wears a traveling neon rim on black.
 *
 * Music mapping:
 *   bass (bandsSlow.low + impulse.low punch) → magnet strength = spike height
 *   24-band spectrum → radial relief: each ring of spikes gained by its band
 *   kick → radial pressure wave that LIFTS and LIGHTS spikes as it crosses
 *   snare → glint flashes on spike tips (specular, not powder)
 *   centroid → iridescence palette phase
 *   beat → key-light orbit (one revolution per 8 beats when gridded)
 *   section (ladder) → the lattice re-orients (eased snap)
 *   drop/breakdown (regime) → surge / relax
 *
 * No feedback buffer — analytic and contraction-free. Motion rates ride
 * slow bands/beat only. Photosafe: light lives in localized rims and
 * highlights; the pool itself stays dark. GLSL ES 1.0, no backticks.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const SPEC_N = 24;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_spike;      // magnet strength (spike amplitude)
uniform float u_ripple;     // calm-state ripple amount
uniform float u_latFreq;    // lattice frequency
uniform float u_rot;        // lattice orientation (radians)
uniform float u_orbit;      // key light azimuth (radians)
uniform float u_centroid;
uniform float u_iri;        // iridescence gain
uniform float u_relief;     // spectrum relief gain
uniform float u_waveAge;    // kick pressure wave
uniform float u_waveAmp;
uniform float u_snare;
uniform float u_kick;
uniform float u_glow;       // drop-plateau ambient lift (bounded)
uniform float u_spectrum[24];

const float PI = 3.14159265;

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

// Radial band lookup: ring index -> spectrum gain (constant loop, ES 1.0).
float specAt(float idx) {
  float v = 0.0;
  for (int k = 0; k < 24; k++) {
    if (float(k) == idx) v = u_spectrum[k];
  }
  return v;
}

// Rosensweig height field: hexagonal cosine interference sharpened into
// spikes, over a slow ripple bed. p in aspect-corrected field coords.
float height(vec2 p) {
  float cs = cos(u_rot);
  float sn = sin(u_rot);
  vec2 q = mat2(cs, -sn, sn, cs) * p * u_latFreq;
  // Three 60-degree axes.
  float hexf = (cos(q.x)
    + cos(q.x * 0.5 + q.y * 0.8660254)
    + cos(q.x * 0.5 - q.y * 0.8660254)) / 3.0;
  float bump = pow(max(hexf * 0.5 + 0.5, 0.0), 3.0 + 3.0 * u_spike);
  // Radial relief: the ring's spectrum band gains its spikes (materia).
  float r = length(p);
  float band = clamp(floor(r * 30.0), 0.0, 23.0);
  float gain = 1.0 + u_relief * (specAt(band) - 0.35) * 1.6;
  // Kick pressure wave lifts spikes as it crosses.
  float front = 0.08 + u_waveAge * 1.1;
  float wave = exp(-pow((r - front) * 8.0, 2.0)) * exp(-u_waveAge * 2.0) * u_waveAmp;
  float ripple = (noise(p * 5.0 + u_time * 0.12)
    + 0.5 * noise(p * 11.0 - u_time * 0.09) - 0.75) * u_ripple;
  return bump * u_spike * gain * (1.0 + 1.4 * wave) + ripple + wave * 0.05;
}

// Iridescent thin-film palette: saturated neon travel.
vec3 film(float t) {
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 0.75, 0.6) * t + vec3(0.0, 0.33, 0.62)));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(p);

  // Height + numeric normal (z-scaled for drama).
  float e = 0.006;
  float h0 = height(p);
  float hx = height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0));
  float hy = height(p + vec2(0.0, e)) - height(p - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx / (2.0 * e) * 0.35, -hy / (2.0 * e) * 0.35, 1.0));

  // Lights: beat-orbiting key + faint static fill.
  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 keyDir = normalize(vec3(cos(u_orbit), sin(u_orbit), 0.6));
  vec3 fillDir = normalize(vec3(-0.4, 0.55, 0.72));
  vec3 hv = normalize(keyDir + view);
  // Chromatic fringe: R and B sample the highlight with the light nudged
  // either way around the orbit (aberration on the specular only).
  vec3 keyDirR = normalize(vec3(cos(u_orbit + 0.06), sin(u_orbit + 0.06), 0.6));
  vec3 keyDirB = normalize(vec3(cos(u_orbit - 0.06), sin(u_orbit - 0.06), 0.6));
  float specG = pow(max(dot(n, hv), 0.0), 70.0);
  float specR = pow(max(dot(n, normalize(keyDirR + view)), 0.0), 70.0);
  float specB = pow(max(dot(n, normalize(keyDirB + view)), 0.0), 70.0);
  float diffuse = max(dot(n, keyDir), 0.0);
  float fillSpec = pow(max(dot(n, normalize(fillDir + view)), 0.0), 30.0);

  // The fluid body: near-black, faintly warmed by diffuse.
  vec3 col = vec3(0.012, 0.012, 0.02)
    + vec3(0.05, 0.045, 0.07) * diffuse * (0.5 + 0.5 * u_glow);

  // Wet specular: white-hot core with R/B fringe (kick brightens it).
  col += vec3(specR, specG, specB) * (0.9 + 0.9 * u_kick + 0.5 * u_glow);
  col += vec3(0.25, 0.3, 0.4) * fillSpec * 0.5;

  // Thin-film iridescence on spike flanks: fresnel-gated neon rims.
  float fresnel = pow(1.0 - max(n.z, 0.0), 2.2);
  float spikeMask = smoothstep(0.04, 0.3, h0);
  vec3 rim = film(fresnel * 1.6 + u_centroid * 0.9 + h0 * 0.7 + u_time * 0.02);
  col += rim * fresnel * spikeMask * u_iri * (0.55 + 0.45 * u_glow);

  // Kick wave: LIGHT what it crosses (warm sweep, localized).
  float front = 0.08 + u_waveAge * 1.1;
  float waveLight = exp(-pow((r - front) * 8.0, 2.0)) * exp(-u_waveAge * 2.0) * u_waveAmp;
  col += film(0.05 + u_centroid * 0.5) * waveLight * spikeMask * 1.1;
  col += vec3(1.0, 0.85, 0.6) * waveLight * fresnel * 0.8;

  // Snare glints: sparkle flashes on spike TIPS only (specular vocabulary).
  if (u_snare > 0.02) {
    float tip = smoothstep(0.55, 0.9, h0 / max(u_spike, 0.15));
    float twinkle = step(0.85, hash(floor(p * 40.0) + floor(u_time * 24.0)));
    col += vec3(0.9, 0.95, 1.0) * tip * twinkle * u_snare * 1.6;
  }

  // Gentle vignette keeps the pool reading as a body.
  col *= 1.0 - 0.4 * smoothstep(0.55, 1.05, r);

  // Chroma-preserving soft knee.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.8) {
    col *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const g15FerrofluidPreset: VisualizerPreset = {
  id: 'g15-ferrofluid',
  name: 'g15 ferrofluid',
  hiRes: true,
  params: [
    { id: 'height', label: 'spike height', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'iri', label: 'iridescence', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'orbit', label: 'light orbit speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'relief', label: 'EQ relief', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let orbit = 0.7;
    let rot = 0;
    let rotTarget = 0;
    let lastSection: number | null = null;
    let waveAge = 999;
    let waveAmp = 0;
    let magnet = 0;
    const spectrum = new Float32Array(SPEC_N);

    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const motion = frame.bandsSlow ?? frame.bands;
        const regime = frame.regime;
        const sustained = regime
          ? Math.max(regime.sustained, regime.dropTransition)
          : Math.min(1, frame.trend.slow * 1.6);
        const breakdown = regime?.breakdown ?? 0;

        // Magnet strength: sustained bass pulls spikes up (slow attack via
        // EMA), kicks punch extra height; breakdown relaxes the pool.
        const target =
          (0.18 + 1.15 * motion.low + 0.35 * sustained) * (1 - 0.7 * breakdown);
        magnet += (target - magnet) * (1 - Math.exp(-dt / 0.3));
        const spike =
          (magnet + 0.45 * frame.impulse.low) * (frame.params.height ?? 1);

        // Key light: one orbit per 8 beats when gridded, slow drift without.
        const bpm = frame.beat?.bpm ?? null;
        orbit +=
          dt *
          (bpm ? ((bpm / 60) * Math.PI * 2) / 8 : 0.35) *
          (frame.params.orbit ?? 1);

        // Section boundary: lattice re-orients (golden-angle hop, eased ~1s).
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
        const section = bar !== null ? Math.floor(bar / 16) : null;
        if (section !== null) {
          if (lastSection !== null && section !== lastSection) rotTarget += 2.39996;
          lastSection = section;
        }
        rot += (rotTarget - rot) * (1 - Math.exp(-dt / 1.0));
        // Slow ambient turn rides slow mids (motion law).
        rotTarget += dt * 0.02 * motion.mid;

        // Kick pressure wave (retrigger, capture strength).
        waveAge += dt;
        if (frame.impulse.low > 0.35 && waveAge > 0.14) {
          waveAge = 0;
          waveAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // 24-band relief.
        const src = frame.spectrum;
        for (let i = 0; i < SPEC_N; i++) spectrum[i] = src[i] ?? 0;

        return {
          u_time: frame.time,
          u_spike: spike,
          u_ripple: 0.02 + 0.05 * motion.mid + 0.06 * breakdown,
          u_latFreq: 26 - 6 * sustained,
          u_rot: rot,
          u_orbit: orbit,
          u_centroid: frame.centroid,
          u_iri: (frame.params.iri ?? 1) * (0.6 + 0.5 * motion.high),
          u_relief: frame.params.relief ?? 1,
          u_waveAge: waveAge,
          u_waveAmp: waveAmp,
          u_snare: frame.impulse.mid,
          u_kick: frame.impulse.low,
          u_glow: Math.min(1, sustained),
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g15FerrofluidPreset;
