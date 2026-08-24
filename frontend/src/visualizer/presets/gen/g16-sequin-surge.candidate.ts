import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const N = 24;
const MAX_WAVES = 4;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_flow;
uniform float u_density;
uniform float u_wind;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_hat;
uniform float u_drive;
uniform float u_glint;
uniform float u_rakeAge;
uniform float u_rakeAmp;
uniform float u_rakeAngle;
uniform float u_lightPhase;
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform vec3 u_colBack;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_waves[16];
uniform float u_spectrum[24];

const float TAU = 6.2831853;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  float cell = 1.0 / u_density;
  vec2 id = floor(p / cell);
  vec2 c = (id + 0.5) * cell;
  vec2 q = (p - c) / cell;
  float rnd = hash(id);

  // --- tilt field, sampled at the CELL CENTER: every disc is rigid ---
  float tilt = 0.0;
  // ambient wind (slow bands only)
  tilt += sin(c.x * 5.1 + u_flow * 1.7 + rnd * 0.9) * cos(c.y * 4.3 + u_flow) * u_wind;
  // kick flip-waves: radial fronts that FLIP discs as they pass
  float frontGlow = 0.0;
  for (int i = 0; i < 4; i++) {
    float wx = u_waves[i * 4 + 0];
    float wy = u_waves[i * 4 + 1];
    float age = u_waves[i * 4 + 2];
    float amp = u_waves[i * 4 + 3];
    if (amp < 0.01) continue;
    float d = length(c - vec2(wx, wy));
    float front = age * 1.35;
    float band = exp(-pow((d - front) * 7.5, 2.0));
    float behind = smoothstep(front + 0.06, front - 0.34, d);
    float env = exp(-age * 1.15) * amp;
    tilt += (band * 2.6 + behind * 1.1) * env * 3.4;
    frontGlow += band * env;
  }
  // snare rake: a straight line sweeping along the section axis
  vec2 rdir = vec2(cos(u_rakeAngle), sin(u_rakeAngle));
  float rd = dot(c, rdir) + 0.9 - u_rakeAge * 2.6;
  float rake = exp(-pow(rd * 9.0, 2.0)) * exp(-u_rakeAge * 2.2) * u_rakeAmp;
  tilt += rake * 3.0;
  // per-column spectral shimmer
  float colf = clamp((c.x / aspect + 0.5) * 24.0, 0.0, 23.0);
  float band0 = 0.0;
  for (int i = 0; i < 24; i++) {
    if (abs(float(i) - floor(colf)) < 0.5) band0 = u_spectrum[i];
  }
  float eq = uv.x < 0.3333 ? u_eqLow : (uv.x < 0.6667 ? u_eqMid : u_eqHigh);
  tilt += sin(u_flow * 3.0 + id.y * 1.3 + rnd * TAU) * band0 * eq * 0.55;
  // hat sparkle: a few random single discs snap to the glint angle
  float sparkle = step(0.994 - u_hat * 0.045, hash(id + floor(u_time * 7.0)));
  tilt += sparkle * u_hat * 2.2;

  // --- render the disc ---
  float r = length(q);
  float disc = 1.0 - smoothstep(0.44, 0.5, r);
  float f = cos(tilt);                 // facing: >0 face A, <0 face B
  float faceMix = smoothstep(-0.12, 0.12, f);
  vec3 face = mix(u_colB, u_colA, faceMix);
  // reflective shading: tilted discs catch less face light
  float shade = 0.28 + 0.72 * abs(f);
  // moving light: glint when the disc normal sweeps the source
  float lp = u_lightPhase + c.x * 0.6 - c.y * 0.4;
  float glint = pow(max(0.0, cos(tilt - lp)), 48.0) * u_glint;
  // edge-on discs show a thin metallic rim
  float rim = pow(1.0 - abs(f), 6.0);

  vec3 col = u_colBack;
  vec3 sequin = face * shade * (0.6 + 0.4 * u_drive);
  sequin += vec3(1.0, 0.98, 0.92) * glint * (0.7 + 0.9 * frontGlow + rake);
  sequin += mix(u_colA, vec3(1.0), 0.5) * rim * 0.5;
  sequin += face * frontGlow * 0.35;
  col = mix(col, sequin, disc);
  // soft vignette on the felt
  col *= 1.0 - 0.32 * dot(p, p);

  float m = max(col.r, max(col.g, col.b));
  if (m > 0.92) col *= (0.92 + 0.08 * (1.0 - exp(-(m - 0.92) * 3.0))) / m;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

