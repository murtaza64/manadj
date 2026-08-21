import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const N = 24;
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_flow;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_drive;
uniform float u_buildup;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_seed;
uniform float u_emboss;
uniform float u_diffraction;
uniform float u_waveAge;
uniform float u_waveAmp;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_spectrum[24];

const float TAU = 6.2831853;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float sheet(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float eq = fi < 8.0 ? u_eqLow : (fi < 16.0 ? u_eqMid : u_eqHigh);
    float angle = fi * 2.39996 + u_seed * TAU;
    vec2 axis = vec2(cos(angle), sin(angle));
    float ridge = dot(p, axis) * (2.2 + fi * 0.31) + u_flow * (0.12 + fi * 0.007);
    h += sin(ridge * TAU + sin(ridge * 1.7)) * u_spectrum[i] * eq / (3.0 + fi * 0.32);
  }
  return h * u_emboss;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float e = 0.0025;
  float h = sheet(p);
  float hx = sheet(p + vec2(e, 0.0)) - sheet(p - vec2(e, 0.0));
  float hy = sheet(p + vec2(0.0, e)) - sheet(p - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx * 65.0, -hy * 65.0, 1.0));
  vec3 lightDir = normalize(vec3(cos(u_flow * 0.17), sin(u_flow * 0.13) * 0.5, 0.72));
  float ndl = dot(n, lightDir);
  float graze = pow(max(0.0, 1.0 - abs(ndl)), 2.0);
  float phase = (ndl * 4.5 + h * 9.0 + p.x * 0.8 + p.y * 0.35) * u_diffraction;
  vec3 rainbow = vec3(
    0.5 + 0.5 * cos(TAU * (phase + 0.0)),
    0.5 + 0.5 * cos(TAU * (phase + 0.333333)),
    0.5 + 0.5 * cos(TAU * (phase + 0.666667))
  );
  rainbow = mix(rainbow, hsv(vec3(fract(u_seed + phase * 0.13), 0.92, 1.0)), 0.45 + 0.35 * u_spread);

  float crease = pow(1.0 - max(0.0, n.z), mix(3.0, 1.2, u_flatness));
  float specular = pow(max(0.0, dot(reflect(-lightDir, n), vec3(0.0, 0.0, 1.0))), 30.0 - 18.0 * u_flatness);
  vec3 base = mix(vec3(0.015, 0.012, 0.025), vec3(0.1, 0.08, 0.13), 0.5 + 0.5 * h);
  vec3 col = base + rainbow * (0.16 + 0.65 * graze + 0.45 * specular) * (0.55 + 0.45 * u_drive);
  col *= 1.0 - 0.7 * crease;
  col += mix(rainbow, vec3(1.0), 0.65) * specular * (0.35 + u_high + 0.7 * u_hat);

  float front = -0.8 + u_waveAge * 1.15;
  float pressure = exp(-pow((p.x - front) * 22.0, 2.0)) * exp(-u_waveAge * 1.25) * u_waveAmp;
  col += rainbow * pressure * (0.45 + 1.8 * crease + u_low);
  float slash = exp(-pow((dot(p, normalize(vec2(0.8, 0.35))) - 0.15) * 75.0, 2.0));
  col += hsv(vec3(fract(u_seed + 0.52), 0.85, 1.0)) * slash * u_snare * 0.45;
  float pin = pow(hash(floor(gl_FragCoord.xy * 0.22) + floor(u_time * 5.0)), 42.0);
  col += vec3(1.0, 0.95, 0.8) * pin * u_hat * 0.55;
  col *= 0.82 + 0.16 * u_drive - 0.08 * u_buildup;
  col *= 1.0 + 0.07 * u_kick;
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.9) col *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 3.0))) / m;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const preset: VisualizerPreset = {
  id: 'g15-holo-foil',
  name: 'g15 holo-foil',
  hiRes: true,
  params: [
    { id: 'emboss', label: 'emboss depth', min: 0.3, max: 1.8, step: 0.05, default: 1 },
    { id: 'diffraction', label: 'diffraction width', min: 0.4, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let flow = 0;
    let waveAge = 99;
    let waveAmp = 0;
    const spectrum = new Float32Array(N);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.12 + slow.mid * 0.3 + slow.high * 0.12);
        waveAge += dt;
        if (frame.impulse.low > 0.32 && waveAge > 0.18) {
          waveAge = 0;
          waveAmp = frame.impulse.low;
        }
        const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
        const eqLow = Math.max(0, (deck?.eq.low ?? 0.5) * 2);
        const eqMid = Math.max(0, (deck?.eq.mid ?? 0.5) * 2);
        const eqHigh = Math.max(0, (deck?.eq.high ?? 0.5) * 2);
        for (let i = 0; i < N; i++) spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
        const energy = energyOf(frame.bands);
        return {
          u_time: frame.time, u_flow: flow,
          u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
          u_kick: frame.impulse.low, u_snare: frame.impulse.mid, u_hat: frame.impulse.high,
          u_drive: Math.min(1, Math.max(frame.regime?.sustained ?? 0, energy * 1.4)),
          u_buildup: frame.regime?.buildup ?? 0,
          u_centroid: frame.centroid, u_spread: frame.spread, u_flatness: frame.flatness,
          u_seed: hash01(deck?.trackId ?? 71),
          u_emboss: frame.params.emboss ?? 1, u_diffraction: frame.params.diffraction ?? 1,
          u_waveAge: waveAge, u_waveAmp: waveAmp,
          u_eqLow: eqLow, u_eqMid: eqMid, u_eqHigh: eqHigh, u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
