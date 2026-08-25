/**
 * "Silk" preset (realtime-visualization 02/05): rebuilt on the GL feedback
 * pipeline (the canvas dot-trail port never looked silky). Vissonance
 * Silk's essence — band-driven emitters leaving persistent threads —
 * done properly: each of 24 mirrored columns emits light on the center
 * axis proportional to its band, and the feedback pass ADVECTS the frame
 * away from the axis with a curl wobble, weaving actual silk. Energy
 * drives flow speed; kicks (low impulse) throw a bright pulse down the
 * whole axis; hue is the energy sweep.
 */

import { SPECTRUM_BAND_COUNT } from '../channel';
import { energyHue, energyOf } from '../style';
import { createGlRenderer } from './glPreset';
import type { VisualizerPreset } from './types';

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_energy;
uniform float u_kick;
uniform float u_hue;
uniform float u_decay;
uniform float u_flow;
uniform float u_spectrum[${SPECTRUM_BAND_COUNT}];

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
  float v = 0.0;
  for (int k = 0; k < ${SPECTRUM_BAND_COUNT}; k++) {
    if (float(k) == i) v = u_spectrum[k];
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 centered = uv - 0.5;

  // Advection: silk flows away from the center axis, swaying with a curl
  // field; louder = faster weave.
  float away = sign(centered.y + 1e-5);
  float flow = (0.03 + 0.12 * u_energy) * u_flow * away;
  float sway = 0.012 * sin(centered.y * 26.0 + u_time * 0.8 + sin(uv.x * 21.0 + u_time * 0.5));
  vec2 src = uv - vec2(sway, flow) * u_dt * 6.0;
  vec3 silk = texture2D(u_prev, src).rgb * u_decay;

  // Emitters: 24 mirrored columns glowing on the axis with their band.
  float mx = clamp(abs(centered.x) * 2.2, 0.0, 0.999);
  float bandIndex = floor(mx * BANDS);
  float level = bandAt(bandIndex);
  float segCenter = (bandIndex + 0.5) / BANDS / 2.2;
  float dx = (abs(centered.x) - segCenter) * u_res.x / u_res.y;
  float d = length(vec2(dx * 2.0, centered.y * 3.0));
  float glow = level * exp(-d * d * 260.0);
  vec3 color = hsl2rgb(mod(u_hue + bandIndex * 3.0, 360.0), 1.0, 0.55 + 0.25 * level);
  silk += color * glow * (0.5 + 1.6 * level) / (1.0 + 1.4 * u_energy);

  // Kick: a bright pulse along the whole axis that the flow then weaves.
  silk += hsl2rgb(u_hue, 1.0, 0.75) * u_kick * exp(-abs(centered.y) * 40.0) * 0.35;

  // Soft knee above 0.8, scaling all channels together so hue survives
  // (per-channel min() bleached hot areas to white).
  float m = max(silk.r, max(silk.g, silk.b));
  if (m > 0.8) {
    silk *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(silk, 1.0);
}
`;

export const silkPreset: VisualizerPreset = {
  id: 'silk',
  hiRes: true,
  name: 'Silk',
  params: [
    { id: 'flow', label: 'flow speed', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'trail', label: 'trail length', min: 0.5, max: 1.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    const spectrum = new Float32Array(SPECTRUM_BAND_COUNT);
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        spectrum.set(frame.spectrum.slice(0, SPECTRUM_BAND_COUNT));
        const energy = energyOf(frame.bands);
        return {
          u_time: frame.time,
          u_dt: dt,
          u_energy: energy,
          u_kick: frame.impulse.low,
          u_hue: energyHue(energy, frame.time * 3),
          // Louder = shorter trails: the field drains as fast as the
          // emitters fill it, so drops stay readable instead of whiting out.
          u_decay: Math.min(0.995, 0.976 - 0.035 * energy + ((frame.params.trail ?? 1) - 1) * 0.02),
          u_flow: frame.params.flow ?? 1,
          u_spectrum: spectrum,
        };
      },
    });
  },
};
