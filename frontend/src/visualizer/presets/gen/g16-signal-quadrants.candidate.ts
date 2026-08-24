import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_motion;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_drive;
uniform float u_join;
uniform float u_transition;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_bar;
uniform float u_barPhase;
uniform float u_phrase;
uniform float u_seed;
uniform float u_bezel;
uniform float u_curve;
uniform float u_phosphor;
uniform float u_spectrum[24];
const float TAU = 6.2831853;

vec3 hsv(float h, float s, float v) {
  vec3 p = abs(fract(vec3(h) + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
}
float spectrumAt(float x) {
  float value = 0.0;
  float index = floor(clamp(x, 0.0, 0.999) * 24.0);
  for (int i = 0; i < 24; i++) if (abs(float(i) - index) < 0.5) value = u_spectrum[i];
  return value;
}
vec3 instrument(float role, vec2 p, vec2 local) {
  float hue = fract(u_seed + role * 0.23 + u_phrase * 0.017);
  vec3 base = hsv(hue, 0.96, 0.12);
  if (role < 0.5) {
    float cell = floor(local.x * 4.0);
    float filled = step(cell, u_bar) * step(local.y, 0.72) + step(abs(cell - u_bar), 0.4) * step(local.y, u_barPhase * 0.72);
    float ticks = smoothstep(0.07, 0.02, abs(fract(local.y * 8.0) - 0.5));
    return base + hsv(hue + cell * 0.04, 0.9, 0.82) * clamp(filled + ticks * 0.18, 0.0, 1.0);
  }
  if (role < 1.5) {
    float r = length(p);
    float ring = exp(-pow((r - (0.12 + 0.26 * fract(u_motion * 0.17))) * 42.0, 2.0));
    float core = smoothstep(0.3 + u_low * 0.12, 0.02, r);
    return base + hsv(hue, 0.92, 0.7) * core + hsv(hue + 0.11, 0.82, 1.0) * ring * u_kick;
  }
  if (role < 2.5) {
    float band = spectrumAt(local.x);
    float bars = step(local.y, band * 0.82);
    float ridge = exp(-pow((local.y - band * 0.82) * 48.0, 2.0));
    return base + hsv(hue + local.x * 0.28, 0.9, 0.65 + u_high * 0.25) * (bars * 0.72 + ridge * u_hat);
  }
  float angle = atan(p.y, p.x) / TAU + 0.5;
  float ribbons = 0.5 + 0.5 * cos((angle * (4.0 + u_spread * 8.0) + length(p) * 3.0 - u_motion * 0.08) * TAU);
  float edge = mix(smoothstep(0.62, 0.48, ribbons), pow(ribbons, 5.0), u_flatness);
  return base + hsv(hue + angle * (0.2 + u_centroid * 0.5), 0.92 - u_flatness * 0.25, 0.78) * edge;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 q = uv - 0.5;
  q *= 1.0 + u_curve * dot(q, q);
  vec2 tube = q + 0.5;
  float inside = step(0.0, tube.x) * step(tube.x, 1.0) * step(0.0, tube.y) * step(tube.y, 1.0);
  vec2 cell = floor(tube * 2.0);
  float role = cell.x + cell.y * 2.0;
  vec2 local = fract(tube * 2.0);
  vec2 p = local - 0.5;
  float gap = u_bezel * (1.0 - 0.92 * u_join);
  float panel = step(gap, local.x) * step(local.x, 1.0 - gap) * step(gap, local.y) * step(local.y, 1.0 - gap);
  vec3 own = instrument(role, p, local);
  vec3 joined = vec3(0.0);
  joined += instrument(0.0, q + vec2(0.25, 0.25), tube);
  joined += instrument(1.0, q + vec2(-0.25, 0.25), tube);
  joined += instrument(2.0, q + vec2(0.25, -0.25), tube);
  joined += instrument(3.0, q + vec2(-0.25, -0.25), tube);
  vec3 col = mix(own * panel, joined * 0.34, u_join * smoothstep(0.42, 0.05, min(abs(q.x), abs(q.y))));
  float retrace = exp(-pow((tube.y - u_transition) * 80.0, 2.0));
  col += hsv(u_seed + 0.16, 0.45, 0.8) * retrace * (1.0 - u_transition) * 0.45;
  float scan = 0.78 + 0.22 * sin(gl_FragCoord.y * 3.14159 * u_phosphor);
  float triad = mod(gl_FragCoord.x, 3.0);
  vec3 mask = triad < 1.0 ? vec3(1.25, 0.72, 0.72) : (triad < 2.0 ? vec3(0.72, 1.25, 0.72) : vec3(0.72, 0.72, 1.25));
  col *= scan * mask * inside;
  col *= 0.78 + 0.18 * u_drive + 0.12 * u_snare;
  float vig = smoothstep(0.72, 0.38, length(q));
  col *= 0.42 + 0.58 * vig;
  float mx = max(col.r, max(col.g, col.b));
  if (mx > 0.92) col *= (0.92 + 0.08 * (1.0 - exp(-(mx - 0.92) * 3.0))) / mx;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function seedOf(frame: VisualizerFrameData): number {
  const deck = frame.decks.find((item) => item.channel === frame.dominantChannel);
  return (((deck?.trackId ?? 161) * 0.61803398875) % 1 + 1) % 1;
}

const preset: VisualizerPreset = {
  id: 'g16-signal-quadrants', name: 'g16 signal quadrants', hiRes: true,
  params: [
    { id: 'bezel', label: 'bezel width', min: 0.01, max: 0.12, step: 0.005, default: 0.055 },
    { id: 'curve', label: 'tube curvature', min: 0, max: 0.35, step: 0.01, default: 0.14 },
    { id: 'phosphor', label: 'scanline density', min: 0.5, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let motion = 0;
    let transition = 1;
    let lastSection = -1;
    const spectrum = new Float32Array(24);
    return createGlRenderer({ fragment: FRAGMENT, uniforms: (frame) => {
      const dt = Math.min(0.1, Math.max(0, frame.dt));
      const slow = frame.bandsSlow ?? frame.bands;
      motion += dt * (0.35 + slow.mid * 0.55 + slow.high * 0.18);
      const tierBar = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? Math.floor(frame.time / 2);
      const section = Math.floor(tierBar / 16);
      if (lastSection >= 0 && section !== lastSection) transition = 0;
      lastSection = section;
      transition = Math.min(1, transition + dt / 0.7);
      for (let i = 0; i < 24; i++) spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
      const drive = Math.max(frame.regime?.sustained ?? 0, energyOf(frame.bands) * 1.3);
      return {
        u_time: frame.time, u_motion: motion, u_low: frame.bands.low, u_mid: frame.bands.mid,
        u_high: frame.bands.high, u_kick: frame.impulse.low, u_snare: frame.impulse.mid,
        u_hat: frame.impulse.high, u_drive: Math.min(1, drive), u_join: Math.min(1, drive * 0.88 + (frame.regime?.dropTransition ?? 0)),
        u_transition: transition, u_centroid: frame.centroid, u_spread: frame.spread, u_flatness: frame.flatness,
        u_bar: ((tierBar % 4) + 4) % 4, u_barPhase: frame.beat?.barPhase ?? 0,
        u_phrase: Math.floor(tierBar / 4), u_seed: seedOf(frame), u_bezel: frame.params.bezel ?? 0.055,
        u_curve: frame.params.curve ?? 0.14, u_phosphor: frame.params.phosphor ?? 1, u_spectrum: spectrum,
      };
    }});
  },
};
export default preset;