function hash01(n: number): number {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function hsvVec(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(Math.min(k, 4 - k), 1));
  };
  return [f(5), f(3), f(1)];
}

function dominant(frame: VisualizerFrameData) {
  return frame.decks.find((deck) => deck.channel === frame.dominantChannel) ?? null;
}

const preset: VisualizerPreset = {
  id: 'g16-sequin-surge',
  name: 'g16 sequin-surge',
  hiRes: true,
  params: [
    { id: 'density', label: 'sequin density', min: 22, max: 64, step: 1, default: 40 },
    { id: 'glint', label: 'glint strength', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'waveWidth', label: 'flip wave power', min: 0.4, max: 1.8, step: 0.05, default: 1 },
  ],
  create: () => {
    let flow = 0;
    let lightPhase = 0;
    let rakeAge = 99;
    let rakeAmp = 0;
    let rakeAngle = 0;
    let lastSection = -1;
    let colA: [number, number, number] = [1, 0.2, 0.5];
    let colB: [number, number, number] = [0.1, 0.9, 1];
    const waves = new Float32Array(MAX_WAVES * 4);
    for (let i = 0; i < MAX_WAVES; i++) waves[i * 4 + 2] = 99;
    let waveCursor = 0;
    let waveGate = 0;
    const spectrum = new Float32Array(N);
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const slow = frame.bandsSlow ?? frame.bands;
        flow += dt * (0.25 + slow.mid * 0.6);
        lightPhase += dt * (0.5 + slow.high * 0.9);
        rakeAge += dt;
        waveGate += dt;
        const deck = dominant(frame);
        const key = deck?.trackId ?? 43;
        // section theatre: palette + rake axis swap every 16 ladder bars
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
        const section = Math.floor(bar / 16);
        if (section !== lastSection) {
          lastSection = section;
          const h = hash01(key + section * 131);
          const h2 = fract(h + 0.38 + hash01(key * 7 + section) * 0.24);
          colA = hsvVec(h, 0.95, 1);
          colB = hsvVec(h2, 0.9, 0.95);
          rakeAngle = (hash01(key * 3 + section * 17) - 0.5) * 1.2;
        }
        // age waves; spawn a new flip-wave on solid kicks
        for (let i = 0; i < MAX_WAVES; i++) {
          waves[i * 4 + 2] += dt;
          if (waves[i * 4 + 2] > 3.5) waves[i * 4 + 3] = 0;
        }
        if (frame.impulse.low > 0.34 && waveGate > 0.22) {
          waveGate = 0;
          const i = waveCursor;
          waveCursor = (waveCursor + 1) % MAX_WAVES;
          const j = hash01(key + Math.floor(frame.time * 13) * 29);
          waves[i * 4 + 0] = (j - 0.5) * 1.3;
          waves[i * 4 + 1] = (hash01(key * 5 + Math.floor(frame.time * 11) * 31) - 0.5) * 0.85;
          waves[i * 4 + 2] = 0;
          waves[i * 4 + 3] = Math.min(1, frame.impulse.low) * (frame.params.waveWidth ?? 1);
        }
        if (frame.impulse.mid > 0.4 && rakeAge > 0.3) {
          rakeAge = 0;
          rakeAmp = Math.min(1, frame.impulse.mid);
        }
        for (let i = 0; i < N; i++) spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
        const energy = energyOf(frame.bands);
        const drive = Math.min(1, Math.max(frame.regime?.sustained ?? 0, energy * 1.35));
        return {
          u_time: frame.time,
          u_flow: flow,
          u_density: frame.params.density ?? 40,
          u_wind: 0.16 + slow.mid * 0.4,
          u_low: frame.bands.low, u_mid: frame.bands.mid, u_high: frame.bands.high,
          u_hat: frame.impulse.high,
          u_drive: drive,
          u_glint: frame.params.glint ?? 1,
          u_rakeAge: rakeAge, u_rakeAmp: rakeAmp, u_rakeAngle: rakeAngle,
          u_lightPhase: lightPhase,
          u_colA: colA, u_colB: colB,
          u_colBack: [0.02, 0.018, 0.028] as [number, number, number],
          u_eqLow: Math.max(0, (deck?.eq.low ?? 0.5) * 2),
          u_eqMid: Math.max(0, (deck?.eq.mid ?? 0.5) * 2),
          u_eqHigh: Math.max(0, (deck?.eq.high ?? 0.5) * 2),
          u_waves: waves,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

function fract(x: number): number {
  return x - Math.floor(x);
}

export default preset;
