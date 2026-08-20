/** g15-caustic-diaphragm: a feedback-space liquid membrane that transports caustic light. */
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
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
uniform float u_spread;
uniform float u_flatness;
uniform float u_drop;
uniform float u_buildup;
uniform float u_phrase;
uniform float u_section;
uniform float u_waveAge;
uniform float u_waveAmp;
uniform float u_tension;
uniform float u_dispersion;
uniform float u_decay;
uniform float u_deckMix;
uniform float u_spectrum[24];

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.2831853;
  float chroma = length(vec2(i, q));
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(y + 0.956 * i + 0.621 * q, y - 0.272 * i - 0.647 * q, y - 1.106 * i - 1.703 * q));
}

float membrane(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float band = u_spectrum[i];
    vec2 axis = vec2(cos(fi * 2.399 + u_deckMix), sin(fi * 2.399 + u_deckMix));
    h += sin(dot(p, axis) * (3.0 + fi * 0.28) + u_flow * (0.16 + fi * 0.012)) * band / (3.2 + fi * 0.22);
  }
  h += sin(p.x * 7.0 + u_flow * 0.21) * sin(p.y * 9.0 - u_flow * 0.17) * 0.16;
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 e = vec2(1.8 / u_res.y, 0.0);
  float h = membrane(p);
  vec2 grad = vec2(membrane(p + e.xy) - membrane(p - e.xy), membrane(p + e.yx) - membrane(p - e.yx)) / (2.0 * e.x);
  grad = clamp(grad, vec2(-2.5), vec2(2.5));

  float waveR = 0.03 + u_waveAge * mix(0.5, 0.9, u_tension);
  float wave = exp(-pow((length(p) - waveR) * 19.0, 2.0)) * exp(-u_waveAge * 1.5) * u_waveAmp;
  vec2 radial = length(p) > 0.001 ? p / length(p) : vec2(0.0);
  vec2 refractOffset = (grad * (0.0016 + u_mid * 0.0018) + radial * wave * 0.018) / vec2(aspect, 1.0);
  vec2 src = clamp(uv - refractOffset, vec2(0.002), vec2(0.998));
  vec2 transverse = vec2(-grad.y, grad.x) * (0.00035 + u_dispersion * (0.001 + u_spread * 0.0018));
  transverse /= vec2(aspect, 1.0);

  float basis = u_hue + u_deckMix * 0.08;
  vec3 a = hueRotate(texture2D(u_prev, clamp(src + transverse, vec2(0.002), vec2(0.998))).rgb, -basis);
  vec3 c = hueRotate(texture2D(u_prev, src).rgb, -basis);
  vec3 b = hueRotate(texture2D(u_prev, clamp(src - transverse, vec2(0.002), vec2(0.998))).rgb, -basis);
  vec3 field = hueRotate(vec3(a.r, c.g, b.b), basis) * u_decay;

  float curvature = abs(membrane(p + e.xy) + membrane(p - e.xy) + membrane(p + e.yx) + membrane(p - e.yx) - 4.0 * h);
  float web = pow(clamp(curvature * 24.0, 0.0, 1.0), mix(2.7, 1.2, u_flatness));
  float fold = pow(clamp(abs(dot(normalize(grad + vec2(0.001)), normalize(vec2(-0.4, 0.9)))), 0.0, 1.0), 10.0);
  float sheet = 0.18 + web * (0.9 + u_high) + fold * (0.3 + u_mid);
  vec3 causticA = hsv(fract(u_hue + h * 0.12 + u_phrase * 0.08), 0.96, 1.0);
  vec3 causticB = hsv(fract(u_hue + 0.42 - h * 0.08), 0.92, 1.0);
  vec3 fresh = mix(causticA, causticB, smoothstep(-0.2, 0.2, h)) * sheet;
  fresh += causticB * wave * (1.0 + web * 3.0);
  fresh += causticA * u_snare * pow(max(0.0, sin((p.x + p.y) * 34.0 + h * 8.0)), 14.0) * 0.8;
  fresh += vec3(0.8, 0.95, 1.0) * u_hat * pow(web, 3.0) * 0.55;
  float sectionFold = exp(-pow((p.x + sin(p.y * 7.0) * 0.12 - (u_section - 0.5) * 1.8) * 10.0, 2.0));
  fresh += causticB * sectionFold * u_section * 1.3;

  float injection = (1.0 - u_decay) * (2.4 + u_drop * 1.5 + u_buildup * 0.7);
  field += fresh * injection;
  field *= 1.0 + u_kick * 0.06;
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.86) field *= (0.86 + 0.14 * (1.0 - exp(-(m - 0.86) * 2.4))) / m;
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const preset: VisualizerPreset = {
  id: 'g15-caustic-diaphragm',
  name: 'g15 caustic-diaphragm',
  hiRes: true,
  params: [
    { id: 'tension', label: 'membrane tension', min: 0.3, max: 1.8, step: 0.05, default: 1 },
    { id: 'dispersion', label: 'optic dispersion', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'light persistence', min: 0.5, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let flow = 0;
    let hue = 0.32;
    let waveAge = 99;
    let waveAmp = 0;
    let drop = 0;
    let buildup = 0;
    let section = 0;
    let lastSection = -1;
    const spectrum = new Float32Array(24);
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime ? Math.min(0.05, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const slow = frame.bandsSlow ?? frame.bands;
        const tension = frame.params.tension ?? 1;
        flow += dt * (0.3 + slow.mid * 0.55) / Math.max(0.3, tension);
        waveAge += dt;
        if (frame.impulse.low > 0.28 && waveAge > 0.14) {
          waveAge = 0;
          waveAmp = Math.min(1, frame.impulse.low * 1.25);
        }
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.18) / 0.5));
        const dropTarget = Math.max(frame.regime?.sustained ?? 0, frame.trend.excitement * lowPresence);
        const buildupTarget = Math.max(frame.regime?.buildup ?? 0, frame.trend.excitement * (1 - lowPresence));
        drop += (dropTarget - drop) * (1 - Math.exp(-dt / 0.38));
        buildup += (buildupTarget - buildup) * (1 - Math.exp(-dt / 0.38));
        const deck = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        const targetHue = hash01(deck?.trackId ?? 109) + frame.centroid * 0.72;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.8));
        const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const sectionIndex = Math.floor(tierBar / 16);
        if (lastSection >= 0 && sectionIndex !== lastSection) section = 1;
        lastSection = sectionIndex;
        section = Math.max(0, section - dt / 1.2);
        const phrase = frame.beat ? ((((tierBar % 16) + 16) % 16) + frame.beat.barPhase) / 16 : 0.5;
        for (let i = 0; i < 24; i++) spectrum[i] = Math.min(1, Math.max(0, frame.spectrum[i] ?? 0));
        let deckNumerator = 0;
        let deckDenominator = 0;
        for (let i = 0; i < frame.decks.length; i++) {
          deckNumerator += frame.decks[i].level * i;
          deckDenominator += frame.decks[i].level;
        }
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const persistence = frame.params.persistence ?? 1;
        const decay = Math.min(0.985, 1 - (0.025 + energy * 0.012) / persistence);
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
          u_spread: frame.spread,
          u_flatness: frame.flatness,
          u_drop: drop,
          u_buildup: buildup,
          u_phrase: phrase,
          u_section: section,
          u_waveAge: waveAge,
          u_waveAmp: waveAmp,
          u_tension: tension,
          u_dispersion: frame.params.dispersion ?? 1,
          u_decay: decay,
          u_deckMix: deckDenominator > 0 ? deckNumerator / deckDenominator : 0,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
