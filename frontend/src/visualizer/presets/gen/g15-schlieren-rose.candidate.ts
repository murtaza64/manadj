import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const N = 24;
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_decay;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_flow;
uniform float u_sym;
uniform float u_fringe;
uniform float u_hue;
uniform float u_drive;
uniform float u_spread;
uniform float u_flatness;
uniform float u_waveAge;
uniform float u_waveAmp;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_spectrum[24];

const float TAU = 6.2831853;

vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 hueRotate(vec3 c, float turn) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float a = atan(q, i) + turn * TAU;
  float ch = length(vec2(i, q));
  i = ch * cos(a); q = ch * sin(a);
  return max(vec3(0.0), vec3(y + 0.956*i + 0.621*q, y - 0.272*i - 0.647*q, y - 1.106*i - 1.703*q));
}

float relief(float a, float r) {
  float s = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float eq = fi < 8.0 ? u_eqLow : (fi < 16.0 ? u_eqMid : u_eqHigh);
    s += u_spectrum[i] * eq * sin(a * (u_sym + fi * 0.42) + r * (5.0 + fi * 0.3) - u_flow * (0.5 + fi * 0.018)) / (2.0 + fi * 0.3);
  }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float rose = relief(a, r);
  float fold = sin(a * u_sym + rose * 5.0 + r * 11.0 - u_flow);
  float fold2 = cos(a * (u_sym + 2.0) - rose * 3.0 - r * 7.0 + u_flow * 0.61);
  vec2 grad = normalize(vec2(-p.y, p.x) + 0.001) * fold + normalize(p + 0.001) * fold2;

  float front = 0.08 + u_waveAge * 0.72;
  float pressure = exp(-pow((r - front) * 18.0, 2.0)) * exp(-u_waveAge * 1.8) * u_waveAmp;
  vec2 warp = grad * (0.003 + 0.008 * u_spread) + normalize(p + 0.001) * pressure * 0.025;
  float twist = 0.002 * sin(rose * 8.0) * (0.3 + u_drive);
  vec2 src = uv + warp / vec2(aspect, 1.0) + vec2(-p.y, p.x) * twist / vec2(aspect, 1.0);

  vec2 ab = normalize(grad + 0.001) * u_fringe * (0.001 + 0.006 * abs(rose) + 0.006 * pressure) / vec2(aspect, 1.0);
  vec3 ca = hueRotate(texture2D(u_prev, src + ab).rgb, -u_hue);
  vec3 cc = hueRotate(texture2D(u_prev, src).rgb, -u_hue);
  vec3 cb = hueRotate(texture2D(u_prev, src - ab).rgb, -u_hue);
  vec3 field = hueRotate(vec3(ca.r, cc.g, cb.b), u_hue) * u_decay;

  float schlieren = pow(abs(fold * fold2), mix(8.0, 2.5, u_flatness));
  float caustic = pow(max(0.0, 1.0 - abs(rose * 4.0 + fold * 0.22)), 12.0);
  float petal = exp(-pow((r - 0.28 - rose * 0.08) * 18.0, 2.0));
  float coreCut = smoothstep(0.08 + 0.03 * u_low, 0.14 + 0.04 * u_low, r);
  vec3 glass = hsv(vec3(fract(u_hue + rose * 0.35 + r * 0.4), 0.92, 1.0));
  vec3 fresh = glass * (schlieren * 0.35 + caustic * 1.4 + petal * 0.3) * coreCut;
  fresh += hsv(vec3(fract(u_hue + 0.5), 0.85, 1.0)) * pressure * (0.8 + caustic * 2.0);
  fresh += vec3(1.0, 0.9, 0.65) * petal * u_snare * 0.8;
  fresh += hsv(vec3(fract(u_hue + 0.25), 0.8, 1.0)) * caustic * u_hat * 0.5;
  field += fresh * (1.0 - u_decay) * (4.0 + 2.0 * u_drive + u_mid + u_high);
  field *= 1.0 + 0.08 * u_kick;
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function dominant(frame: VisualizerFrameData) {
  return frame.decks.find((deck) => deck.channel === frame.dominantChannel) ?? null;
}

const preset: VisualizerPreset = {
  id: 'g15-schlieren-rose',
  name: 'g15 schlieren-rose',
  hiRes: true,
  params: [
    { id: 'fringe', label: 'optical fringe', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'memory', label: 'glass memory', min: 0.5, max: 1.6, step: 0.05, default: 1 },
    { id: 'relief', label: 'relief depth', min: 0.4, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let flow = 0;
    let waveAge = 99;
    let waveAmp = 0;
    let hue = 0;
    let symmetry = 7;
    let lastSection = -1;
    const spectrum = new Float32Array(N);
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        const drive = Math.min(1, Math.max(frame.regime?.sustained ?? 0, energyOf(frame.bands) * 1.3));
        flow += dt * (0.18 + slow.mid * 0.5 + slow.high * 0.2);
        waveAge += dt;
        if (frame.impulse.low > 0.3 && waveAge > 0.14) {
          waveAge = 0;
          waveAmp = frame.impulse.low;
        }
        const deck = dominant(frame);
        const key = deck?.trackId ?? 19;
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
        const section = Math.floor(bar / 16);
        if (section !== lastSection) {
          symmetry = 5 + Math.floor(hash01(key + section * 97) * 6);
          lastSection = section;
        }
        const targetHue = hash01(key) + frame.centroid * 0.35;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.5));
        const relief = frame.params.relief ?? 1;
        for (let i = 0; i < N; i++) spectrum[i] = Math.min(1, (frame.spectrum[i] ?? 0) * relief);
        const memory = frame.params.memory ?? 1;
        return {
          u_time: frame.time,
          u_decay: Math.min(0.99, 1 - (1 - 0.966) / memory),
          u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
          u_kick: frame.impulse.low, u_snare: frame.impulse.mid, u_hat: frame.impulse.high,
          u_flow: flow, u_sym: symmetry, u_fringe: frame.params.fringe ?? 1,
          u_hue: hue, u_drive: drive, u_spread: frame.spread, u_flatness: frame.flatness,
          u_waveAge: waveAge, u_waveAmp: waveAmp,
          u_eqLow: Math.max(0, (deck?.eq.low ?? 0.5) * 2),
          u_eqMid: Math.max(0, (deck?.eq.mid ?? 0.5) * 2),
          u_eqHigh: Math.max(0, (deck?.eq.high ?? 0.5) * 2),
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
