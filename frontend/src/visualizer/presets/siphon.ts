/**
 * "Siphon" preset (realtime-visualization 02/05): inside a spectrum tube —
 * rebuilt as a WebGL fragment shader (the canvas ring port read flat).
 * Classic procedural tunnel coordinates (angle, 1/radius) with the
 * 24-band spectrum wrapped around the wall: each angular segment's wall
 * displaces and glows with its band. Vissonance Siphon signatures kept:
 * INVERTED breathing (energy tightens the tube), depth fog, and the
 * complementary rim tint. Kicks (low impulse) flash the tunnel mouth;
 * flight speed rides the energy trend, so drops physically accelerate.
 */

import { SPECTRUM_BAND_COUNT } from '../channel';
import { energyHue, energyOf } from '../style';
import { createGlRenderer } from './glPreset';
import type { VisualizerPreset } from './types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_z;        // accumulated flight depth
uniform float u_energy;
uniform float u_low;
uniform float u_kick;     // low impulse
uniform float u_hue;      // energy hue, degrees
uniform float u_spectrum[${SPECTRUM_BAND_COUNT}];

const float PI = 3.141592653589793;
const float BANDS = ${SPECTRUM_BAND_COUNT}.0;

vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = mod(h / 60.0, 6.0);
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb = hp < 1.0 ? vec3(c, x, 0.0) : hp < 2.0 ? vec3(x, c, 0.0)
    : hp < 3.0 ? vec3(0.0, c, x) : hp < 4.0 ? vec3(0.0, x, c)
    : hp < 5.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return rgb + (l - c * 0.5);
}

float bandAt(float i) {
  // Constant-index loop lookup (GLSL ES 1.0 has no dynamic array index).
  float v = 0.0;
  for (int k = 0; k < ${SPECTRUM_BAND_COUNT}; k++) {
    if (float(k) == i) v = u_spectrum[k];
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  // Inverted breathing: loud tightens the tube around you.
  uv *= 1.0 + 0.5 * u_energy;
  float r = length(uv);
  float angle = atan(uv.y, uv.x);

  // Tunnel coordinates: depth ~ 1/r, flying along +z.
  float depth = 0.35 / max(r, 1e-4) + u_z;
  // Gentle drift so the tube bends instead of staring down a pipe.
  angle += 0.35 * sin(depth * 0.22 + u_time * 0.15);

  // The spectrum wraps the wall: band by angle (mirrored), sub-glow by
  // how close this wall cell's ring is.
  float half_ = mod(angle / PI + 2.0, 2.0);           // 0..2
  float mirrored = half_ < 1.0 ? half_ : 2.0 - half_;  // 0..1, mirrored
  float bandIndex = floor(mirrored * (BANDS - 1.0) + 0.5);
  float level = bandAt(bandIndex);

  // Rings along the tube; each band bulges its wall cells inward.
  float ring = fract(depth * 0.5);
  float ringGlow = pow(1.0 - abs(ring - 0.5) * 2.0, 6.0 + 10.0 * (1.0 - level));
  float segEdge = pow(abs(fract(mirrored * (BANDS - 1.0)) - 0.5) * 2.0, 8.0);

  // Depth fog: far is dark.
  float fog = exp(-0.16 * (depth - u_z));

  float wall = ringGlow * (0.15 + 1.5 * level) + segEdge * 0.08 * level;
  vec3 base = hsl2rgb(u_hue, 1.0, 0.28 + 0.3 * level);
  vec3 rim = hsl2rgb(mod(u_hue + 180.0, 360.0), 1.0, 0.5);
  vec3 col = base * wall * fog;
  // Complementary rim breathing at the mouth.
  col += rim * pow(max(0.0, 1.0 - r), 3.0) * (0.12 + 0.5 * u_low);
  // Kick flash: the whole mouth blinks white on a low transient.
  col += vec3(1.0) * pow(max(0.0, 1.0 - r), 2.0) * u_kick * 0.7;

  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

export const siphonPreset: VisualizerPreset = {
  id: 'siphon',
  hiRes: true,
  name: 'Siphon',
  create: () => {
    // Flight depth integrates energy-trend speed (drops accelerate).
    let z = 0;
    let lastTime = 0;
    const spectrum = new Float32Array(SPECTRUM_BAND_COUNT);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.max(0, frame.time - lastTime) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        z += dt * (0.6 + 2.4 * frame.trend.excitement + 1.2 * energy);
        spectrum.set(frame.spectrum.slice(0, SPECTRUM_BAND_COUNT));
        return {
          u_time: frame.time,
          u_z: z,
          u_energy: energy,
          u_low: frame.bands.low,
          u_kick: frame.impulse.low,
          u_hue: energyHue(energy),
          u_spectrum: spectrum,
        };
      },
    });
  },
};
