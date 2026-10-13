import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_motion;
uniform float u_mode;
uniform float u_section;
uniform float u_arc;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_seed;
uniform float u_detail;

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  float epoch = fract(u_arc);
  float freq = (7.0 + epoch * 10.0) * u_detail;
  float seedAngle = u_seed * 6.28318;
  p = mat2(cos(seedAngle), -sin(seedAngle), sin(seedAngle), cos(seedAngle)) * p;
  float r = length(p);
  float a = atan(p.y, p.x);
  float field = 0.0;
  if (u_mode < .5) {
    field = sin(a * (5.0 + floor(epoch * 4.0)) + r * 18.0 - u_motion * 2.0);
  } else if (u_mode < 1.5) {
    field = sin(p.x * freq + u_motion) * sin(p.y * freq - u_motion);
  } else if (u_mode < 2.5) {
    field = sin((p.x + p.y) * freq + u_motion) * sin((p.x - p.y) * (freq * .73) - u_motion);
  } else {
    float sides = 3.0 + floor(epoch * 6.999);
    float polygon = cos(floor(.5 + a / 6.28318 * sides) * 6.28318 / sides - a) * r;
    field = sin(polygon * (24.0 + epoch * 12.0) - u_motion * 2.0);
  }
  float shape = step(0.0, field);
  float hue = fract(u_seed + epoch * .16);
  vec3 c0 = vec3(.08, 0.0, .08);
  vec3 c1 = vec3(0.0, .85, .85);
  vec3 col = mix(c0, c1, shape);
  float edge = 1.0 - smoothstep(.0, .1 + .08 * u_mid, abs(field));
  col = mix(col, vec3(.337, .337, 0.0), edge * .5);
  float strike = exp(-pow((r - .12 - u_kick * .28) * 42.0, 2.0));
  col = mix(col, hsv(hue + .66, 1.0, .8), strike * u_kick);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ORDER = [0, 1, 2, 3, 0, 3, 2, 1] as const;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return ((((deck?.trackId ?? 1902) * .41421356237) % 1) + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g19-topology-spiral', name: 'g19 topology spiral', hiRes: true,
  params: [
    { id: 'detail', label: 'topology detail', min: .6, max: 1.8, step: .05, default: 1 },
    { id: 'speed', label: 'motion speed', min: .2, max: 2, step: .05, default: 1 },
  ],
  create: () => {
    let motion = 0;
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const slow = frame.bandsSlow ?? frame.bands;
      const dt = Math.min(.1, Math.max(0, frame.dt));
      const tierBar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const section = Math.floor(tierBar / 16);
      motion += dt * (.13 + slow.mid * .25 + slow.high * .09) * (frame.params.speed ?? 1);
      return {
        u_motion: motion, u_mode: ORDER[((section % 8) + 8) % 8], u_section: section,
        u_arc: (tierBar + (frame.beat?.barPhase ?? 0)) / 128,
        u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
        u_kick: frame.impulse.low, u_seed: seedOf(frame), u_detail: frame.params.detail ?? 1,
      };
    }});
  },
};

export default preset;
