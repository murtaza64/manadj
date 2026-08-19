/**
 * g01-warp-nebula (gen-1 crossover): Tunnel's MOTION carrying Voyage's
 * MEDIUM. Parents: g00-tunnel, g00-voyage.
 *
 * - MOTION from Tunnel: warp feedback flight; kicks LUNGE the zoom;
 *   DIFFERENTIAL rotation (mouth spins faster than throat) shears the
 *   walls into spirals.
 * - MEDIUM from Voyage: fbm nebula walls in a traveling cosine palette;
 *   electric high puffs stamped into the feedback; kick reverberation
 *   waves that light the dust they pass.
 * - The seam: a beat-locked emission ring at the tunnel mouth
 *   (frame.beat.phase); each pulse is dragged down the tube by the zoom.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import type { BandLevels, EnergyTrend } from '../../bands';
import type { BeatInfo } from '../../channel';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

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
uniform float u_centroid;
uniform float u_excite;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_dust;
uniform float u_palette;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_charge;
uniform float u_beatPulse;
uniform float u_grid;

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.10) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.50) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.20, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.30, 0.50, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.30, 0.50))); }
vec3 pal3(float t) { return vec3(0.50, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.10, -0.02, -0.05) * u_excite;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);

  // ---- WARP (Tunnel motion): zoom + DIFFERENTIAL rotation — the mouth
  // (large r) spins faster than the throat, shearing walls into spirals.
  float rot = u_rotStep * (0.35 + 1.4 * (1.0 - exp(-r * 2.2)));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.0015 + 0.02 * u_mid + 0.012 * u_excite);
  float waveFront = 0.12 + u_rippleAge * 0.95;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.04;
  vec2 src = (w + churn + ripple) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_excite + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Fresh medium, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float reverb = 1.0 + 2.6 * rippleWave;

  // NEBULA WALLS: the tunnel is made of dust.
  float wall = fbm(vec2(ang * 2.2 + log(r + 0.06) * 3.0 - t * 0.15, r * 6.0 + t * 0.06));
  float cloud = pow(wall, 2.4);
  vec3 dustColor = palette(wall * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4);
  float midGate = smoothstep(0.03, 0.3, u_mid);
  fresh += dustColor * cloud * smoothstep(0.05, 0.6, r) * (0.1 + 1.2 * u_mid)
    * u_dust * midGate * reverb;

  // ELECTRIC HIGH NEBULA: finer, counter-rotating, shimmering.
  float wisp = fbm(vec2(ang * 6.0 + t * 0.5, r * 11.0 - t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.6);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.1, 0.6, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;

  // BEAT-LOCKED EMISSION RING at the tunnel MOUTH (the seam); charge runs
  // its color ember -> orange -> white-hot as kicks stack.
  float mouth = 0.30 + 0.05 * u_low;
  float wobble = 0.02 * (0.5 + u_mid) * sin(ang * 6.0 + t * 3.0)
    + 0.015 * u_kick * sin(ang * 11.0 - t * 5.0);
  float ringGlow = exp(-pow((r - mouth - wobble) * 26.0, 2.0));
  float ringCore = exp(-pow((r - mouth - wobble) * 120.0, 2.0));
  vec3 chargeColor = mix(vec3(0.9, 0.35, 0.15), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  float emit = mix(0.25 + 0.9 * u_low, u_beatPulse, u_grid);
  fresh += chargeColor * ringGlow * emit * (0.4 + 0.6 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5) * ringCore * emit * (0.8 + 1.4 * u_kick);

  sky += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_excite);

  // HIGH-TRANSIENT PUFFS stamped into the feedback at full strength.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.55, r) * u_spawn * 0.9;
  }

  // Kick shock at the mouth: the reverb wave's launch point.
  if (u_kick > 0.02) {
    float ringR = 0.12 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 34.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 28.0, 2.0));
    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.1 + 0.8 * u_excite);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.34) * 28.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_excite);

  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.22);
  sky *= 0.72 + 0.45 * u_excite;

  float luma = max(sky.r, max(sky.g, sky.b));
  if (luma > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(luma - 0.8) * 3.0))) / luma;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const candidate: VisualizerPreset = {
  id: 'g01-warp-nebula',
  name: 'g01 warp-nebula',
  hiRes: true,
  params: [
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'spin', label: 'spin drive', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let charge = 0;
    let smoothExcite = 0;
    let beatPulse = 0;
    let prevPhase: number | null = null;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const bands: BandLevels = frame.bands;
        const impulse: BandLevels = frame.impulse;
        const trend: EnergyTrend = frame.trend;
        const beat: BeatInfo | null = frame.beat;

        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(bands);
        const zoomDrive = frame.params.zoom ?? 1;
        const spin = frame.params.spin ?? 1;
        const persistence = frame.params.persistence ?? 1;

        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothExcite += (trend.excitement - smoothExcite) * smoothAlpha;

        const lift = Math.max(smoothExcite, 0.6 * Math.min(1, energy * 1.4));
        const zoom =
          1 + (0.12 + 0.5 * lift + 3.5 * impulse.low * (0.5 + 0.5 * lift)) * zoomDrive * dt;

        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + impulse.low * 0.28);

        rippleAge += dt;
        if (impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, impulse.low * 1.2);
        }

        const grid = beat ? 1 : 0;
        if (beat) {
          if (prevPhase !== null && beat.phase < prevPhase) beatPulse = 1;
          else beatPulse = Math.max(beatPulse, Math.pow(1 - beat.phase, 3));
          prevPhase = beat.phase;
        } else {
          prevPhase = null;
        }
        beatPulse *= Math.exp(-dt / 0.12);

        const baseDecay = 0.992 - 0.008 * energy - 0.006 * smoothExcite;

        return {
          u_time: frame.time,
          u_low: bands.low,
          u_mid: bands.mid,
          u_high: bands.high,
          u_kick: impulse.low,
          u_snare: impulse.mid,
          u_centroid: frame.centroid,
          u_excite: smoothExcite,
          u_zoom: zoom,
          u_rotStep: (0.08 + 1.0 * bands.mid + 1.4 * impulse.mid) * spin * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_charge: charge,
          u_beatPulse: Math.min(1, beatPulse),
          u_grid: grid,
          u_spawn:
            (Math.min(1, 1.1 * impulse.high + 0.2 * bands.high) *
              (0.4 + 0.6 * lift)) /
            (1 + 2.2 * impulse.low),
        };
      },
    });
  },
};

export default candidate;
