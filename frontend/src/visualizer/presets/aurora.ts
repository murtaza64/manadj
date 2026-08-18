/**
 * "Aurora" preset (realtime-visualization 05): aesthetics-first GL scene —
 * fbm noise curtains in the waveform band colors, hanging from the sky
 * like an aurora. Each color layer's amplitude rides its band; kicks
 * (low impulse) flare the horizon; snares ripple the curtains; highs
 * shimmer fine detail; the drop signal (energy trend) raises the whole
 * sky's brightness so sections read at a glance.
 */

import { ADDITIVE_COLORS } from '../../waveform/styles';
import { energyOf } from '../style';
import { createGlRenderer } from './glPreset';
import type { VisualizerPreset } from './types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_excite;  // drop excitement 0..1

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 MID = ${rgb(ADDITIVE_COLORS[1])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};

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

// One curtain layer: vertical streaks whose brightness falls from the top,
// waving with fbm; higher detail adds fine shimmer.
float curtain(vec2 uv, float t, float speed, float scale, float detail, float level) {
  float wave = fbm(vec2(uv.x * scale + t * speed, t * 0.11));
  float ripple = u_snare * 0.25 * sin(uv.x * 40.0 + t * 9.0);
  // The band shapes the GEOMETRY: quiet band = a low flat veil, loud band
  // = tall swinging waves (brightness alone made all bands move together).
  float reach = 0.1 + 0.55 * level;
  float body = 1.0 - abs(uv.y - (0.1 + reach * wave + ripple));
  body = pow(max(0.0, body), 5.0 - 2.5 * level);
  float streaks = 0.6 + 0.4 * fbm(vec2(uv.x * (scale * 6.0 + detail * 22.0), uv.y * 2.0 - t * 0.35));
  return body * streaks;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.x *= u_res.x / u_res.y;
  float t = u_time;

  vec3 col = vec3(0.0);
  // Three curtains, one per band, each with its own drift and scale.
  col += LOW * curtain(uv, t, 0.05, 0.9, 0.0, u_low) * (0.2 + 1.3 * u_low);
  col += MID * curtain(uv + vec2(3.7, 0.04), t * 1.2, -0.07, 1.4, 0.2, u_mid) * (0.12 + 1.2 * u_mid);
  col += HIGH * curtain(uv + vec2(9.2, -0.03), t * 1.5, 0.1, 2.2, 1.0, u_high) * (0.08 + 1.2 * u_high);

  // Horizon flare: kicks light the ground line.
  float ground = exp(-abs(uv.y - 0.06) * 18.0);
  col += mix(LOW, vec3(1.0), 0.4) * ground * (0.1 + 0.9 * u_kick);

  // Star shimmer with the highs.
  float star = pow(hash(floor(uv * 220.0)), 40.0);
  col += vec3(0.8, 0.9, 1.0) * star * u_high * (0.5 + 0.5 * sin(t * 7.0 + uv.x * 90.0));

  // Drops raise the whole sky.
  col *= 0.65 + 0.6 * u_excite;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

export const auroraPreset: VisualizerPreset = {
  id: 'aurora',
  hiRes: true,
  name: 'Aurora',
  create: () =>
    createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => ({
        u_time: frame.time,
        u_low: frame.bands.low,
        u_mid: frame.bands.mid,
        u_high: frame.bands.high,
        u_kick: frame.impulse.low,
        u_snare: frame.impulse.mid,
        u_excite: 0.4 * energyOf(frame.bands) + 0.6 * frame.trend.excitement,
      }),
    }),
};
