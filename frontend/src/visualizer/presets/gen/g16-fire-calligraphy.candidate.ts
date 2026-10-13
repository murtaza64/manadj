import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const WAVE_SAMPLES = 32;
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
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
uniform float u_decay;
uniform float u_curl;
uniform float u_temperature;
uniform float u_phrase;
uniform float u_section;
uniform float u_drop;
uniform float u_buildup;
uniform float u_heatAge;
uniform float u_heatAmp;
uniform float u_spread;
uniform float u_flatness;
uniform float u_deckLean;
uniform float u_double;
uniform float u_wave[32];

vec3 hsv(float h, float s, float v) {
  vec3 q = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(q - 1.0, 0.0, 1.0), s);
}

float waveform(float x) {
  float pos = clamp(x * 0.5 + 0.5, 0.0, 1.0) * 31.0;
  float value = 0.0;
  float weight = 0.0;
  for (int i = 0; i < 32; i++) {
    float w = max(0.0, 1.0 - abs(pos - float(i)));
    value += u_wave[i] * w;
    weight += w;
  }
  return value / max(weight, 0.001);
}

vec3 hueRotate(vec3 c, float turn) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float a = atan(q, i) + turn * 6.2831853;
  float chroma = length(vec2(i, q));
  i = chroma * cos(a);
  q = chroma * sin(a);
  return max(vec3(0.0), vec3(y + 0.956*i + 0.621*q, y - 0.272*i - 0.647*q, y - 1.106*i - 1.703*q));
}

