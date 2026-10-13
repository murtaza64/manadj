import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_motion;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_drive;
uniform float u_drop;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_bar;
uniform float u_barPhase;
uniform float u_section;
uniform float u_flip;
uniform float u_seed;
uniform float u_gap;
uniform float u_flipDepth;
uniform float u_rotation;
uniform float u_decks[4];
uniform float u_spectrum[24];
vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
float spec(float index) {
  float v = 0.0;
  for (int i = 0; i < 24; i++) if (abs(float(i) - index) < .5) v = u_spectrum[i];
  return v;
}
float deck(float index) {
  float v = 0.0;
  for (int i = 0; i < 4; i++) if (abs(float(i) - index) < .5) v = u_decks[i];
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 grid = vec2(8.0, 5.0);
  vec2 id = floor(uv * grid);
  vec2 cell = fract(uv * grid);
  float district = floor(id.x / 4.0) + 2.0 * floor(id.y / 2.5);
  float role = mod(district + floor(u_section * u_rotation), 4.0);
  float index = mod(id.x + id.y * 8.0, 24.0);
  float metric = step(mod(id.x, 4.0), u_bar) * (.45 + .55 * u_barPhase);
  float bass = smoothstep(.18, .85, u_low + u_kick * .65 - abs(id.x - id.y - 1.5) * .06);
  float spectrum = spec(index);
  float tonal = mix(.5 + .5 * sin(id.x * 1.7 + id.y * 2.3 + u_motion), fract(index * .381 + u_motion * .08), u_flatness);
  float signal = role < .5 ? metric : (role < 1.5 ? bass : (role < 2.5 ? spectrum : tonal));
  float deckLift = deck(mod(district, 4.0));
  float dropLine = exp(-pow((id.x + id.y - u_drop * 12.0) * .9, 2.0));
  signal = mix(signal, 1.0, dropLine * u_drive * .7);
  float delay = fract((id.x * 3.0 + id.y * 5.0) * .071);
  float turn = smoothstep(delay, min(1.0, delay + .28), u_flip);
  float fold = abs(cell.y - .5) * 2.0;
  float face = mix(1.0, .34 + .66 * fold, sin(turn * 3.14159) * u_flipDepth);
  float hue = fract(u_seed + role * .228 + district * .031 + u_centroid * .12);
  vec3 dark = hsv(hue + .48, .72, .055);
  vec3 bright = hsv(hue, .96 - u_flatness * .15, .62 + deckLift * .16);
  vec3 col = mix(dark, bright, smoothstep(.24, .72, signal)) * face;
  float aperture = smoothstep(u_gap, u_gap + .02, min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y)));
  col *= aperture;
  float crease = exp(-pow((cell.y - .5) * 90.0, 2.0));
  col *= 1.0 - crease * .48;
  float pin = smoothstep(.075, .035, length(cell - vec2(.07, .5))) + smoothstep(.075, .035, length(cell - vec2(.93, .5)));
  col += vec3(.16) * pin * aperture;
  col *= .84 + .12 * u_drive + .04 * u_high;
  float mx = max(col.r, max(col.g, col.b));
  if (mx > .9) col *= (.9 + .1 * (1.0 - exp(-(mx - .9) * 3.0))) / mx;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return (((deck?.trackId ?? 181) * .569840296) % 1 + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g16-flip-matrix', name: 'g16 flip matrix', hiRes: true,
  params: [
    { id: 'gap', label: 'cell gap', min: .02, max: .13, step: .005, default: .065 },
    { id: 'flipDepth', label: 'flip depth', min: .2, max: 1, step: .05, default: .78 },
    { id: 'rotation', label: 'district rotation', min: .5, max: 2, step: .5, default: 1 },
  ],
  create: () => {
    let motion = 0; let flip = 1; let lastSection = -1;
    const spectrum = new Float32Array(24); const decks = new Float32Array(4);
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const dt = Math.min(.1, Math.max(0, frame.dt)); const slow = frame.bandsSlow ?? frame.bands;
      motion += dt * (.16 + slow.mid * .3 + slow.high * .12);
      const tierBar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const section = Math.floor(tierBar / 16);
      if (lastSection >= 0 && section !== lastSection) flip = 0;
      lastSection = section; flip = Math.min(1, flip + dt / .9);
      for (let i = 0; i < 24; i++) spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
      for (let i = 0; i < 4; i++) decks[i] = frame.decks.find((deck) => deck.channel === ['A', 'B', 'C', 'D'][i])?.level ?? 0;
      return {
        u_motion: motion, u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
        u_kick: frame.impulse.low, u_drive: frame.regime?.sustained ?? 0,
        u_drop: Math.min(1, (frame.regime?.dropAgeS ?? 9) / 1.4), u_centroid: frame.centroid,
        u_spread: frame.spread, u_flatness: frame.flatness, u_bar: ((tierBar % 4) + 4) % 4,
        u_barPhase: frame.beat?.barPhase ?? 0, u_section: section, u_flip: flip, u_seed: seedOf(frame),
        u_gap: frame.params.gap ?? .065, u_flipDepth: frame.params.flipDepth ?? .78,
        u_rotation: frame.params.rotation ?? 1, u_decks: decks, u_spectrum: spectrum,
      };
    }});
  },
};
export default preset;
