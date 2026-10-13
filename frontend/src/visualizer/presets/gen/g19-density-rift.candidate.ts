import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_motion;
uniform float u_section;
uniform float u_epoch;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_seed;
uniform float u_contrast;

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  float dense = mod(u_section, 2.0);
  float spread = smoothstep(0.0, 1.0, u_epoch) * u_contrast;
  float sparseN = mix(7.0, 3.0, spread);
  float denseN = mix(11.0, 34.0, spread);
  float n = mix(sparseN, denseN, dense);
  float skew = mix(-.24, .24, dense);
  p.x += p.y * skew;
  p += vec2(u_motion * mix(.05, -.018, dense), 0.0);
  vec2 cell = fract(p * n + .5) - .5;
  vec2 id = floor(p * n + .5);
  float selector = fract(sin(dot(id + u_seed * 71.0, vec2(127.1, 311.7))) * 43758.5453);
  float radius = mix(.13 + .1 * u_low, .35 + .08 * u_mid, dense);
  float dotShape = 1.0 - smoothstep(radius, radius + .05, length(cell));
  float sparseGate = step(mix(.45, .82, spread), selector);
  float denseGate = step(mix(.38, .08, spread), selector);
  float shape = dotShape * mix(sparseGate, denseGate, dense);
  float connectors = (1.0 - smoothstep(.025, .055, min(abs(cell.x), abs(cell.y)))) * dense * step(.28, selector);
  shape = max(shape, connectors);

  float hue = fract(u_seed + u_epoch * .16);
  vec3 bg = vec3(.723, 0.0, .723);
  vec3 fg = vec3(0.0, .426, .426);
  vec3 col = mix(bg, fg, shape);
  float shock = exp(-pow((length(p) - .1 - u_kick * .3) * 38.0, 2.0));
  col = mix(col, vec3(1.0, 0.0, 0.0), shock * u_kick * .8);
  col = mix(col, vec3(0.0, .509, 0.0), connectors * u_high * .35);
  gl_FragColor = vec4(col, 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return ((((deck?.trackId ?? 1903) * .73205080757) % 1) + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g19-density-rift', name: 'g19 density rift', hiRes: true,
  params: [
    { id: 'contrast', label: 'density contrast', min: .5, max: 1.5, step: .05, default: 1 },
    { id: 'speed', label: 'drift speed', min: .2, max: 2, step: .05, default: 1 },
  ],
  create: () => {
    let motion = 0;
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const slow = frame.bandsSlow ?? frame.bands;
      const dt = Math.min(.1, Math.max(0, frame.dt));
      const tierBar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const section = Math.floor(tierBar / 16);
      motion += dt * (.16 + slow.mid * .24) * (frame.params.speed ?? 1);
      return {
        u_motion: motion, u_section: section,
        u_epoch: ((section % 16) + (tierBar % 16 + (frame.beat?.barPhase ?? 0)) / 16) / 15.999,
        u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
        u_kick: frame.impulse.low, u_seed: seedOf(frame), u_contrast: frame.params.contrast ?? 1,
      };
    }});
  },
};

export default preset;