float stroke(vec2 p, float lane, float phase, float width) {
  float x = p.x + lane;
  float wave = waveform(x * 1.25) * (0.12 + u_spread * 0.16);
  float curve = -0.31 + lane * 0.08 + wave
    + sin(x * (4.0 + phase) + u_flow * (0.65 + phase * 0.04)) * (0.07 + u_curl * 0.035)
    + sin(x * 11.0 - u_flow * 0.31 + phase) * 0.018;
  float taper = smoothstep(0.75, 0.12, abs(x));
  return exp(-pow((p.y - curve) / max(0.003, width * taper), 2.0)) * taper;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 px = 1.0 / u_res;
  float curl = sin(p.y * 6.0 + u_flow * 0.8) * (0.0015 + u_curl * 0.0025);
  vec2 src = clamp(uv + vec2(curl, -0.0015 - u_mid * 0.0035), vec2(0.002), vec2(0.998));
  vec3 center = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 field = max(vec3(0.0), center * 1.22 - blur * 0.22) * u_decay;

  float width = 0.009 + u_low * 0.011 + u_kick * 0.006;
  float s0 = stroke(p, -0.25 - u_deckLean * 0.08, 1.0, width);
  float s1 = stroke(p, 0.02, 2.8, width * 0.72);
  float s2 = stroke(p, 0.29 + u_deckLean * 0.08, 4.6, width * 0.55);
  float fork = stroke(p + vec2(0.0, 0.075), -0.08, 6.1, width * 0.35) * u_snare;
  float hair = stroke(p + vec2(0.0, 0.12), 0.18, 8.0, width * 0.22) * (u_high + u_hat * 0.8);
  float body = s0 + s1 + s2 + fork + hair;
  float core = pow(clamp(body, 0.0, 1.0), 3.0);
  float heat = clamp(body - core * 0.35, 0.0, 1.0);
  vec3 edgeColor = hsv(fract(u_hue + p.x * 0.15 + u_flow * 0.012), 0.98, 1.0);
  vec3 hotColor = mix(hsv(fract(u_hue + 0.1), 0.9, 1.0), vec3(1.0, 0.96, 0.72), clamp(u_temperature, 0.0, 1.0));
  vec3 fresh = edgeColor * heat * (0.75 + u_mid * 0.7) + hotColor * core * (1.1 + u_low + u_kick);
  float baseline = exp(-pow((p.y + 0.36 + waveform(p.x) * 0.035) / (0.014 + u_low * 0.014), 2.0)) * smoothstep(0.82, 0.15, abs(p.x));
  fresh += hotColor * baseline * (0.3 + u_low * 1.2 + u_kick * 1.4);
  float heatFront = -0.42 + u_heatAge * 0.55;
  float front = exp(-pow((p.y - heatFront) * 18.0, 2.0)) * exp(-u_heatAge * 1.15) * u_heatAmp;
  fresh += edgeColor * front * (0.3 + body * 2.0);
  float sectionArc = exp(-pow((length(p - vec2(0.0, -0.25)) - 0.1 - u_section * 0.68) * 12.0, 2.0));
  fresh += hsv(fract(u_hue + 0.48), 0.95, 1.0) * sectionArc * u_section * 0.8;
  fresh *= 0.72 + 0.28 * max(u_drop, max(u_low, u_mid)) + u_buildup * 0.08;
  fresh *= 0.85 + 0.15 * u_phrase + u_double * 0.12;
  field += fresh * (1.0 - u_decay) * 4.2;
  field = hueRotate(field, u_hat * 0.006);
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.84) field *= (0.84 + 0.16 * (1.0 - exp(-(m - 0.84) * 2.8))) / m;
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const preset: VisualizerPreset = {
  id: 'g16-fire-calligraphy',
  name: 'g16 fire-calligraphy',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'memory', label: 'exposure memory', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'curl', label: 'stroke curl', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'temperature', label: 'flame temperature', min: 0, max: 1, step: 0.05, default: 0.7 },
  ],
  create: () => {
    let flow = 0;
    let hue = 0.04;
    let heatAge = 99;
    let heatAmp = 0;
    let section = 0;
    let lastSection = -1;
    let drop = 0;
    let buildup = 0;
    const wave = new Float32Array(WAVE_SAMPLES);
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.24 + slow.mid * 0.48 + slow.high * 0.12);
        heatAge += dt;
        if (frame.impulse.low > 0.3 && heatAge > 0.15) {
          heatAge = 0;
          heatAmp = Math.min(1, frame.impulse.low * 1.25);
        }
        const dominant = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        const targetHue = hash01(dominant?.trackId ?? 401) + frame.centroid * 0.5;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.8));
        const left = frame.wave?.left;
        const right = frame.wave?.right;
        for (let i = 0; i < WAVE_SAMPLES; i++) {
          let target = Math.sin(i * 0.63 + flow) * (0.04 + frame.bands.mid * 0.05);
          if (left && right && left.length && right.length) {
            const li = Math.min(left.length - 1, Math.floor((i / (WAVE_SAMPLES - 1)) * left.length));
            const ri = Math.min(right.length - 1, Math.floor((i / (WAVE_SAMPLES - 1)) * right.length));
            target = left[li] * 0.55 + right[ri] * 0.45;
          }
          wave[i] += (target - wave[i]) * (1 - Math.exp(-dt / 0.12));
        }
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const sectionIndex = Math.floor(bar / 16);
        if (lastSection >= 0 && sectionIndex !== lastSection) section = 1;
        lastSection = sectionIndex;
        section = Math.max(0, section - dt / 1.4);
        const phrase = frame.beat ? ((((bar % 16) + 16) % 16) + frame.beat.barPhase) / 16 : 0.5;
        drop += ((frame.regime?.sustained ?? 0) - drop) * (1 - Math.exp(-dt / 0.4));
        buildup += ((frame.regime?.buildup ?? 0) - buildup) * (1 - Math.exp(-dt / 0.4));
        let signed = 0;
        let total = 0;
        const tracks = new Map<number, number>();
        for (let i = 0; i < frame.decks.length; i++) {
          const deck = frame.decks[i];
          const audible = deck.level * deck.fader;
          signed += audible * (i < 2 ? -1 : 1);
          total += audible;
          if (deck.trackId !== null && audible > 0.03) tracks.set(deck.trackId, (tracks.get(deck.trackId) ?? 0) + 1);
        }
        const doubles = [...tracks.values()].some((count) => count > 1) ? 1 : 0;
        const memory = frame.params.memory ?? 1;
        const decay = Math.min(0.988, 1 - 0.024 / memory);
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
          u_decay: decay,
          u_curl: (frame.params.curl ?? 1) * (0.7 + slow.mid * 0.5),
          u_temperature: frame.params.temperature ?? 0.7,
          u_phrase: phrase,
          u_section: section,
          u_drop: drop,
          u_buildup: buildup,
          u_heatAge: heatAge,
          u_heatAmp: heatAmp,
          u_spread: frame.spread,
          u_flatness: frame.flatness,
          u_deckLean: total > 0 ? Math.max(-1, Math.min(1, signed / total)) : 0,
          u_double: doubles,
          u_wave: wave,
        };
      },
    });
  },
};

export default preset;
