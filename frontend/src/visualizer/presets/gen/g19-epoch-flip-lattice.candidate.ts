import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_motion;
uniform float u_mode;
uniform float u_cells;
uniform float u_epoch;
uniform float u_hue;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_drive;
uniform float u_gap;
vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
void main() {
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  if (u_mode > .5 && u_mode < 1.5) p = vec2(p.x + p.y, p.y - p.x) * .7071;
  if (u_mode > 1.5 && u_mode < 2.5) p = abs(p);
  if (u_mode > 2.5) {
    float r = length(p);
    float a = atan(p.y, p.x);
    a = abs(mod(a + .392699, .785398) - .392699);
    p = vec2(cos(a), sin(a)) * r;
  }
  vec2 q = p * u_cells;
  vec2 id = floor(q);
  vec2 cell = fract(q) - .5;
  float parity = mod(id.x + id.y, 2.0);
  float d;
  if (u_mode < .5) d = max(abs(cell.x), abs(cell.y));
  else if (u_mode < 1.5) d = abs(cell.x) + abs(cell.y);
  else if (u_mode < 2.5) d = length(cell) * (1.0 + .28 * sin(atan(cell.y, cell.x) * 6.0));
  else d = max(abs(cell.x), abs(cell.y)) - min(abs(cell.x), abs(cell.y)) * .35;
  float signal = .5 + .5 * sin(id.x * 1.31 + id.y * 2.17 + u_motion + parity * 3.14159);
  signal = mix(signal, 1.0, u_kick * exp(-abs(length(p) - .12 - u_kick * .3) * 28.0));
  float fill = 1.0 - smoothstep(.28 - u_gap, .32 + u_gap, d);
  float wire = exp(-abs(d - (.36 + .08 * signal)) * (55.0 - u_epoch * 15.0));
  float hue = fract(u_hue + u_epoch * .72 + parity * .34 + signal * .09);
  vec3 bg = hsv(hue + .48, .82, .035 + .04 * u_drive);
  vec3 tile = hsv(hue, .96, .38 + .38 * signal + .12 * u_low);
  vec3 edge = hsv(hue + .17, .88, .95);
  vec3 col = mix(bg, tile, fill) + edge * wire * (.18 + .34 * u_high);
  col *= .82 + .14 * u_drive;
  float mx = max(col.r, max(col.g, col.b));
  if (mx > .92) col *= (.92 + .08 * (1.0 - exp(-(mx - .92) * 3.0))) / mx;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return (((deck?.trackId ?? 719) * .754877666) % 1 + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g19-epoch-flip-lattice',
  name: 'g19 epoch flip lattice',
  hiRes: true,
  params: [
    { id: 'density', label: 'lattice density', min: .65, max: 1.5, step: .05, default: 1 },
    { id: 'gap', label: 'cell aperture', min: 0, max: .12, step: .01, default: .04 },
  ],
  create: () => {
    let motion = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        motion += dt * (.12 + slow.mid * .22 + slow.high * .08);
        const bar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
        const section = Math.floor(bar / 16);
        const epochStep = ((section % 4) + 4) % 4;
        const epoch = epochStep / 3;
        return {
          u_motion: motion,
          u_mode: ((section % 4) + 4) % 4,
          u_cells: (5 + epochStep * 4) * (frame.params.density ?? 1),
          u_epoch: epoch,
          u_hue: seedOf(frame),
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_drive: Math.max(frame.regime?.sustained ?? 0, slow.low * .6 + slow.mid * .4),
          u_gap: frame.params.gap ?? .04,
        };
      },
    });
  },
};

export default preset;
