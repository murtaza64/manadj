import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_focus;
uniform float u_flow;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_drive;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_seed;
uniform float u_blades;
uniform float u_stretch;
uniform float u_depth;
uniform float u_deckMix;

const float TAU = 6.2831853;
float hash(float n) { return fract(sin(n * 127.1 + u_seed * 311.7) * 43758.5453); }
vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float ngon(vec2 p, float blades) {
  float a = atan(p.y, p.x) + 3.14159265;
  float sector = TAU / blades;
  return cos(floor(0.5 + a / sector) * sector - a) * length(p);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 18; i++) {
    float fi = float(i);
    float z = fract(hash(fi + 2.0) + u_flow * (0.025 + hash(fi + 8.0) * 0.035));
    float angle = hash(fi + 17.0) * TAU + u_flow * (hash(fi + 9.0) - 0.5) * 0.14;
    float radius = 0.12 + hash(fi + 22.0) * 0.72;
    vec2 center = vec2(cos(angle), sin(angle)) * radius;
    center.x += (u_deckMix - 0.5) * (0.18 + 0.12 * hash(fi));
    float defocus = abs(z - u_focus);
    float size = (0.025 + defocus * 0.16) * u_depth;
    vec2 d = p - center;
    d.x /= 1.0 + u_stretch * 0.35 * defocus;
    float shape = ngon(d, u_blades);
    float body = smoothstep(size, size * 0.72, shape);
    float rim = exp(-pow((shape - size * 0.82) / max(size * 0.11, 0.001), 2.0));
    float onion = 0.5 + 0.5 * cos(shape / max(size, 0.001) * 22.0 - z * 8.0);
    float lum = (0.12 + 0.6 * u_mid + 0.8 * u_high) * (0.35 + 0.65 * defocus);
    float hue = fract(u_seed + hash(fi + 4.0) * (0.25 + 0.7 * u_spread) + u_centroid * 0.2);
    vec3 c = hsv(vec3(hue, 0.78 + 0.18 * u_flatness, 1.0));
    vec3 fringe = hsv(vec3(fract(hue + 0.42), 0.9, 1.0));
    col += c * body * lum * (0.16 + 0.14 * onion);
    col += mix(c, fringe, 0.55) * rim * lum * (0.3 + 0.8 * u_hat);
  }

  float flareY = exp(-pow(p.y * (55.0 - 30.0 * u_stretch), 2.0));
  float flareX = exp(-abs(p.x) * (1.5 + 2.0 * (1.0 - u_stretch)));
  vec3 flareCol = hsv(vec3(fract(u_seed + u_centroid * 0.35), 0.78, 1.0));
  col += flareCol * flareY * flareX * u_kick * (0.8 + 0.7 * u_low);
  for (int g = 0; g < 5; g++) {
    float fg = float(g) - 2.0;
    float ghost = exp(-pow((p.x - fg * 0.18) * 22.0, 2.0) - pow(p.y * 7.0, 2.0));
    col += hsv(vec3(fract(u_seed + fg * 0.11), 0.8, 1.0)) * ghost * u_kick * 0.24;
  }
  float rack = exp(-pow((length(p) - 0.25 - 0.18 * u_focus) * 35.0, 2.0));
  col += vec3(1.0, 0.92, 0.72) * rack * u_snare * 0.38;
  col *= 0.7 + 0.25 * u_drive;
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.88) col *= (0.88 + 0.12 * (1.0 - exp(-(m - 0.88) * 3.0))) / m;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const preset: VisualizerPreset = {
  id: 'g15-anamorphic-bloom',
  name: 'g15 anamorphic-bloom',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'depth', label: 'depth of field', min: 0.5, max: 1.8, step: 0.05, default: 1 },
    { id: 'stretch', label: 'anamorphic stretch', min: 0.2, max: 1.8, step: 0.05, default: 1 },
    { id: 'blades', label: 'aperture blades', min: 5, max: 9, step: 1, default: 7 },
  ],
  create: () => {
    let flow = 0;
    let focus = 0.5;
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.18 + slow.high * 0.35);
        let waveFocus = 0.5;
        if (frame.wave && frame.wave.left.length) {
          const i = Math.floor(frame.wave.left.length * 0.37);
          waveFocus += (frame.wave.left[i] - frame.wave.right[i]) * 0.18;
        }
        const targetFocus = frame.impulse.mid > 0.3 ? hash01(Math.floor(frame.time * 10)) : waveFocus;
        focus += (targetFocus - focus) * (1 - Math.exp(-dt / 0.42));
        const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
        const key = deck?.trackId ?? 47;
        const audible = frame.decks.filter((item) => item.playing && item.level > 0.02);
        const deckMix = audible.length > 1 ? audible[1].level / Math.max(0.01, audible[0].level + audible[1].level) : 0.5;
        return {
          u_time: frame.time, u_focus: focus, u_flow: flow,
          u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
          u_kick: frame.impulse.low, u_snare: frame.impulse.mid, u_hat: frame.impulse.high,
          u_drive: Math.min(1, Math.max(frame.regime?.sustained ?? 0, energyOf(frame.bands) * 1.4)),
          u_centroid: frame.centroid, u_spread: frame.spread, u_flatness: frame.flatness,
          u_seed: hash01(key), u_blades: Math.round(frame.params.blades ?? 7),
          u_stretch: frame.params.stretch ?? 1, u_depth: frame.params.depth ?? 1, u_deckMix: deckMix,
        };
      },
    });
  },
};

export default preset;
