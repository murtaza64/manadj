/**
 * "g05 voyage-ribbon" (gen-5 tweak of g00-voyage, raids g01-ink-vortex):
 * the parent Voyage verbatim — traveling kick ripple, charged event-horizon
 * ring, localized lens swirl, drifting palette travel, phrase swell — with
 * ONE element swapped: the ember DUST MEDIUM (spiral-lane disk + high
 * nebula wisps) is replaced by a LIVE-WAVEFORM FILAMENT RIBBON.
 *
 * The stereo waveform (wantsWave) becomes a luminous ribbon orbiting and
 * threading the voyage space, advected by the SAME flow the dust used
 * (differential rotation + churn + ripple + lens drag baked into the
 * feedback advection). Snare/hat impulses (mid/high only) kink and spark
 * it. The KICK response stays SOLID — the traveling ripple and core pump
 * are untouched; the ribbon is simply LIT by the passing ripple. Palette
 * travel, horizon ring, and phrase swell stay parent.
 *
 * ASSIGNED SWAP: ember dust → live-waveform filament ribbon (wantsWave).
 * Filament technique raided from g01-ink-vortex (constant-loop uniform
 * lookup, aspect-round winding, graceful null-wave drop-out).
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

/** Downsampled waveform resolution handed to GLSL as uniform float[WAVE_N]. */
const WAVE_N = 128;

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
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_ribbon;    // ribbon medium gain (replaces dust gain)
uniform float u_palette;
uniform float u_charge;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_spark;     // snare/hat kink+spark energy (mid/high only)
uniform float u_waveAmp;   // ribbon radial excursion from the wave
uniform float u_wave[128];

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};
const float WAVE_COUNT = 128.0;
const float TWO_PI = 6.28318530718;

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

// Constant-loop lookup into the waveform uniform (GLSL ES 1.0 forbids
// dynamic array indexing) — raided from g01-ink-vortex.
float waveAt(float idx) {
  float v = 0.0;
  for (int k = 0; k < 128; k++) {
    if (float(k) == idx) v = u_wave[k];
  }
  return v;
}

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + churn + traveling kick ripple + lens
  // drag (parent, unchanged — this SAME flow advects the ribbon).
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
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

  // ---- Steady layers, injected at (1 - decay). Core/ring/heart = parent
  // (kick response stays SOLID).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  fresh += mix(vec3(0.55, 0.07, 0.04), LOW, 0.5)
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  vec3 coal = vec3(0.55, 0.07, 0.04);
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);

  // ---- SWAPPED MEDIUM: LIVE-WAVEFORM FILAMENT RIBBON (replaces the dust
  // disk + high nebula). The stereo waveform is wound into the voyage space
  // and threaded through it, riding the SAME armPhase drift the spiral used.
  // Multiple turns give an orbiting/threading ribbon rather than one ring.
  float aNorm = fract((ang / TWO_PI) + 0.5 + u_armPhase * 0.159 + t * 0.03);
  float turns = 2.5;
  float wpos = fract(aNorm * turns) * (WAVE_COUNT - 1.0);
  float wi = floor(wpos);
  float wf = wpos - wi;
  float sampledWave = mix(waveAt(wi), waveAt(min(wi + 1.0, WAVE_COUNT - 1.0)), wf);
  // Kink + spark: snare/hat impulses jitter the guide radius and thicken
  // the filament (mid/high only — the kick never touches the ribbon shape).
  float kink = u_spark * 0.045 * sin(ang * 9.0 + t * 6.0 + sampledWave * 7.0);
  float guideR = 0.20 + 0.22 * aNorm + sampledWave * u_waveAmp + kink;
  float dline = abs(r - guideR);
  float thickness = 44.0 - 22.0 * u_spark;
  float filament = exp(-pow(dline * thickness, 2.0));
  // Reverb: the passing ripple LIGHTS the ribbon (kick lit, not shaped).
  float reverb = 1.0 + 2.6 * rippleWave;
  vec3 ribbonColor = palette(sampledWave * 1.5 + aNorm * 1.2 + t * 0.05 + u_centroid * 0.4);
  fresh += ribbonColor * filament * centerDim
    * (0.35 + 1.2 * u_mid + 0.7 * abs(sampledWave)) * u_ribbon * reverb;
  // Sparks: bright mid/high flecks where snare/hat kink the filament.
  vec3 sparkColor = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.55);
  fresh += sparkColor * filament * u_spark * (0.8 + 1.6 * u_high) * u_ribbon * reverb;
  // A faint second inner strand keeps the medium from ever going empty.
  float innerR = guideR * 0.55;
  float inner = exp(-pow((r - innerR) * (thickness * 1.3), 2.0));
  fresh += mix(sparkColor, ribbonColor, 0.5) * inner * centerDim
    * (0.12 + 0.9 * u_high) * u_ribbon * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // ---- Transient stamps (parent — kick shockwave/core SOLID).
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(LOW, vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const candidate: VisualizerPreset = {
  id: 'g05-voyage-ribbon',
  name: 'g05 voyage-ribbon',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'ribbon', label: 'ribbon amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'waveAmp', label: 'wave excursion', min: 0, max: 0.2, step: 0.005, default: 0.09 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    let spark = 0;
    const wave = new Float32Array(WAVE_N);

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;

        // Downsample the stereo waveform (mean of L/R); degrade to flat when
        // the feed doesn't carry it — the ribbon simply drops to a smooth
        // orbit and the voyage keeps churning.
        const w = frame.wave;
        if (w && w.left.length > 0) {
          const src = w.left;
          const other = w.right;
          const n = Math.min(src.length, other.length);
          const step = n / WAVE_N;
          for (let i = 0; i < WAVE_N; i++) {
            const idx = Math.min(n - 1, Math.floor(i * step));
            wave[i] = (src[idx] + other[idx]) * 0.5;
          }
        } else {
          wave.fill(0);
        }

        // Snare/hat spark energy: MID/HIGH transients only — the kick must
        // never kink the ribbon.
        const hit = Math.max(frame.impulse.mid, frame.impulse.high);
        spark = Math.max(hit, spark - dt * 3.5);

        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, 0.7 * sustained);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          u_rotStep: (0.05 + 0.5 * frame.bands.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_ribbon: frame.params.ribbon ?? 1,
          u_palette: frame.params.palette ?? 1,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_spark: spark,
          u_waveAmp: frame.params.waveAmp ?? 0.09,
          u_wave: wave,
        };
      },
    });
  },
};

export default candidate;
