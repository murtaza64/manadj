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
uniform float u_zoom;

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

float polygon(vec2 p, float sides) {
  float a = atan(p.y, p.x);
  return cos(floor(.5 + a / 6.28318 * sides) * 6.28318 / sides - a) * length(p);
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  float micro = mod(u_section, 2.0);
  float journey = .5 + .5 * sin(u_arc * 3.14159 - 1.5708);
  float sides = 3.0 + floor(journey * 6.999);
  float angle = u_motion * mix(1.0, -1.0, micro) + u_seed * 6.28318;
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  float field = 0.0;
  if (micro < .5) {
    float d = polygon(p / u_zoom, sides);
    field = sin(d * mix(11.0, 24.0, journey) - u_motion * 2.0);
    field += sin(atan(p.y, p.x) * sides) * .45;
  } else {
    float n = mix(9.0, 25.0, journey) / u_zoom;
    vec2 q = fract(p * n + .5) - .5;
    vec2 id = floor(p * n + .5);
    float turn = mod(id.x + id.y + floor(u_section), 2.0);
    q = turn < .5 ? q : q.yx;
    float d = polygon(q, sides);
    field = sin(d * n * 3.0 + (id.x - id.y) * .7 + u_motion * 2.0);
  }
  float shape = step(0.0, field);
  float hue = fract(u_seed + journey * .16);
  vec3 dark = vec3(.08, 0.0, .08);
  vec3 bright = vec3(0.0, .85, .85);
  vec3 col = mix(dark, bright, shape);
  float edge = 1.0 - smoothstep(.0, .14, abs(field));
  col = mix(col, vec3(.337, .337, 0.0), edge * (.25 + .35 * u_high));
  float core = exp(-dot(p, p) * (45.0 - 24.0 * u_kick));
  col = mix(col, hsv(hue + .7, 1.0, .78), core * u_kick);
  gl_FragColor = vec4(col, 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return ((((deck?.trackId ?? 1904) * .27182818284) % 1) + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g19-scale-relay', name: 'g19 scale relay', hiRes: true,
  params: [
    { id: 'zoom', label: 'scale ratio', min: .65, max: 1.5, step: .05, default: 1 },
    { id: 'speed', label: 'motion speed', min: .2, max: 2, step: .05, default: 1 },
  ],
  create: () => {
    let motion = 0;
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const slow = frame.bandsSlow ?? frame.bands;
      const dt = Math.min(.1, Math.max(0, frame.dt));
      const tierBar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const section = Math.floor(tierBar / 16);
      motion += dt * (.09 + slow.low * .15 + slow.high * .1) * (frame.params.speed ?? 1);
      return {
        u_motion: motion, u_section: section,
        u_arc: (tierBar + (frame.beat?.barPhase ?? 0)) / 256,
        u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
        u_kick: frame.impulse.low, u_seed: seedOf(frame), u_zoom: frame.params.zoom ?? 1,
      };
    }});
  },
};

export default preset;
