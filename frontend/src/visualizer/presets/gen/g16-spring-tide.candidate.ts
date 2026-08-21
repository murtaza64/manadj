/**
 * g16-spring-tide: the aberration fluid as a PHRASE instrument.
 *
 * Voyage's chromatic-shear feedback fluid, choreographed by the 4-bar
 * phrase: the fluid is nearly DRY on bar 1, swells continuously across
 * the phrase, and surges by bar 4 — then CRASHES on the boundary: a
 * bloom ripple stamps outward and the shear hard-resets to dry, so the
 * accumulated fringes visibly still and dissolve. Every 16 bars is a
 * spring tide: a bigger crash plus a jump of the fringe hue pair
 * (rotate-select-rotate frame keyed off the trackId genome + section).
 * Without a grid the tide falls back to a slow sine and never blooms.
 *
 * The scene is deliberately minimal — a charged moon ring over a dark
 * tidal basin of palette wisps — so the fluid carries the show.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

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
uniform float u_lowSlow;   // motion-grade (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;   // motion-grade (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_sparkle;
uniform float u_centroid;
uniform float u_specHue;
uniform float u_hueRot;    // per-song hue anchor, TURNS
uniform float u_fringeRot; // fringe hue pair steering, TURNS (section jumps)
uniform float u_tide;      // THE instrument: phrase-locked fluid amount 0..1
uniform float u_bloomAge;  // seconds since the last phrase crash
uniform float u_bloomAmp;  // that crash's strength (spring tides bigger)
uniform float u_rippleAge; // kick ripple (physicality, voyage idiom)
uniform float u_rippleAmp;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_energy;    // sustained loudness (brightness, not motion)
uniform float u_charge;    // moon-ring kick charge
uniform float u_fluid;     // param: overall fluid scale
uniform float u_palette;

vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
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

vec3 pal0(float t) { return vec3(0.45, 0.16, 0.38) + vec3(0.45, 0.3, 0.42) * cos(6.28318 * (vec3(1.0, 0.9, 0.65) * t + vec3(0.0, 0.18, 0.42))); }
vec3 pal1(float t) { return vec3(0.16, 0.34, 0.44) + vec3(0.3, 0.45, 0.5) * cos(6.28318 * (vec3(0.9, 1.0, 0.75) * t + vec3(0.1, 0.28, 0.5))); }
vec3 pal2(float t) { return vec3(0.5, 0.34, 0.16) + vec3(0.48, 0.4, 0.3) * cos(6.28318 * (vec3(1.0, 0.88, 0.7) * t + vec3(0.0, 0.14, 0.3))); }
vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 2.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  return mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
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

  // ---- Warp: gentle differential rotation; churn grows WITH the tide
  // (high tide = turbulent water). Motion terms ride slow bands.
  float rot = u_rotStep * (0.3 + 1.0 * exp(-r * 2.0));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 churn = (vec2(
    fbm(c * 2.8 + t * 0.11),
    fbm(c * 2.8 + vec2(7.7, 3.1) - t * 0.08)
  ) - 0.5) * (0.0015 + 0.014 * u_midSlow) * (0.35 + 1.1 * u_tide);
  // Phrase crash bloom: a wide wavefront that carries the fluid outward
  // as it dies (the crash), plus the standard kick ripple for punch.
  float bloomFront = 0.1 + u_bloomAge * 1.05;
  float bloomWave = exp(-pow((r - bloomFront) * 6.5, 2.0)) * exp(-u_bloomAge * 1.7) * u_bloomAmp;
  float front = 0.14 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - front) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 push = dirW * (bloomWave * 0.03 + rippleWave * 0.028);
  vec2 src = (w + churn + push) / vec2(aspect, 1.0) + 0.5;

  // ---- THE INSTRUMENT: chromatic shear whose magnitude IS the phrase.
  // Dry at bar 1 (near-zero split -> image goes crisp), surging by bar 4,
  // and blown wide open along a crash wavefront.
  float shear = (0.0005 + 0.0115 * u_tide + 0.003 * u_kick
    + 0.013 * bloomWave + 0.006 * rippleWave) * u_fluid;
  vec2 ab = dirW * shear / vec2(aspect, 1.0);
  // Hue-steerable fringe pair (dust-v4 idiom): rotate to the section's
  // fringe frame, split channels there, rotate back.
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -u_fringeRot).r,
    hueRotate(tapC, -u_fringeRot).g,
    hueRotate(tapB, -u_fringeRot).b
  ), u_fringeRot));
  // Unsharp anti-mush tap (voyage idiom) — keeps fringes filamentary.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Minimal scene, injected at (1 - decay): the fluid's food.
  vec3 fresh = vec3(0.0);
  float reverb = 1.0 + 2.4 * bloomWave + 1.6 * rippleWave;
  // Moon ring: the bass element. Charges with kicks, jitters electrically.
  float volt = noise(vec2(ang * 16.0 + t * 3.0, t * 24.0)) - 0.5;
  float horizon = (0.15 + 0.08 * u_low) * (1.0 + 0.06 * u_charge);
  float arcJitter = volt * (0.01 + 0.04 * u_kick + 0.02 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 48.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 200.0, 2.0));
  vec3 moon = hueRotate(mix(palette(0.03 + u_specHue * 0.5), vec3(1.0, 0.96, 0.9),
    clamp(u_charge - 0.5, 0.0, 0.5) * 2.0), u_hueRot);
  fresh += moon * ringGlow * (0.14 + 0.7 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(moon, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.35 + 1.3 * u_low + 2.2 * u_kick + 0.7 * u_charge);
  // Tidal basin: palette wisps around the ring — brighter at high tide so
  // the fluid always has fresh color to shear (wide phase span, spectral
  // hue travel; the shear does the rest).
  float wisp = fbm(vec2(ang * 2.4 + r * 3.2 - t * 0.14, r * 5.5 + t * 0.05));
  float basin = pow(wisp, 2.3) * smoothstep(horizon * 0.9, horizon * 1.7, r) * exp(-r * 2.1);
  vec3 basinColor = hueRotate(palette(wisp * 1.5 + r * 0.4 + ang * 0.12
    + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += basinColor * basin * (0.25 + 1.1 * u_mid) * (0.55 + 0.75 * u_tide) * midGate * reverb;
  // High shimmer: fine counter-drifting filaments (no dust powder — the
  // aberration fluid supplies the fine texture).
  float sheen = fbm(vec2(ang * 5.0 - t * 0.4, r * 9.0 + t * 0.2));
  fresh += hueRotate(mix(vec3(0.5, 0.9, 1.0), palette(0.6 + t * 0.03), 0.6), u_hueRot)
    * pow(sheen, 3.4) * smoothstep(0.14, 0.5, r) * (0.06 + 1.4 * u_high) * reverb;
  // Snare spray: brief bright droplets flung off the basin.
  if (u_sparkle > 0.01) {
    vec2 q = c * 15.0;
    vec2 cell = floor(q);
    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
    vec2 f = fract(q) - pos;
    float on = step(0.975, hash(sc * 1.618 + 9.7));
    float drop = exp(-dot(f, f) * 340.0);
    sky += hueRotate(mix(vec3(1.0), palette(0.2 + hash(sc) * 0.6), 0.5), u_hueRot)
      * drop * on * u_sparkle * smoothstep(0.12, 0.3, r);
  }
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.5 * u_energy);

  // Crash flash: the bloom wavefront itself glows palette-hot as it dies —
  // one localized ring per phrase, never a full-field strobe.
  sky += hueRotate(palette(0.1 + u_specHue * 0.5), u_hueRot)
    * bloomWave * (0.5 + 0.5 * u_energy) * 0.9;

  // Kick shock (localized) + tiny whole-frame punch (transient envelope).
  if (u_kick > 0.02) {
    float ringR = 0.09 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 40.0, 2.0));
    sky += mix(moon, vec3(1.0, 0.92, 0.82), 0.5) * shock * u_kick * 1.0;
    sky *= 1.0 + 0.08 * u_kick;
  }

  // Film grain, faint.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * 0.012;

  // Loudness lift (bounded; contraction holds via decay < 1).
  sky *= 0.74 + 0.38 * u_energy;
  // Chroma-preserving soft knee.
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

function dominantDeck(frame: VisualizerFrameData) {
  return frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
}

const preset: VisualizerPreset = {
  id: 'g16-spring-tide',
  name: 'g16 spring-tide',
  hiRes: true,
  params: [
    { id: 'fluid', label: 'fluid scale', min: 0.2, max: 2, step: 0.05, default: 1 },
    { id: 'memory', label: 'water memory', min: 0.5, max: 1.8, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette (rose→lagoon→amber)', min: 0, max: 2, step: 0.05, default: 0.5 },
  ],
  create: () => {
    let bloomAge = 99;
    let bloomAmp = 0;
    let rippleAge = 99;
    let rippleAmp = 0;
    let charge = 0;
    let lastPhraseIdx: number | null = null;
    let lastSectionIdx: number | null = null;
    let fringeRot = 0;
    let fringeTarget = 0;
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastTrack: number | null = null;
    let slowCentroid = 0.5;
    let energySlow = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        energySlow += (energy - energySlow) * (1 - Math.exp(-dt / 0.6));
        const sustained = Math.min(1, energy * 1.4);

        // ---- THE PHRASE TIDE. ladderBarIndex so rollovers land on the
        // metric ladder's boundaries; ungridded = slow sine, no crashes.
        const beat = frame.beat;
        const bar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        let tide: number;
        if (beat && bar !== null && beat.bpm) {
          const phrasePos = (((bar % 4) + 4) % 4) + Math.min(1, Math.max(0, beat.barPhase));
          const phraseT = phrasePos / 4; // 0 at bar 1's downbeat -> 1 at the crash
          tide = Math.pow(phraseT, 1.35);
          const phraseIdx = Math.floor(bar / 4);
          const sectionIdx = Math.floor(bar / 16);
          if (lastPhraseIdx !== null && phraseIdx !== lastPhraseIdx) {
            // CRASH: bloom ripple; spring tide (section) crashes harder and
            // jumps the fringe hue pair (trackId genome + section).
            bloomAge = 0;
            const spring = lastSectionIdx !== null && sectionIdx !== lastSectionIdx;
            bloomAmp = Math.min(1.5, (0.7 + 0.6 * energySlow) * (spring ? 1.5 : 1));
          }
          if (sectionIdx !== lastSectionIdx) {
            const key = dominantDeck(frame)?.trackId ?? 23;
            fringeTarget = (splitmix01(key * 7 + sectionIdx * 131) - 0.5) * 0.9;
            lastSectionIdx = sectionIdx;
          }
          lastPhraseIdx = phraseIdx;
        } else {
          tide = 0.5 + 0.5 * Math.sin((frame.time * Math.PI * 2) / 9);
          lastPhraseIdx = null;
        }
        // Quiet tracks stay calmer even at high tide (energy gate on the
        // instrument's ceiling, not its phrase shape).
        tide *= 0.3 + 0.7 * Math.min(1, energySlow * 1.6);

        bloomAge += dt;
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.1);
        }
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.26);
        fringeRot += (fringeTarget - fringeRot) * (1 - Math.exp(-dt / 1.2));

        // Per-song hue anchor (dominantChannel LAW — never level argmax).
        const track = dominantDeck(frame)?.trackId ?? null;
        if (track !== null && track !== lastTrack) {
          lastTrack = track;
          hueAnchorTarget = splitmix01(track);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        const hueRot = ((((hueAnchor + (slowCentroid - 0.5) * 0.7) % 1) + 1) % 1);

        const memory = frame.params.memory ?? 1;
        // Higher tide holds water longer (still contractive, capped).
        const baseDecay = 0.988 + 0.008 * tide - 0.006 * (1 - sustained) * 0.5;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_lowSlow: motion.low,
          u_mid: frame.bands.mid,
          u_midSlow: motion.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          // Spray is a mid/high effect — kick-gated (taste law).
          u_sparkle:
            Math.min(1, 0.9 * frame.impulse.mid + 0.5 * frame.impulse.high) /
            (1 + 2.2 * frame.impulse.low),
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_hueRot: hueRot,
          u_fringeRot: fringeRot,
          u_tide: tide,
          u_bloomAge: bloomAge,
          u_bloomAmp: bloomAmp,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          // Slow outward drift + kick lunge; velocity rides slow bands.
          u_zoom: 1 + (0.05 + 0.3 * Math.min(1, energyOf(motion) * 1.4)
            + 2.2 * frame.impulse.low * 0.5) * dt,
          u_rotStep: (0.04 + 0.4 * motion.mid) * dt,
          u_decay: Math.min(0.997, 1 - (1 - baseDecay) / memory),
          u_seed: Math.floor(frame.time * 20),
          u_energy: sustained,
          u_charge: charge,
          u_fluid: frame.params.fluid ?? 1,
          u_palette: frame.params.palette ?? 0.5,
        };
      },
    });
  },
};

export default preset;
