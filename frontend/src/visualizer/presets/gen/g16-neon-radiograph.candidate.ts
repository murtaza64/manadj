import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_breathe;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_hue;
uniform float u_plate;
uniform float u_separation;
uniform float u_deckSpread;
uniform float u_doubleLock;
uniform float u_phrase;
uniform float u_section;
uniform float u_sectionMode;
uniform float u_drop;
uniform float u_buildup;
uniform float u_exposureAge;
uniform float u_exposureAmp;
uniform float u_spread;
uniform float u_flatness;
uniform float u_spectrum[24];

vec3 hsv(float h, float s, float v) {
  vec3 q = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(q - 1.0, 0.0, 1.0), s);
}

float segment(vec2 p, vec2 a, vec2 b, float width) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return exp(-pow(length(pa - ba * h) / width, 2.0));
}

float anatomy(vec2 p) {
  p.x += sin(p.y * 3.0 + u_breathe) * (0.018 + u_mid * 0.014);
  float bone = 0.0;
  float spine = exp(-pow(p.x / (0.018 + u_low * 0.006), 2.0)) * smoothstep(0.58, 0.42, abs(p.y));
  bone += spine * (0.55 + 0.45 * pow(0.5 + 0.5 * sin(p.y * 92.0 + u_breathe), 6.0));
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float y = 0.37 - fi * 0.061;
    float band = u_spectrum[i * 2] * 0.65 + u_spectrum[i * 2 + 1] * 0.35;
    float span = 0.24 + 0.15 * sin((fi + 1.0) / 13.0 * 3.14159) + band * 0.08;
    float arch = 0.035 + 0.075 * sin((fi + 1.0) / 13.0 * 3.14159);
    vec2 lp = vec2(-span, y - arch * (0.4 + u_phrase));
    vec2 rp = vec2(span, y - arch * (0.4 + u_phrase));
    vec2 lm = vec2(-span * 0.58, y + arch);
    vec2 rm = vec2(span * 0.58, y + arch);
    float width = 0.009 + band * 0.009 + u_spread * 0.003;
    bone += segment(p, vec2(-0.012, y), lm, width);
    bone += segment(p, lm, lp, width * 0.8);
    bone += segment(p, vec2(0.012, y), rm, width);
    bone += segment(p, rm, rp, width * 0.8);
    bone += exp(-pow(length(p - lp) / (width * 1.8), 2.0)) * (0.3 + band);
    bone += exp(-pow(length(p - rp) / (width * 1.8), 2.0)) * (0.3 + band);
  }
  float sternum = segment(p, vec2(0.0, 0.28), vec2(0.0, -0.24), 0.024 + u_low * 0.008);
  float joint = exp(-pow((length(p * vec2(0.75, 1.0)) - 0.18 - u_mid * 0.025) / 0.015, 2.0));
  bone += sternum * 0.7 + joint * (0.2 + u_mid * 0.55);
  return bone;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float angle = (u_sectionMode - 0.5) * 0.32;
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  float offset = u_separation * (0.004 + u_deckSpread * 0.035);
  float cyanPlate = anatomy(p + vec2(offset, 0.0));
  float magentaPlate = anatomy(p - vec2(offset, 0.0));
  float whitePlate = anatomy(p) * u_doubleLock;
  float cyan = 1.0 - exp(-cyanPlate * u_plate * (1.6 - u_flatness * 0.35));
  float magenta = 1.0 - exp(-magentaPlate * u_plate * (1.6 - u_flatness * 0.35));
  vec3 cA = hsv(fract(u_hue + 0.48), 0.9, 1.0);
  vec3 cB = hsv(fract(u_hue + 0.88), 0.9, 1.0);
  vec3 color = cA * cyan * (0.42 + u_mid * 0.34) + cB * magenta * (0.42 + u_high * 0.34);
  color += vec3(0.86, 1.0, 0.96) * whitePlate * (0.14 + u_doubleLock * 0.34);
  float front = -0.62 + u_exposureAge * 0.75;
  float exposure = exp(-pow((p.y - front) * 20.0, 2.0)) * exp(-u_exposureAge * 1.35) * u_exposureAmp;
  color += mix(cA, cB, uv.x) * exposure * (0.35 + anatomy(p) * 1.4);
  float snarePlate = exp(-pow((abs(p.x) - 0.21 - u_phrase * 0.12) * 38.0, 2.0));
  color += cB * snarePlate * u_snare * 0.65;
  float hatEdge = pow(clamp(anatomy(p) * 0.3, 0.0, 1.0), 3.0);
  color += vec3(0.75, 1.0, 0.95) * hatEdge * (u_hat * 0.65 + u_high * 0.08);
  float sectionScan = exp(-pow((length(p) - 0.08 - u_section * 0.72) * 12.0, 2.0));
  color += hsv(fract(u_hue + 0.18), 0.95, 1.0) * sectionScan * u_section * 0.8;
  float plateVignette = exp(-dot(p, p) * 0.65);
  color *= plateVignette * (0.67 + 0.33 * max(u_drop, max(u_low, u_mid))) * (0.92 - u_buildup * 0.06);
  color *= 1.0 + u_kick * 0.05;
  float m = max(color.r, max(color.g, color.b));
  if (m > 0.9) color *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 2.2))) / m;
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
  id: 'g16-neon-radiograph',
  name: 'g16 neon-radiograph',
  hiRes: true,
  params: [
    { id: 'contrast', label: 'plate contrast', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'separation', label: 'double exposure', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let breathe = 0;
    let hue = 0.52;
    let exposureAge = 99;
    let exposureAmp = 0;
    let section = 0;
    let sectionMode = 0;
    let lastSection = -1;
    let drop = 0;
    let buildup = 0;
    const spectrum = new Float32Array(24);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        breathe += dt * (0.22 + slow.mid * 0.38 + (frame.beat?.bpm ?? 0) / 1200);
        exposureAge += dt;
        if (frame.impulse.low > 0.3 && exposureAge > 0.15) {
          exposureAge = 0;
          exposureAmp = Math.min(1, frame.impulse.low * 1.25);
        }
        const dominant = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        const targetHue = hash01(dominant?.trackId ?? 307) + frame.centroid * 0.35;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.7));
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const sectionIndex = Math.floor(bar / 16);
        if (lastSection >= 0 && sectionIndex !== lastSection) {
          section = 1;
          sectionMode = hash01((dominant?.trackId ?? 1) + sectionIndex * 71);
        }
        lastSection = sectionIndex;
        section = Math.max(0, section - dt / 1.35);
        const phrase = frame.beat ? ((((bar % 16) + 16) % 16) + frame.beat.barPhase) / 16 : 0.5;
        drop += ((frame.regime?.sustained ?? 0) - drop) * (1 - Math.exp(-dt / 0.38));
        buildup += ((frame.regime?.buildup ?? 0) - buildup) * (1 - Math.exp(-dt / 0.38));
        for (let i = 0; i < 24; i++) spectrum[i] = Math.min(1, Math.max(0, frame.spectrum[i] ?? 0));
        let weighted = 0;
        let total = 0;
        const tracks = new Map<number, number>();
        for (let i = 0; i < frame.decks.length; i++) {
          const deck = frame.decks[i];
          const audible = deck.level * deck.fader;
          weighted += audible * (i - 1.5);
          total += audible;
          if (deck.trackId !== null && audible > 0.03) tracks.set(deck.trackId, (tracks.get(deck.trackId) ?? 0) + 1);
        }
        const doubles = [...tracks.values()].some((count) => count > 1) ? 1 : 0;
        return {
          u_time: frame.time,
          u_breathe: breathe,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_hue: hue,
          u_plate: frame.params.contrast ?? 1,
          u_separation: frame.params.separation ?? 1,
          u_deckSpread: total > 0 ? Math.min(1, Math.abs(weighted) / total + Math.min(1, total) * 0.4) : 0,
          u_doubleLock: doubles,
          u_phrase: phrase,
          u_section: section,
          u_sectionMode: sectionMode,
          u_drop: drop,
          u_buildup: buildup,
          u_exposureAge: exposureAge,
          u_exposureAmp: exposureAmp,
          u_spread: frame.spread,
          u_flatness: frame.flatness,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
