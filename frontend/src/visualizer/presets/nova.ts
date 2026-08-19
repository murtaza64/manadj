/**
 * "Nova" preset (realtime-visualization 05): a Voyage variant exploring
 * explosion physics instead of flight. One dense nebula medium; the
 * dynamics live in pressure:
 *
 *   kicks    → luminous SHELLS stamped into the feedback that expand
 *              outward forever (the medium remembers every kick)
 *   buildups → gravitational accretion: inward radial streaks, the
 *              medium visibly falling toward the core
 *   drops    → supernova: shells brighten, the core blows white, the
 *              whole medium ignites
 *   mids     → the nebula's churn and density
 *   highs    → electric crackle filaments arcing through the medium
 *   snares   → star powder (the one discrete element)
 *
 * Same palette selector and param set as Voyage — a sibling, not a fork
 * of feel.
 */

import { energyOf } from '../style';
import { SPECTRUM_BAND_COUNT } from '../channel';
import { createGlRenderer } from './glPreset';
import type { VisualizerPreset } from './types';

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
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
uniform float u_dust;
uniform float u_palette;

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

vec3 palette(float t) {
  vec3 a; vec3 b; vec3 cf; vec3 d;
  if (u_palette < 0.5) {
    a = vec3(0.42, 0.14, 0.1); b = vec3(0.42, 0.24, 0.14);
    cf = vec3(1.0, 0.9, 0.6); d = vec3(0.0, 0.15, 0.25);
  } else if (u_palette < 1.5) {
    a = vec3(0.45, 0.28, 0.42); b = vec3(0.25, 0.35, 0.5);
    cf = vec3(1.0, 0.85, 0.7); d = vec3(0.0, 0.2, 0.45);
  } else if (u_palette < 2.5) {
    a = vec3(0.12, 0.35, 0.3); b = vec3(0.2, 0.42, 0.38);
    cf = vec3(0.9, 1.0, 0.8); d = vec3(0.1, 0.3, 0.5);
  } else {
    a = vec3(0.5, 0.4, 0.25); b = vec3(0.42, 0.36, 0.28);
    cf = vec3(1.0, 1.0, 0.9); d = vec3(0.0, 0.1, 0.2);
  }
  return a + b * cos(6.28318 * (cf * t + d)) + vec3(0.12, -0.02, -0.06) * u_drop;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;

  // ---- Pressure warp: shells push OUTWARD (drop expands the medium),
  // accretion pulls INWARD during buildups; a slow churn keeps it alive.
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);
  float outward = (0.001 + 0.02 * u_drop + 0.05 * u_kick) * exp(-r * 1.2);
  float inward = 0.012 * u_buildup;
  vec2 churn = (vec2(fbm(c * 3.1 + t * 0.1), fbm(c * 3.1 + vec2(9.2, 4.4) - t * 0.08)) - 0.5)
    * (0.003 + 0.012 * u_mid);
  vec2 src = (c - dir * (outward - inward) + churn) / vec2(aspect, 1.0) + 0.5;
  vec3 medium = texture2D(u_prev, src).rgb * u_decay;

  // ---- The nebula medium (mids): density-churned, center-dark.
  float density = fbm(c * (2.2 + 1.2 * u_mid) + vec2(t * 0.05, -t * 0.04));
  float centerDim = smoothstep(0.03, 0.35, r);
  vec3 fresh = palette(density * 0.8 + u_centroid * 0.4 + t * 0.012)
    * pow(density, 2.0) * (0.1 + 1.1 * u_mid) * u_dust * centerDim * exp(-r * 1.4);
  // Coal core, whitening only when the drop ignites it.
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-r * r * 240.0);
  fresh += mix(coal, vec3(1.0, 0.95, 0.85), 0.6 * u_drop + 0.4 * u_kick)
    * heart * (0.5 + 1.3 * u_low + 1.6 * u_kick);
  // Electric crackle (highs): thin ridges arcing through the medium.
  float ridge = abs(fbm(vec2(ang * 4.0 + t * 0.4, r * 6.0 - t * 0.3)) - 0.5);
  float crackle = pow(max(0.0, 1.0 - ridge * 9.0), 6.0);
  fresh += mix(vec3(0.45, 0.9, 1.0), palette(0.65), 0.3) * crackle
    * smoothstep(0.1, 0.45, r) * (0.04 + 1.5 * u_high) * u_dust;
  // Accretion streaks (buildups): the medium falling inward.
  float streaks = pow(fbm(vec2(ang * 9.0, r * 2.5 + t * 0.9)), 4.0);
  fresh += palette(0.3 + t * 0.02) * streaks * u_buildup * exp(-r * 1.6) * 0.9;
  medium += fresh * (1.0 - u_decay) * (3.0 + 1.8 * u_sustain);

  // ---- Stamps.
  // Kick shells: luminous rings living IN the medium, expanding forever.
  if (u_kick > 0.03) {
    float shell = exp(-pow((r - (0.09 + 0.04 * u_kick)) * 42.0, 2.0));
    medium += mix(coal, vec3(1.0, 0.85, 0.7), 0.5 + 0.3 * u_drop) * shell * u_kick * 1.1;
  }
  // Snare powder.
  if (u_snare > 0.03) {
    vec2 q = c * 17.0;
    vec2 cell = floor(q);
    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
    vec2 f = fract(q) - pos;
    float star = exp(-dot(f, f) * 380.0) * step(0.982, hash(sc * 1.618 + 9.7));
    medium += vec3(1.0, 0.95, 0.9) * star * u_snare * smoothstep(0.08, 0.2, r) * 1.4;
  }

  // Supernova lift on the drop; soft knee.
  medium *= 0.72 + 0.5 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(medium.r, max(medium.g, medium.b));
  if (m > 0.8) {
    medium *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(medium, 0.0), 1.0);
}
`;

export const novaPreset: VisualizerPreset = {
  id: 'nova',
  name: 'Nova',
  hiRes: true,
  params: [
    { id: 'dust', label: 'nebula density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette 0-3 (ember/nebula/aurora/solar)', min: 0, max: 3, step: 1, default: 0 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let lastTime = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const persistence = frame.params.persistence ?? 1;
        const baseDecay = 0.99 - 0.006 * energy;
        void SPECTRUM_BAND_COUNT;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: Math.min(1, energy * 1.4),
          u_centroid: frame.centroid,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 0,
        };
      },
    });
  },
};
