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
uniform float u_scale;
uniform float u_relief;
uniform float u_scan;
uniform float u_scanWidth;
uniform float u_phrase;
uniform float u_section;
uniform float u_focusAge;
uniform float u_focusAmp;
uniform float u_spread;
uniform float u_flatness;
uniform float u_drop;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_spectrum[24];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p + 17.3), hash(p.yx + 41.7));
}

vec3 hsv(float h, float s, float v) {
  vec3 q = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(q - 1.0, 0.0, 1.0), s);
}

float spectrumRelief(vec2 p) {
  float value = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float eq = fi < 8.0 ? u_eqLow : (fi < 16.0 ? u_eqMid : u_eqHigh);
    vec2 axis = vec2(cos(fi * 2.399 + u_hue * 6.283), sin(fi * 2.399 + u_hue * 6.283));
    value += u_spectrum[i] * eq * sin(dot(p, axis) * (2.5 + fi * 0.32) + u_flow * (0.13 + fi * 0.006)) / (3.0 + fi * 0.24);
  }
  return value;
}

vec3 specimen(vec2 p) {
  vec2 q = p * u_scale;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float d1 = 10.0;
  float d2 = 10.0;
  float owner = 0.0;
  vec2 nearest = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 seed = hash2(cell + g);
      vec2 r = g + seed - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        nearest = r;
        owner = hash(cell + g + 93.1);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float wallDistance = sqrt(d2) - sqrt(d1);
  float wall = exp(-wallDistance * wallDistance * mix(160.0, 48.0, u_flatness));
  float r = length(nearest);
  float angle = atan(nearest.y, nearest.x);
  float relief = spectrumRelief(p + nearest * 0.15);
  float nucleus = exp(-r * r * (34.0 + owner * 28.0));
  float lamellae = pow(0.5 + 0.5 * sin(r * (58.0 + 28.0 * u_spread) - angle * (3.0 + floor(owner * 5.0)) + relief * 8.0), 10.0);
  float microvilli = pow(max(0.0, sin(angle * (15.0 + floor(owner * 13.0)) + r * 25.0 + relief * 5.0)), 16.0) * exp(-abs(r - 0.32) * 18.0);
  vec3 membrane = hsv(fract(u_hue + owner * 0.22 + relief * 0.08), 0.95, 1.0);
  vec3 interior = hsv(fract(u_hue + 0.34 + owner * 0.14), 0.9, 1.0);
  vec3 color = membrane * wall * (0.45 + u_mid * 0.8);
  color += interior * lamellae * (0.12 + u_high * 0.75);
  color += hsv(fract(u_hue + 0.62), 0.82, 1.0) * nucleus * (0.18 + u_low * 0.45);
  color += vec3(0.75, 1.0, 0.15) * microvilli * (0.15 + u_high + u_hat * 0.8);
  color += membrane * wall * abs(relief) * u_relief * 1.8;
  return color;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float front = 0.03 + u_focusAge * 0.68;
  float focus = exp(-pow((length(p) - front) * 20.0, 2.0)) * exp(-u_focusAge * 1.6) * u_focusAmp;
  p *= 1.0 - focus * 0.09;
  p += vec2(sin(p.y * 4.0 + u_flow), cos(p.x * 3.0 - u_flow * 0.7)) * (0.006 + u_mid * 0.006);
  vec3 color = specimen(p);
  float beam = exp(-pow((uv.y - u_scan) / max(0.004, u_scanWidth), 2.0));
  vec3 beamColor = hsv(fract(u_hue + 0.48 + uv.x * 0.12), 0.75, 1.0);
  color *= 0.38 + 0.42 * smoothstep(u_scan - 0.12, u_scan + 0.015, uv.y);
  color += beamColor * beam * (0.25 + u_high * 0.8) * (0.3 + length(color));
  color += hsv(fract(u_hue + 0.16), 0.95, 1.0) * focus * (0.25 + u_low) * (0.4 + length(color));
  float snareSlice = exp(-pow((uv.x - fract(u_phrase * 1.7 + 0.15)) * 100.0, 2.0));
  color += beamColor * snareSlice * u_snare * 0.7;
  float sectionEdge = exp(-pow((abs(p.x) - (0.18 + u_section * 0.75)) * 14.0, 2.0));
  color += hsv(fract(u_hue + 0.72), 0.9, 1.0) * sectionEdge * u_section * 0.7;
  color *= 0.72 + 0.28 * max(u_drop, max(u_low, u_mid));
  color *= 1.0 + u_kick * 0.06;
  float m = max(color.r, max(color.g, color.b));
  if (m > 0.9) color *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 2.5))) / m;
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
  id: 'g16-cytoplasm-scan',
  name: 'g16 cytoplasm-scan',
  hiRes: true,
  params: [
    { id: 'magnification', label: 'magnification', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'relief', label: 'surface relief', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'beam', label: 'scan beam width', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let flow = 0;
    let hue = 0.15;
    let scan = 0;
    let focusAge = 99;
    let focusAmp = 0;
    let section = 0;
    let lastSection = -1;
    const spectrum = new Float32Array(24);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.12 + slow.mid * 0.3 + slow.high * 0.08);
        const scanRate = frame.beat?.bpm ? frame.beat.bpm / 480 : 0.22;
        scan = (scan + dt * scanRate * (0.7 + slow.high * 0.45)) % 1;
        focusAge += dt;
        if (frame.impulse.low > 0.3 && focusAge > 0.15) {
          focusAge = 0;
          focusAmp = Math.min(1, frame.impulse.low * 1.25);
        }
        const deck = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        const targetHue = hash01(deck?.trackId ?? 211) + frame.centroid * 0.6;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.8));
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const sectionIndex = Math.floor(bar / 16);
        if (lastSection >= 0 && sectionIndex !== lastSection) section = 1;
        lastSection = sectionIndex;
        section = Math.max(0, section - dt / 1.3);
        const phrase = frame.beat ? ((((bar % 16) + 16) % 16) + frame.beat.barPhase) / 16 : 0.5;
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
          u_scale: (5.5 + hash01((deck?.trackId ?? 1) + 17) * 3) * (frame.params.magnification ?? 1),
          u_relief: frame.params.relief ?? 1,
          u_scan: scan,
          u_scanWidth: 0.018 * (frame.params.beam ?? 1),
          u_phrase: phrase,
          u_section: section,
          u_focusAge: focusAge,
          u_focusAmp: focusAmp,
          u_spread: frame.spread,
          u_flatness: frame.flatness,
          u_drop: Math.max(frame.regime?.sustained ?? 0, frame.regime?.dropTransition ?? 0),
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
