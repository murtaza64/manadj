import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

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
uniform float u_hue;
uniform float u_analyzer;
uniform float u_scale;
uniform float u_order;
uniform float u_phrase;
uniform float u_section;
uniform float u_drop;
uniform float u_buildup;
uniform float u_defectAge;
uniform float u_defectAmp;
uniform float u_spread;
uniform float u_flatness;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_spectrum[24];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), u.x), u.y);
}

vec3 hsv(float h, float s, float v) {
  vec3 q = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(q - 1.0, 0.0, 1.0), s);
}

float director(vec2 p) {
  float a = (noise(p * u_scale + vec2(u_flow * 0.08, -u_flow * 0.05)) - 0.5) * 5.2;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float eq = fi < 8.0 ? u_eqLow : (fi < 16.0 ? u_eqMid : u_eqHigh);
    vec2 axis = vec2(cos(fi * 2.399), sin(fi * 2.399));
    a += sin(dot(p, axis) * (2.0 + fi * 0.3) + u_flow * (0.08 + fi * 0.005)) * u_spectrum[i] * eq / (3.4 + fi * 0.22);
  }
  return a;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(p);
  float angle = director(p);
  float front = 0.03 + u_defectAge * 0.68;
  float defect = exp(-pow((r - front) * 20.0, 2.0)) * exp(-u_defectAge * 1.45) * u_defectAmp;
  angle += defect * 1.8 * sin(atan(p.y, p.x) * 2.0 + u_flow);
  float crossed = pow(abs(sin(2.0 * (angle - u_analyzer))), 2.0);
  float texture = noise(p * (u_scale * 2.3) - vec2(u_flow * 0.04, 0.0));
  float retardation = (0.8 + u_order * 3.5) * (0.35 + texture * 0.65 + u_spread * 0.35)
    + angle * 0.35 + u_phrase * 0.75;
  vec3 colorA = hsv(fract(u_hue + retardation * 0.16), 0.98, 1.0);
  vec3 colorB = hsv(fract(u_hue + 0.43 - retardation * 0.11), 0.94, 1.0);
  float bands = pow(0.5 + 0.5 * sin(retardation * 6.28318), mix(2.8, 1.1, u_flatness));
  vec3 color = mix(colorA, colorB, bands) * crossed;
  float domainWall = pow(abs(sin(angle * 2.0 + texture * 4.0)), 14.0);
  color += hsv(fract(u_hue + 0.67), 0.9, 1.0) * domainWall * (0.12 + u_high * 0.55);
  color += mix(colorA, colorB, 0.5) * defect * crossed * (0.55 + u_low);
  float snareFork = exp(-pow((sin(angle + p.x * 8.0) - p.y * 0.8) * 22.0, 2.0));
  color += colorB * snareFork * u_snare * 0.65;
  float hatThread = pow(max(0.0, sin(angle * 7.0 + texture * 12.0)), 22.0);
  color += vec3(0.8, 1.0, 0.6) * hatThread * (u_hat * 0.7 + u_high * 0.08);
  float sectionCross = exp(-pow((abs(p.x + p.y) - u_section * 0.9) * 12.0, 2.0));
  color += hsv(fract(u_hue + 0.25), 0.96, 1.0) * sectionCross * u_section * 0.65;
  color *= 0.68 + 0.32 * max(u_drop, max(u_low, u_mid)) + u_buildup * 0.08;
  color *= 1.0 + u_kick * 0.05;
  float m = max(color.r, max(color.g, color.b));
  if (m > 0.9) color *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 2.4))) / m;
  gl_FragColor = vec4(max(color, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const preset: VisualizerPreset = {
  id: 'g16-polarized-nematic',
  name: 'g16 polarized-nematic',
  hiRes: true,
  params: [
    { id: 'analyzer', label: 'analyzer angle', min: 0, max: 1, step: 0.02, default: 0.35 },
    { id: 'scale', label: 'domain scale', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'order', label: 'birefringence order', min: 0.2, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let flow = 0;
    let hue = 0.68;
    let analyzer = 0.35;
    let defectAge = 99;
    let defectAmp = 0;
    let section = 0;
    let sectionTurn = 0;
    let lastSection = -1;
    let drop = 0;
    let buildup = 0;
    const spectrum = new Float32Array(24);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.16 + slow.mid * 0.42 + slow.high * 0.08);
        defectAge += dt;
        if (frame.impulse.low > 0.3 && defectAge > 0.15) {
          defectAge = 0;
          defectAmp = Math.min(1, frame.impulse.low * 1.25);
        }
        const deck = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        const targetHue = hash01(deck?.trackId ?? 509) + frame.centroid * 0.8;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.8));
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const sectionIndex = Math.floor(bar / 16);
        if (lastSection >= 0 && sectionIndex !== lastSection) {
          section = 1;
          sectionTurn = hash01((deck?.trackId ?? 1) + sectionIndex * 113) * Math.PI;
        }
        lastSection = sectionIndex;
        section = Math.max(0, section - dt / 1.35);
        const phrase = frame.beat ? ((((bar % 16) + 16) % 16) + frame.beat.barPhase) / 16 : 0.5;
        const analyzerTarget = (frame.params.analyzer ?? 0.35) * Math.PI + sectionTurn + phrase * 0.18;
        analyzer += (analyzerTarget - analyzer) * (1 - Math.exp(-dt / 0.45));
        drop += ((frame.regime?.sustained ?? 0) - drop) * (1 - Math.exp(-dt / 0.38));
        buildup += ((frame.regime?.buildup ?? 0) - buildup) * (1 - Math.exp(-dt / 0.38));
        for (let i = 0; i < 24; i++) spectrum[i] = Math.min(1, Math.max(0, frame.spectrum[i] ?? 0));
        const eq = deck?.eq;
        return {
          u_time: frame.time,
          u_flow: flow,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_hue: hue,
          u_analyzer: analyzer,
          u_scale: (3.2 + hash01((deck?.trackId ?? 1) + 31) * 2.2) * (frame.params.scale ?? 1),
          u_order: frame.params.order ?? 1,
          u_phrase: phrase,
          u_section: section,
          u_drop: drop,
          u_buildup: buildup,
          u_defectAge: defectAge,
          u_defectAmp: defectAmp,
          u_spread: frame.spread,
          u_flatness: frame.flatness,
          u_eqLow: eq ? Math.min(1.7, eq.low * 2) : 1,
          u_eqMid: eq ? Math.min(1.7, eq.mid * 2) : 1,
          u_eqHigh: eq ? Math.min(1.7, eq.high * 2) : 1,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
