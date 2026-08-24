import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

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
uniform float u_drive;
uniform float u_buildup;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_phase;
uniform float u_section;
uniform float u_seed;
uniform float u_density;
uniform float u_aperture;

const float TAU = 6.2831853;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 hsv(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float roseMask(vec2 q) {
  float r = length(q);
  float a = atan(q.y, q.x);
  float petals = 0.24 + 0.055 * cos(a * (7.0 + mod(u_section, 4.0))) + 0.025 * cos(a * 14.0 - u_flow);
  float outer = smoothstep(petals + 0.015, petals - 0.015, r);
  float mullion = smoothstep(0.018, 0.035, abs(sin(a * 7.0)) * r);
  float rings = smoothstep(0.018, 0.04, abs(fract(r * 16.0) - 0.5));
  float iris = smoothstep(0.045, 0.07, r);
  return outer * mullion * mix(0.45, 1.0, rings) * iris;
}

vec3 paneColor(vec2 q) {
  float a = atan(q.y, q.x) / TAU;
  float cell = floor(length(q) * 16.0) + floor(fract(a) * 14.0);
  float h = fract(u_seed + cell * 0.173 + u_centroid * 0.28);
  return hsv(vec3(h, 0.9 - 0.15 * u_flatness, 1.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 lightPos = vec2(-0.52 + 0.1 * sin(u_flow * 0.3), 0.28 + 0.04 * cos(u_flow * 0.2));
  vec2 ray = lightPos - p;
  vec3 shafts = vec3(0.0);
  float trans = 1.0;
  for (int i = 0; i < 36; i++) {
    float t = (float(i) + 0.5) / 36.0;
    vec2 q = p + ray * t;
    vec2 apertureQ = (q - lightPos) / (0.75 + 0.35 * t);
    float mask = roseMask(apertureQ * (1.0 + 0.12 * u_aperture * u_low));
    float haze = 0.55 + 0.45 * sin(q.x * 13.0 + q.y * 9.0 + u_flow * 0.7 + t * 8.0);
    haze = mix(0.75, haze, 0.25 + 0.5 * u_flatness);
    vec3 pane = paneColor(apertureQ);
    float sampleLight = mask * haze * (0.018 + 0.018 * u_density * (u_mid + u_drive));
    shafts += pane * sampleLight * trans;
    trans *= 0.985 - 0.006 * u_density;
  }

  float window = roseMask((p - lightPos) * 1.65);
  vec3 glass = paneColor((p - lightPos) * 1.65) * window * (0.35 + 0.65 * u_high);
  float edge = abs(roseMask((p - lightPos) * 1.58) - roseMask((p - lightPos) * 1.72));
  glass += vec3(1.0, 0.86, 0.55) * edge * (0.4 + u_hat);

  float arch = abs(abs(p.x) - (0.56 - 0.23 * smoothstep(-0.45, 0.35, p.y)));
  float stone = exp(-arch * 65.0) + exp(-abs(p.y + 0.46) * 80.0);
  vec3 col = shafts * (1.2 + 1.5 * u_drive) + glass;
  col += vec3(0.12, 0.08, 0.18) * stone * (0.4 + 0.6 * u_buildup);

  float haloR = 0.1 + u_phase * 0.58;
  float halo = exp(-pow((length(p - lightPos) - haloR) * 28.0, 2.0));
  col += hsv(vec3(fract(u_seed + 0.5), 0.75, 1.0)) * halo * u_kick * 0.9;
  float flare = exp(-pow((p.y - lightPos.y) * 70.0, 2.0)) * exp(-abs(p.x - lightPos.x) * 1.8);
  col += paneColor(vec2(u_phase, 0.0)) * flare * u_snare * 0.35;
  col *= 0.78 + 0.2 * u_drive;
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.9) col *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 2.5))) / m;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function trackId(frame: VisualizerFrameData): number {
  return frame.decks.find((deck) => deck.channel === frame.dominantChannel)?.trackId ?? 31;
}

const preset: VisualizerPreset = {
  id: 'g15-cathedral-rays',
  name: 'g15 cathedral-rays',
  hiRes: true,
  params: [
    { id: 'density', label: 'ray density', min: 0.4, max: 1.7, step: 0.05, default: 1 },
    { id: 'aperture', label: 'rose aperture', min: 0.3, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let flow = 0;
    let phase = 1;
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.08 + 0.22 * slow.mid + (frame.beat?.bpm ?? 0) / 12000);
        phase = frame.impulse.low > 0.35 ? 0 : Math.min(1, phase + dt / 0.9);
        const energy = energyOf(frame.bands);
        const drive = Math.min(1, Math.max(frame.regime?.sustained ?? 0, energy * 1.4));
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
        return {
          u_time: frame.time, u_flow: flow,
          u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
          u_kick: frame.impulse.low, u_snare: frame.impulse.mid, u_hat: frame.impulse.high,
          u_drive: drive, u_buildup: frame.regime?.buildup ?? frame.trend.excitement * (1 - frame.bands.low),
          u_centroid: frame.centroid, u_spread: frame.spread, u_flatness: frame.flatness,
          u_phase: phase, u_section: Math.floor(bar / 16), u_seed: hash01(trackId(frame)),
          u_density: frame.params.density ?? 1, u_aperture: frame.params.aperture ?? 1,
        };
      },
    });
  },
};

export default preset;
