/** g15-opal-pressure: a stereo-waveform opal body with traveling subsurface light. */
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const WAVE_SAMPLES = 32;
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
uniform float u_hue;
uniform float u_flatness;
uniform float u_spread;
uniform float u_phrase;
uniform float u_section;
uniform float u_glowAge;
uniform float u_glowAmp;
uniform float u_depth;
uniform float u_relief;
uniform float u_wave[32];

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}

float waveform(float x) {
  float value = 0.0;
  float total = 0.0;
  float pos = clamp(x * 0.5 + 0.5, 0.0, 1.0) * 31.0;
  for (int i = 0; i < 32; i++) {
    float w = max(0.0, 1.0 - abs(pos - float(i)));
    value += u_wave[i] * w;
    total += w;
  }
  return value / max(total, 0.001);
}

float bodySdf(vec2 p) {
  float x = p.x / 0.58;
  float top = 0.23 + waveform(x) * u_relief * 0.1;
  float bottom = -0.23 + waveform(-x) * u_relief * 0.07;
  float taper = sqrt(max(0.0, 1.0 - x * x));
  float yTop = top * taper;
  float yBottom = bottom * taper;
  float dy = max(p.y - yTop, yBottom - p.y);
  float dx = abs(p.x) - 0.58;
  return max(dx, dy);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - vec2(0.5, 0.49)) * vec2(aspect, 1.0);
  float compress = 1.0 + u_kick * 0.12;
  p.x /= compress;
  p.y *= compress;
  float d = bodySdf(p);
  float inside = smoothstep(0.012, -0.012, d);
  float rim = exp(-abs(d) * 105.0);

  float depth = max(0.0, -d);
  float glowFront = 0.03 + u_glowAge * 0.22;
  float pressure = exp(-pow((depth - glowFront) * 22.0, 2.0)) * exp(-u_glowAge * 0.7) * u_glowAmp;
  float cells = sin(p.x * 23.0 + sin(p.y * 17.0 + u_time * 0.11))
    * sin(p.y * 27.0 - sin(p.x * 13.0 - u_time * 0.08));
  float film = cells * mix(0.7, 2.4, u_spread) + depth * 38.0 + waveform(p.x / 0.58) * 2.0;
  vec3 opalA = hsv(fract(u_hue + film * 0.055), 0.82, 1.0);
  vec3 opalB = hsv(fract(u_hue + 0.34 - film * 0.037), 0.94, 1.0);
  float milk = exp(-depth * mix(7.0, 2.5, u_depth));
  vec3 transmitted = mix(opalB * 0.2, opalA, milk);
  transmitted += mix(opalA, opalB, 0.5 + 0.5 * cells) * pressure * 2.2;
  transmitted += hsv(fract(u_hue + 0.5), 0.8, 1.0) * u_low * exp(-length(p) * 6.0);
  transmitted += opalB * u_mid * (0.18 + 0.16 * cells);
  transmitted += vec3(0.8, 0.95, 1.0) * pow(max(0.0, cells), 9.0) * u_high;

  vec3 color = transmitted * inside * (0.55 + 0.35 * u_phrase);
  color += mix(opalA, vec3(1.0), 0.35) * rim * (0.5 + u_high + u_hat * 1.3);
  float snareVein = exp(-abs(p.y - waveform(p.x / 0.58) * 0.11) * 80.0);
  color += opalB * snareVein * inside * u_snare * 1.5;
  float sectionWave = exp(-pow((length(p * vec2(0.7, 1.0)) - 0.18 - u_section * 0.55) * 13.0, 2.0));
  color += opalA * sectionWave * u_section * 1.3;
  color *= 0.78 + 0.22 * max(u_low, u_mid);
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
  id: 'g15-opal-pressure',
  name: 'g15 opal-pressure',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'depth', label: 'subsurface depth', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'relief', label: 'wave relief', min: 0.2, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let glowAge = 99;
    let glowAmp = 0;
    let hue = 0.7;
    let section = 0;
    let lastSection = -1;
    const wave = new Float32Array(WAVE_SAMPLES);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        glowAge += dt;
        if (frame.impulse.low > 0.3 && glowAge > 0.16) {
          glowAge = 0;
          glowAmp = Math.min(1, frame.impulse.low * 1.3);
        }
        const deck = frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        const targetHue = hash01(deck?.trackId ?? 73) + frame.centroid * 0.7;
        hue += (targetHue - hue) * (1 - Math.exp(-dt / 1.6));
        const sourceL = frame.wave?.left;
        const sourceR = frame.wave?.right;
        for (let i = 0; i < WAVE_SAMPLES; i++) {
          if (sourceL && sourceR && sourceL.length > 0 && sourceR.length > 0) {
            const li = Math.min(sourceL.length - 1, Math.floor((i / (WAVE_SAMPLES - 1)) * sourceL.length));
            const ri = Math.min(sourceR.length - 1, Math.floor((i / (WAVE_SAMPLES - 1)) * sourceR.length));
            wave[i] += ((sourceL[li] - sourceR[ri]) * 0.5 - wave[i]) * 0.42;
          } else {
            wave[i] = Math.sin(i * 0.71 + frame.time * 0.6) * (0.08 + frame.bands.mid * 0.08);
          }
        }
        const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : 0;
        const sectionIndex = Math.floor(tierBar / 16);
        if (lastSection >= 0 && sectionIndex !== lastSection) section = 1;
        lastSection = sectionIndex;
        section = Math.max(0, section - dt / 1.4);
        const phrase = frame.beat ? ((((tierBar % 16) + 16) % 16) + frame.beat.barPhase) / 16 : 0.5;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_hue: hue,
          u_flatness: frame.flatness,
          u_spread: frame.spread,
          u_phrase: phrase,
          u_section: section,
          u_glowAge: glowAge,
          u_glowAmp: glowAmp,
          u_depth: (frame.params.depth ?? 1) * (0.7 + frame.flatness * 0.6),
          u_relief: frame.params.relief ?? 1,
          u_wave: wave,
        };
      },
    });
  },
};

export default preset;
