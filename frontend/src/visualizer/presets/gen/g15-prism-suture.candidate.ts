/** g15-prism-suture: a birefringent crystal whose spectrum becomes polarization seams. */
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_spread;
uniform float u_flatness;
uniform float u_hue;
uniform float u_axis;
uniform float u_phrase;
uniform float u_section;
uniform float u_waveAge;
uniform float u_waveAmp;
uniform float u_facets;
uniform float u_relief;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_spectrum[24];

#define PI 3.14159265

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

float relief(float a) {
  float d = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float eq = fi < 8.0 ? u_eqLow : (fi < 16.0 ? u_eqMid : u_eqHigh);
    d += u_spectrum[i] * eq * sin(a * (2.0 + fi * 0.55) + u_axis * (1.0 + fi * 0.07)) / (2.5 + fi * 0.32);
  }
  return d;
}

float crystal(vec2 p) {
  float a = atan(p.y, p.x);
  float r = length(p);
  float n = floor(u_facets + 0.5);
  float facet = cos(floor(0.5 + a / (2.0 * PI) * n) * 2.0 * PI / n - a);
  float base = mix(0.28, 0.38, u_phrase) / max(0.72, facet);
  return r - base - relief(a) * u_relief * 0.027;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float squeeze = 1.0 + u_kick * 0.09;
  p.x *= squeeze;
  p.y /= squeeze;
  float cs = cos(u_axis * 0.18), sn = sin(u_axis * 0.18);
  p = mat2(cs, -sn, sn, cs) * p;

  float d = crystal(p);
  vec2 e = vec2(1.8 / u_res.y, 0.0);
  vec2 normal = normalize(vec2(crystal(p + e.xy) - crystal(p - e.xy), crystal(p + e.yx) - crystal(p - e.yx)));
  vec2 lightDir = normalize(vec2(-0.55 + 0.5 * sin(u_axis * 0.13), 0.83));
  float diffuse = 0.25 + 0.75 * max(0.0, dot(normal, lightDir));
  float rim = pow(1.0 - abs(dot(normal, normalize(p + vec2(0.001)))), 2.0);
  float inside = smoothstep(0.012, -0.012, d);

  float optic = dot(p, vec2(cos(u_axis), sin(u_axis)));
  float film = optic * mix(18.0, 42.0, u_spread) + d * 90.0 + relief(atan(p.y, p.x)) * 3.0;
  float split = mix(0.10, 0.42, u_flatness) + 0.08 * u_high;
  vec3 ordinary = hsv(fract(u_hue + film * 0.035), 0.95, 1.0);
  vec3 extraordinary = hsv(fract(u_hue + split + film * 0.049), 1.0, 1.0);
  float seam = pow(0.5 + 0.5 * cos(film + sin(film * 0.37) * 2.0), 7.0);
  vec3 body = mix(ordinary * 0.12, extraordinary, seam) * (0.35 + diffuse * 0.8);

  float waveR = 0.04 + u_waveAge * 0.72;
  float pressure = exp(-pow((length(p) - waveR) * 28.0, 2.0)) * exp(-u_waveAge * 1.8) * u_waveAmp;
  body += hsv(fract(u_hue + 0.45), 0.9, 1.0) * pressure * (1.0 + seam * 2.0);
  float suture = exp(-abs(optic + sin(p.y * 19.0 + u_axis) * 0.025) * 80.0);
  body += hsv(fract(u_hue + 0.16), 1.0, 1.0) * suture * (0.2 + 1.5 * u_snare) * inside;
  body += vec3(0.85, 0.95, 1.0) * rim * (0.25 + u_high + u_hat) * inside;
  body += extraordinary * u_section * exp(-abs(d) * 18.0) * 1.8;

  vec3 color = body * inside;
  color += extraordinary * exp(-abs(d) * 130.0) * (0.35 + u_high * 0.8);
  color += ordinary * exp(-abs(d - 0.035) * 90.0) * pressure;
  float m = max(color.r, max(color.g, color.b));
  if (m > 0.9) color *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 2.0))) / m;
  gl_FragColor = vec4(max(color, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const preset: VisualizerPreset = {
  id: 'g15-prism-suture',
  name: 'g15 prism-suture',
  hiRes: true,
  params: [
    { id: 'relief', label: 'spectral relief', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'dispersion', label: 'birefringence', min: 0.3, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let axis = 0;
    let waveAge = 99;
    let waveAmp = 0;
    let lastPhrase = -1;
    let section = 0;
    let seed = 0.37;
    const spectrum = new Float32Array(24);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const slow = frame.bandsSlow ?? frame.bands;
        axis += dt * (0.12 + slow.mid * 0.24);
        waveAge += dt;
        if (frame.impulse.low > 0.28 && waveAge > 0.14) {
          waveAge = 0;
          waveAmp = Math.min(1, frame.impulse.low * 1.3);
        }
        const deck = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        if (deck?.trackId != null) seed = hash01(deck.trackId);
        const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const phraseIndex = Math.floor(tierBar / 16);
        if (lastPhrase >= 0 && phraseIndex !== lastPhrase) section = 1;
        lastPhrase = phraseIndex;
        section = Math.max(0, section - dt / 1.1);
        const phrase = frame.beat ? (((tierBar % 16) + 16) % 16 + frame.beat.barPhase) / 16 : 0.5;
        for (let i = 0; i < 24; i++) spectrum[i] = Math.min(1, Math.max(0, frame.spectrum[i] ?? 0));
        const eq = deck?.eq;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_spread: Math.min(1, frame.spread * (frame.params.dispersion ?? 1)),
          u_flatness: frame.flatness,
          u_hue: seed + frame.centroid * 0.55,
          u_axis: axis + section * 1.4,
          u_phrase: phrase,
          u_section: section,
          u_waveAge: waveAge,
          u_waveAmp: waveAmp,
          u_facets: 5 + Math.floor(seed * 5),
          u_relief: frame.params.relief ?? 1,
          u_eqLow: eq ? Math.min(1.6, eq.low * 2) : 1,
          u_eqMid: eq ? Math.min(1.6, eq.mid * 2) : 1,
          u_eqHigh: eq ? Math.min(1.6, eq.high * 2) : 1,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
