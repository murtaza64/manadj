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
uniform float u_snare;
uniform float u_hat;
uniform float u_drive;
uniform float u_handoff;
uniform float u_roleShift;
uniform float u_bar;
uniform float u_barPhase;
uniform float u_seed;
uniform float u_depth;
uniform float u_border;
uniform float u_iris;
uniform float u_spectrum[24];
uniform float u_wave[24];
const float TAU = 6.2831853;
vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, .666667, .333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
float sample24(float x, float mode) {
  float v = 0.0; float k = floor(clamp(x, 0.0, .999) * 24.0);
  for (int i = 0; i < 24; i++) if (abs(float(i) - k) < .5) v = mode < .5 ? u_spectrum[i] : u_wave[i];
  return v;
}
vec3 roleScene(float role, vec2 uv, vec2 p) {
  float hue = fract(u_seed + role * .217);
  vec3 col = hsv(hue + .5, .65, .055);
  if (role < .5) {
    float r = length(p);
    float wave = exp(-pow((r - .2 - .11 * sin(u_motion * .35)) * 32.0, 2.0));
    col += hsv(hue, .94, .74) * smoothstep(.42 + u_low * .08, .08, r);
    col += hsv(hue + .11, .8, 1.0) * wave * u_kick;
  } else if (role < 1.5) {
    float s = sample24(uv.x, 0.0);
    col += hsv(hue + uv.x * .3, .94, .72) * step(uv.y, s * .86);
    col += hsv(hue + .15, .7, 1.0) * exp(-pow((uv.y - s * .86) * 48.0, 2.0)) * u_hat;
  } else if (role < 2.5) {
    float cell = floor(uv.x * 4.0);
    float active = step(cell, u_bar) + step(abs(cell - u_bar), .4) * step(uv.y, u_barPhase);
    col += hsv(hue + cell * .05, .9, .78) * step(.1, active) * step(uv.y, .68 + .18 * step(abs(cell - u_bar), .4));
  } else {
    float wave = sample24(uv.x, 1.0);
    float line = exp(-pow((p.y - wave * .34) * 75.0, 2.0));
    float twin = exp(-pow((p.y + wave * .28) * 75.0, 2.0));
    col += hsv(hue + uv.x * .18, .9, .95) * (line + twin * .65) * (.55 + u_mid);
  }
  return col;
}
vec4 box(vec2 uv, vec2 center, vec2 size, float role) {
  vec2 q = (uv - center) / size + .5;
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  vec2 edge2 = min(q, 1.0 - q);
  float edge = min(edge2.x, edge2.y);
  float frame = inside * (1.0 - smoothstep(u_border, u_border + .012, edge));
  vec3 col = roleScene(role, q, q - .5) * inside;
  col += hsv(fract(u_seed + role * .217), .9, .88) * frame * (.55 + u_kick * .35);
  return vec4(col, inside);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - .5) * vec2(aspect, 1.0);
  float iris = mix(1.0 - u_iris * .18, 1.0, u_handoff);
  vec3 col = roleScene(mod(u_roleShift, 4.0), uv, p);
  vec4 large = box(uv, vec2(.5), vec2(.64, .58) * iris, mod(u_roleShift + 1.0, 4.0));
  col = mix(col, large.rgb, large.a);
  vec4 middle = box(uv, vec2(.58, .48), vec2(.36, .31) * (1.0 + u_depth * .08), mod(u_roleShift + 2.0, 4.0));
  col = mix(col, middle.rgb, middle.a);
  vec4 small = box(uv, vec2(.43, .57), vec2(.2, .17), mod(u_roleShift + 3.0, 4.0));
  col = mix(col, small.rgb, small.a);
  float propagation = exp(-pow((length(p) - u_handoff * .9) * 25.0, 2.0));
  col += hsv(u_seed + .1, .65, .85) * propagation * u_kick * .22;
  col *= .84 + .12 * u_drive + .05 * u_snare;
  float mx = max(col.r, max(col.g, col.b));
  if (mx > .92) col *= (.92 + .08 * (1.0 - exp(-(mx - .92) * 3.0))) / mx;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return (((deck?.trackId ?? 173) * .754877666) % 1 + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g16-signal-in-signal', name: 'g16 signal-in-signal', hiRes: true, wantsWave: true,
  params: [
    { id: 'depth', label: 'nesting depth', min: 0, max: 2, step: .05, default: 1 },
    { id: 'border', label: 'frame weight', min: .015, max: .1, step: .005, default: .045 },
    { id: 'iris', label: 'iris handoff', min: 0, max: 2, step: .05, default: 1 },
  ],
  create: () => {
    let motion = 0; let handoff = 1; let roleShift = 0; let lastPhrase = -1;
    const spectrum = new Float32Array(24); const wave = new Float32Array(24);
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const dt = Math.min(.1, Math.max(0, frame.dt)); const slow = frame.bandsSlow ?? frame.bands;
      motion += dt * (.2 + slow.low * .25 + slow.mid * .22);
      const tierBar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const phrase = Math.floor(tierBar / 4);
      if (lastPhrase >= 0 && phrase !== lastPhrase) { roleShift = (roleShift + 1) % 4; handoff = 0; }
      lastPhrase = phrase; handoff = Math.min(1, handoff + dt / .8);
      for (let i = 0; i < 24; i++) {
        spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
        const source = frame.wave?.left; const right = frame.wave?.right;
        const index = source ? Math.floor(i / 23 * (source.length - 1)) : 0;
        wave[i] = source ? ((source[index] ?? 0) + (right?.[index] ?? 0)) * .5 : Math.sin(i * .7 + motion) * frame.bands.mid;
      }
      return {
        u_motion: motion, u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
        u_kick: frame.impulse.low, u_snare: frame.impulse.mid, u_hat: frame.impulse.high,
        u_drive: frame.regime?.sustained ?? 0, u_handoff: handoff, u_roleShift: roleShift,
        u_bar: ((tierBar % 4) + 4) % 4, u_barPhase: frame.beat?.barPhase ?? 0, u_seed: seedOf(frame),
        u_depth: frame.params.depth ?? 1, u_border: frame.params.border ?? .045,
        u_iris: frame.params.iris ?? 1, u_spectrum: spectrum, u_wave: wave,
      };
    }});
  },
};
export default preset;
