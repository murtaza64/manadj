import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_motion;
uniform float u_section;
uniform float u_arc;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_seed;
uniform float u_scale;

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  float parity = mod(u_section, 2.0);
  float epoch = .5 + .5 * sin(u_arc * 6.28318 + u_seed * 6.28318);
  float direction = parity < .5 ? 1.0 : -1.0;
  float angle = u_motion * direction + epoch * .7;
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  p *= u_scale * mix(1.55, 3.8, epoch);

  float sides = 3.0 + floor(epoch * 5.999);
  float a = atan(p.y, p.x);
  float r = length(p);
  float polygon = cos(floor(.5 + a / 6.28318 * sides) * 6.28318 / sides - a) * r;
  float lattice = sin((p.x + direction * p.y) * (10.0 + epoch * 8.0) + u_motion * 2.0);
  float rings = sin(polygon * (18.0 + epoch * 12.0) - u_motion * direction * 3.0);
  float field = rings + lattice * (.55 + .25 * u_mid) + sin(a * sides + r * 8.0) * .3;
  float figure = step(0.0, field);
  figure = parity < .5 ? figure : 1.0 - figure;

  float hue = fract(u_seed + epoch * .12);
  vec3 dark = vec3(.08, 0.0, .08);
  vec3 light = vec3(0.0, .85, .85);
  vec3 col = mix(dark, light, figure);
  float edge = 1.0 - smoothstep(.0, .12, abs(field));
  col = mix(col, vec3(.337, .337, 0.0), edge * (.18 + .32 * u_high));
  float kickRing = exp(-pow((r - .16 - u_kick * .16) * 35.0, 2.0));
  col = mix(col, hsv(hue + .66, 1.0, .78), kickRing * u_kick * .7);
  gl_FragColor = vec4(col, 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return ((((deck?.trackId ?? 1919) * .61803398875) % 1) + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g19-parity-inversion',
  name: 'g19 parity inversion',
  hiRes: true,
  params: [
    { id: 'scale', label: 'geometry scale', min: .6, max: 1.6, step: .05, default: 1 },
    { id: 'speed', label: 'motion speed', min: .2, max: 2, step: .05, default: 1 },
  ],
  create: () => {
    let motion = 0;
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const slow = frame.bandsSlow ?? frame.bands;
      const dt = Math.min(.1, Math.max(0, frame.dt));
      const tierBar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const section = Math.floor(tierBar / 16);
      motion += dt * (.1 + slow.low * .16 + slow.mid * .2) * (frame.params.speed ?? 1);
      return {
        u_motion: motion, u_section: section,
        u_arc: (tierBar + (frame.beat?.barPhase ?? 0)) / 256,
        u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
        u_kick: frame.impulse.low, u_seed: seedOf(frame), u_scale: frame.params.scale ?? 1,
      };
    }});
  },
};

export default preset;
