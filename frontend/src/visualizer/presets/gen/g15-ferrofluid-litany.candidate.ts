/** g15-ferrofluid-litany: spectrum-owned ferrofluid spikes under a moving chrome light. */
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
uniform float u_flow;
uniform float u_hue;
uniform float u_phrase;
uniform float u_section;
uniform float u_drop;
uniform float u_waveAge;
uniform float u_waveAmp;
uniform float u_field;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_spectrum[24];

#define PI 3.14159265

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

float angleDelta(float a, float b) {
  return abs(mod(a - b + PI, 2.0 * PI) - PI);
}

float crownRadius(float a) {
  float r = 0.17 + 0.06 * u_low + 0.035 * u_phrase;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float target = (fi / 24.0) * 2.0 * PI + u_flow * (0.08 + fi * 0.0015);
    float eq = fi < 8.0 ? u_eqLow : (fi < 16.0 ? u_eqMid : u_eqHigh);
    float width = mix(16.0, 42.0, fi / 23.0);
    float spike = exp(-angleDelta(a, target) * width);
    r += spike * u_spectrum[i] * eq * mix(0.13, 0.055, fi / 23.0) * u_field;
  }
  return r;
}

float shape(vec2 p) {
  float a = atan(p.y, p.x);
  float r = length(p);
  float corrugation = sin(a * 17.0 - u_flow * 1.7) * 0.006 * u_mid;
  return r - crownRadius(a) - corrugation;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - vec2(0.47, 0.52)) * vec2(aspect, 1.0);
  float d = shape(p);
  vec2 e = vec2(1.6 / u_res.y, 0.0);
  vec2 n = normalize(vec2(shape(p + e.xy) - shape(p - e.xy), shape(p + e.yx) - shape(p - e.yx)));
  vec2 light = normalize(vec2(cos(u_flow * 0.31), 0.65 + 0.25 * sin(u_flow * 0.17)));
  float ndl = dot(n, light);
  float chrome = pow(max(0.0, ndl), 18.0) + 0.7 * pow(max(0.0, -ndl), 7.0);
  float broad = 0.18 + 0.55 * pow(0.5 + 0.5 * ndl, 2.0);
  float inside = smoothstep(0.008, -0.008, d);
  float edge = exp(-abs(d) * 120.0);

  float waveR = 0.08 + u_waveAge * 0.68;
  float wave = exp(-pow((length(p) - waveR) * 26.0, 2.0)) * exp(-u_waveAge * 1.7) * u_waveAmp;
  float lightHue = fract(u_hue + 0.12 * sin(u_flow * 0.11) + ndl * 0.14);
  vec3 tint = hsv(lightHue, 0.96, 1.0);
  vec3 opposite = hsv(fract(lightHue + 0.48), 0.9, 1.0);
  vec3 color = mix(vec3(0.006, 0.008, 0.012), tint * broad, inside);
  color += inside * mix(tint, opposite, step(0.0, ndl)) * chrome * (0.7 + u_high * 1.1);
  color += edge * tint * (0.3 + u_mid + u_snare * 1.4);
  color += inside * wave * opposite * (0.8 + chrome * 3.0);

  float satellite = exp(-pow(length(p - vec2(0.36, -0.24)) - 0.035 - u_hat * 0.02, 2.0) * 1800.0);
  color += opposite * satellite * (0.2 + u_high * 1.3);
  float sectionHalo = exp(-pow((length(p) - 0.44 - u_section * 0.22) * 18.0, 2.0));
  color += hsv(fract(u_hue + 0.28), 1.0, 1.0) * sectionHalo * u_section;
  color *= 0.72 + 0.28 * max(u_drop, u_low);
  color *= 1.0 + u_kick * 0.08;
  float m = max(color.r, max(color.g, color.b));
  if (m > 0.88) color *= (0.88 + 0.12 * (1.0 - exp(-(m - 0.88) * 2.4))) / m;
  gl_FragColor = vec4(max(color, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const preset: VisualizerPreset = {
  id: 'g15-ferrofluid-litany',
  name: 'g15 ferrofluid-litany',
  hiRes: true,
  params: [
    { id: 'field', label: 'magnetic field', min: 0.3, max: 1.8, step: 0.05, default: 1 },
    { id: 'chrome', label: 'chrome travel', min: 0.3, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let flow = 0;
    let waveAge = 99;
    let waveAmp = 0;
    let hue = 0.12;
    let drop = 0;
    let section = 0;
    let lastSection = -1;
    const spectrum = new Float32Array(24);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.22 + slow.mid * 0.42) * (frame.params.chrome ?? 1);
        waveAge += dt;
        if (frame.impulse.low > 0.3 && waveAge > 0.14) {
          waveAge = 0;
          waveAmp = Math.min(1, frame.impulse.low * 1.25);
        }
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.18) / 0.5));
        const dropTarget = frame.regime?.sustained ?? frame.trend.excitement * lowPresence;
        drop += (dropTarget - drop) * (1 - Math.exp(-dt / 0.4));
        const deck = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        const targetHue = hash01(deck?.trackId ?? 41) + frame.centroid * 0.65;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.4));
        const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const sectionIndex = Math.floor(tierBar / 16);
        if (lastSection >= 0 && sectionIndex !== lastSection) section = 1;
        lastSection = sectionIndex;
        section = Math.max(0, section - dt / 1.25);
        const phrase = frame.beat ? ((((tierBar % 16) + 16) % 16) + frame.beat.barPhase) / 16 : 0.5;
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
          u_flow: flow,
          u_hue: hue,
          u_phrase: phrase,
          u_section: section,
          u_drop: drop,
          u_waveAge: waveAge,
          u_waveAmp: waveAmp,
          u_field: (frame.params.field ?? 1) * (0.75 + slow.low * 0.55),
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
