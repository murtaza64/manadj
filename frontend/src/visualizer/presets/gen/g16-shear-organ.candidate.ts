/**
 * g16-shear-organ: the aberration fluid as a THREE-REGISTER organ.
 *
 * Purely timbral fluid choreography — no phrase grammar. Each register
 * of the music owns one QUALITY of the chromatic-shear fluid, and the
 * dominant deck's EQ knobs are the organ stops:
 *
 * - BASS register -> shear MAGNITUDE. Kill eq.low and the fluid goes
 *   still (fringes freeze and dissolve); a busy bassline keeps it
 *   churning, kicks slam it outward.
 * - MID register -> SWIRL. The shear direction slowly orbits (cyclonic
 *   drift) at a rate riding the slow mids. Kill eq.mid and the swirl
 *   freezes — the fluid still breathes but stops rotating.
 * - HIGH register -> fringe FINENESS. An angular micro-modulation of the
 *   shear direction at frequency ~14..84 makes fine interleaved
 *   interference fringes. Kill eq.high and the fringes go broad and
 *   soapy (soft smears instead of fine filaments).
 *
 * Scene: 24 spectrum reeds around a ring feed palette color into the
 * fluid, plus a solid bass puck (kicks = solid responses). The fluid is
 * the star; the reeds are just its food.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const N = 24;

const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

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
uniform float u_bassMag;    // BASS register: shear magnitude drive (eq.low-gated)
uniform float u_swirl;      // MID register: shear direction offset, radians
uniform float u_fineFreq;   // HIGH register: fringe fineness (angular frequency)
uniform float u_fineAmt;    // HIGH register: fringe modulation depth (eq.high-gated)
uniform float u_eqLow;      // reed-band tints (kill legibility)
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_reedSpin;   // slow reed carousel (slow-band driven)
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_hueRot;     // per-song hue anchor, TURNS
uniform float u_fringeRot;  // fringe hue pair steering, TURNS
uniform float u_decay;
uniform float u_zoom;
uniform float u_energy;
uniform float u_seed;
uniform float u_fluid;      // param: overall fluid scale
uniform float u_palette;
uniform float u_spectrum[24];

const float TAU = 6.28318530718;
const float PI = 3.14159265359;

vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * TAU;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

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

vec3 palA(float t) { return vec3(0.48, 0.22, 0.14) + vec3(0.45, 0.4, 0.3) * cos(TAU * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.16, 0.35))); }
vec3 palB(float t) { return vec3(0.18, 0.3, 0.48) + vec3(0.35, 0.45, 0.5) * cos(TAU * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.55))); }
vec3 palette(float t) {
  return mix(palA(t), palB(t), clamp(u_palette, 0.0, 1.0));
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

  // ---- Warp: barely-there drift; the SHEAR is the motion here.
  vec2 w = c / u_zoom;
  float front = 0.12 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - front) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 src = (w + dirW * rippleWave * 0.03) / vec2(aspect, 1.0) + 0.5;

  // ---- THE INSTRUMENT: three registers of chromatic shear.
  // Direction = radial, orbited by the MID swirl, micro-modulated by the
  // HIGH fineness (fine alternating shear -> fine interference fringes).
  float fine = u_fineAmt * sin(ang * u_fineFreq + r * 30.0 + t * 2.4);
  float theta = u_swirl + fine;
  float scs = cos(theta);
  float ssn = sin(theta);
  vec2 shearDir = mat2(scs, -ssn, ssn, scs) * dirW;
  // Magnitude = BASS register (+ kick slam + ripple accents).
  float shear = (0.0006 + 0.011 * u_bassMag + 0.0045 * u_kick
    + 0.008 * rippleWave) * u_fluid;
  vec2 ab = shearDir * shear / vec2(aspect, 1.0);
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -u_fringeRot).r,
    hueRotate(tapC, -u_fringeRot).g,
    hueRotate(tapB, -u_fringeRot).b
  ), u_fringeRot));
  // Unsharp keeps the interference filamentary; when the HIGH register is
  // killed we soften it (broad soapy smears) — fineness dies visibly.
  float sharpen = mix(0.12, 0.38, clamp(u_eqHigh, 0.0, 1.0));
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 field = max(vec3(0.0), sampled * (1.0 + sharpen) - blur * sharpen) * u_decay;

  // ---- Scene: 24 spectrum reeds around the ring — the fluid's food.
  vec3 fresh = vec3(0.0);
  float reverb = 1.0 + 1.8 * rippleWave;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float aI = TAU * (fi + 0.5) / 24.0 + u_reedSpin;
    float d = mod(ang - aI + PI, TAU) - PI;
    float spec = u_spectrum[i];
    float eq = fi < 8.0 ? u_eqLow : (fi < 16.0 ? u_eqMid : u_eqHigh);
    float rOut = 0.24 + 0.3 * spec;
    float reed = exp(-d * d * 520.0)
      * smoothstep(0.17, 0.2, r) * smoothstep(rOut, rOut - 0.05, r);
    vec3 tint = hueRotate(palette(fi / 24.0 * 0.85 + t * 0.012), u_hueRot);
    fresh += tint * reed * (0.25 + 1.1 * spec) * clamp(eq, 0.0, 1.5);
  }
  // Solid bass puck: kicks are SOLID (taste law) — a filled disc that
  // pulses with the low band and whitens under a kick.
  float puckR = 0.09 + 0.05 * u_low + 0.02 * u_kick;
  float puck = smoothstep(puckR, puckR - 0.025, r);
  vec3 puckColor = hueRotate(mix(palette(0.04), vec3(1.0, 0.94, 0.88), 0.5 * u_kick), u_hueRot);
  fresh += puckColor * puck * (0.35 + 1.1 * u_low + 1.6 * u_kick) * clamp(u_eqLow, 0.0, 1.5);
  // Snare arc: localized flash on the reed ring.
  if (u_snare > 0.04) {
    float arc = exp(-pow((r - 0.3) * 26.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 4.0);
    fresh += hueRotate(palette(0.4), u_hueRot) * arc * u_snare * 1.2;
  }
  fresh *= reverb;
  field += fresh * (1.0 - u_decay) * (3.2 + 1.5 * u_energy);

  // Kick shock wave through the fluid.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 40.0, 2.0));
    field += puckColor * shock * u_kick * 0.9;
    field *= 1.0 + 0.07 * u_kick;
  }

  field += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * 0.012;

  field *= 0.75 + 0.36 * u_energy;
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.8) {
    field *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

function dominantDeck(frame: VisualizerFrameData) {
  return frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
}

const preset: VisualizerPreset = {
  id: 'g16-shear-organ',
  name: 'g16 shear-organ',
  hiRes: true,
  params: [
    { id: 'fluid', label: 'fluid scale', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'memory', label: 'organ memory', min: 0.5, max: 1.8, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette (ember→glacier)', min: 0, max: 1, step: 0.05, default: 0.25 },
  ],
  create: () => {
    let swirl = 0;
    let reedSpin = 0;
    let rippleAge = 99;
    let rippleAmp = 0;
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastTrack: number | null = null;
    let slowCentroid = 0.5;
    // EQ smoothing (~0.3s): knob rides are visible but not zipper-y; the
    // fineness frequency gets extra smoothing (spatial reorganization).
    let eqL = 1;
    let eqM = 1;
    let eqH = 1;
    let fineFreq = 30;
    const spectrum = new Float32Array(N);
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        const sustained = Math.min(1, energy * 1.4);

        const deck = dominantDeck(frame);
        const a = 1 - Math.exp(-dt / 0.3);
        eqL += (Math.max(0, (deck?.eq.low ?? 0.5) * 2) - eqL) * a;
        eqM += (Math.max(0, (deck?.eq.mid ?? 0.5) * 2) - eqM) * a;
        eqH += (Math.max(0, (deck?.eq.high ?? 0.5) * 2) - eqH) * a;

        // BASS register: shear magnitude — slow lows for the sustained
        // churn (motion law), eq.low gates it. Kick slam added in-shader.
        const bassMag = (0.15 + 0.85 * motion.low) * Math.min(1.3, eqL);
        // MID register: swirl RATE rides slow mids (motion law), frozen
        // by an eq.mid kill.
        swirl += dt * (0.1 + 2.0 * motion.mid * Math.min(1.3, eqM));
        // HIGH register: fringe fineness — heavily smoothed frequency
        // (spatial reorganization must crawl, not jitter).
        const fineTarget = 14 + 70 * Math.min(1, motion.high * 1.2) * Math.min(1, eqH);
        fineFreq += (fineTarget - fineFreq) * (1 - Math.exp(-dt / 0.8));
        const fineAmt = (0.08 + 0.5 * Math.min(1, frame.bands.high * 1.3)) * Math.min(1, eqH);

        reedSpin += dt * (0.02 + 0.12 * motion.mid); // motion: slow bands
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.1);
        }

        const track = deck?.trackId ?? null;
        if (track !== null && track !== lastTrack) {
          lastTrack = track;
          hueAnchorTarget = splitmix01(track);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        const hueRot = ((((hueAnchor + (slowCentroid - 0.5) * 0.6) % 1) + 1) % 1);

        for (let i = 0; i < N; i++) spectrum[i] = Math.min(1, frame.spectrum[i] ?? 0);
        const memory = frame.params.memory ?? 1;
        const baseDecay = 0.988 + 0.006 * sustained;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_bassMag: bassMag,
          u_swirl: swirl,
          u_fineFreq: fineFreq,
          u_fineAmt: fineAmt,
          u_eqLow: eqL,
          u_eqMid: eqM,
          u_eqHigh: eqH,
          u_reedSpin: reedSpin,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_hueRot: hueRot,
          u_fringeRot: (slowCentroid - 0.5) * 0.6,
          u_decay: Math.min(0.996, 1 - (1 - baseDecay) / memory),
          u_zoom: 1 + (0.03 + 0.2 * Math.min(1, energyOf(motion) * 1.4)) * dt,
          u_energy: sustained,
          u_seed: Math.floor(frame.time * 8),
          u_fluid: frame.params.fluid ?? 1,
          u_palette: frame.params.palette ?? 0.25,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default preset;
