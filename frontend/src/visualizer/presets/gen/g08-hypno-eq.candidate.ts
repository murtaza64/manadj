/**
 * "g08 hypno eq" (genetic arena g08, tweak of g07-hypno — spectrum-mapping
 * study).
 *
 * PARENT: g07-hypno (a FLAT analytic hypnotic-pattern engine ported from
 * spiral-vr/generate.py — polar field bands, MULTIPLIED layers, analytic
 * antialiasing, Nyquist gray-out; rotation phase advances with the beat so
 * the spiral BREATHES). This file copies that engine wholesale, applies the
 * SAME note fixes as g08-hypno-pulse (constant speed, energy -> glow, per-bar
 * palette steps, A/B swap on beat), THEN maps the spectrum to three
 * INDEPENDENTLY LEGIBLE pattern properties per the human's EQ ask.
 *
 * Human ask (verbatim): "lows influence property a, mids influence colors,
 * highs influence something else" — applied to the hypno engine as:
 *   LOWS  = band CONTRAST depth + TWIST amount. Heavy bass = ink-black tight
 *           coils; bass KILL = loose, soft spiral. Killing the low EQ knob
 *           must VISIBLY relax the pattern (contrast drops, twist unwinds,
 *           softness rises).
 *   MIDS  = the travelling PALETTE of band A: A's hue center follows the mid
 *           spectral content / centroid. Sweeping mids re-hues band A only.
 *   HIGHS = band B EDGE treatment: crisp shimmer fringing at high highs, soft
 *           matte edges without. Sweeping highs changes B's edge crispness.
 * The three must move independently: turn one EQ knob, see one property move.
 *
 * NOTE FIXES carried from g08-hypno-pulse (the human's g07 feedback):
 *  (1) ROTATION SPEED CONSTANT — bar-rational + bpm/slider only; energy/drop
 *      never touch the clock (energy speed was jarring).
 *  (2) ENERGY/DROP -> GLOW — smoothed max(drop, energy) drives band bloom +
 *      edge luminosity, not speed.
 *  (3) PALETTE STEPS PER BAR — hard step through a genome sequence on each bar
 *      rollover (bpm-aligned).
 *  (4) A/B SWAP ON BEAT — instant chroma exchange each whole beat.
 *      PHOTOSAFE: both endpoints are luma-equalized (Rec.601), so the swap is
 *      pure chroma with no full-field luminance flash; bands are spatially
 *      interleaved so local mean luma is swap-invariant too. Kick = twist
 *      surge stays (twist, not speed).
 *
 * PHOTOSAFETY MACHINERY (kept intact from g07): flicker-capped clock, analytic
 * Nyquist gray-out, no black/white or saturated-red pairs, equal-luma endpoints.
 *
 * INDEPENDENCE OF THE THREE MAPPINGS: lows drive contrast/twist/softness
 * (geometry + tightness), mids drive ONLY band A's hue phase, highs drive ONLY
 * band B's edge crispness. No shared term, so an EQ sweep on one knob is
 * legible in exactly one property. Frame bands.low/mid/high are already the
 * isolator-aligned (EQ-reactive) levels, so an EQ kill reads through directly.
 *
 * Assigned tech: bands low/mid/high (primary EQ mapping), centroid, beat phase
 * + bpm, impulses, ladder tiers, trend split.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks. Analytic — no uniform-dependent loops, no derivatives ext.
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_phase;      // beat-locked rotation phase (radians), CONSTANT speed
uniform float u_zoomPhase;  // beat-locked inward zoom phase (log-r shift)
uniform float u_arms;       // angular band count (family + phrase drift)
uniform float u_twist;      // radial band density (family + phrase + LOWS)
uniform float u_fu;         // family: angular term enable/weight
uniform float u_fv;         // family: radial term enable/weight
uniform float u_mode2;      // 0 = single layer, 1 = double (counter-rot moire)
uniform float u_fu2;        // second layer angular weight (double/checker)
uniform float u_fv2;        // second layer radial weight
uniform float u_rate2;      // second layer rotation sign (counter-rotation)
uniform float u_mandala;    // 1 = first layer static (mandala rays don't spin)
uniform float u_soft;       // band softness floor (LOWS relax raises this)
uniform float u_contrast;   // LOWS -> ink-black vs blazing band contrast
uniform float u_kick;       // impulse.low: twist surge glow accent (JS-applied)
uniform float u_highEdge;   // HIGHS -> band B edge crispness (shimmer fringing)
uniform float u_glow;       // ENERGY/DROP -> glow: band bloom + edge luminosity
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_bass;       // bands.low
uniform float u_palA;       // band A hue phase (per-bar step + MIDS travel)
uniform float u_palB;       // band B hue phase (per-bar step)
uniform float u_swap;       // A/B chroma swap on beat: 0 = A..B, 1 = B..A
uniform float u_wash;       // low-bass soft-wash lift (never plain)

vec3 pal(float t) {
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Force a color to a TARGET luma holding chroma direction — makes the A/B beat
// swap photosafe (equal-luminance endpoints => pure chroma exchange).
vec3 setLuma(vec3 c, float target) {
  float l = luma(c);
  vec3 shifted = c + (target - l);
  return clamp(shifted, 0.0, 1.0);
}

// Two-color pair. u_palA carries the per-bar step PLUS the MIDS hue travel
// (band A only); u_palB carries the per-bar step for band B. Both endpoints
// luma-equalized; u_swap exchanges them (photosafe chroma swap).
vec3 bandColor(float v) {
  vec3 a = pal(u_palA);
  vec3 b = pal(u_palB);
  float lt = 0.5 * (luma(a) + luma(b));
  a = setLuma(a, lt);
  b = setLuma(b, lt);
  vec3 lo = mix(a, b, u_swap);
  vec3 hi = mix(b, a, u_swap);
  return mix(lo, hi, v);
}

float layer(float u, float v, float r, float fuw, float fvw, float rot, float pxScale, out float amp) {
  float a = fuw;
  float b = fvw;
  float base = a * u + b * v;
  float layerMag = sqrt(a * a + b * b);
  float fw = layerMag / r * pxScale;
  float width = max(fw, max(u_soft, 1e-4));
  amp = clamp((2.4 - fw) / 1.5, 0.0, 1.0);
  return clamp(sin(base + rot) / width, -1.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  float r = max(length(p), 1e-4);
  float u = atan(p.y, p.x);
  float v = log(r) - u_zoomPhase;

  float pxScale = 2.0 / u_res.y;

  float fuw = u_fu * u_arms;
  float fvw = u_fv * u_twist;

  float amp1;
  float rot1 = mix(u_phase, 0.0, u_mandala);
  float e1 = layer(u, v, r, fuw, fvw, rot1, pxScale, amp1);
  float band = e1 * amp1;
  float ampMin = amp1;

  if (u_mode2 > 0.5) {
    float amp2;
    float rot2 = u_phase * u_rate2;
    float e2 = layer(u, v, r, u_fu2 * u_arms, u_fv2 * u_twist, rot2, pxScale, amp2);
    band *= e2 * amp2;
    ampMin = min(ampMin, amp2);
  }

  float bv = band * 0.5 + 0.5;

  // LOWS -> contrast depth (ink-black tight vs loose soft). Bass kill relaxes
  // toward a soft mid wash (u_contrast falls with the low knob).
  float c = u_contrast;
  float centered = (bv - 0.5) * (1.0 + 2.2 * c);
  bv = clamp(0.5 + centered, 0.0, 1.0);

  // HIGHS -> band B edge treatment. bv > 0.5 is the band-B territory; when
  // highs are up, sharpen those edges (crisp shimmer fringing) with a
  // counter-phase ripple; when highs are low, leave matte. Localized to the
  // B boundary, mid/high-domain — not a full-field flash.
  float edge = 1.0 - abs(bv - 0.5) * 2.0;
  float bSide = smoothstep(0.5, 0.7, bv); // 1 in band-B territory
  float shimmer = sin((u + v) * 40.0 + u_time * 6.0);
  bv = clamp(bv + (edge * edge) * u_highEdge * bSide * 0.22 * shimmer, 0.0, 1.0);

  vec3 col = bandColor(bv);

  vec3 midGray = bandColor(0.5);
  col = mix(midGray, col, ampMin);

  col = mix(col, bandColor(0.5 + 0.35 * sin(u_time * 0.4)), (1.0 - u_bass) * u_wash * 0.25);

  // ENERGY/DROP -> GLOW (hue-preserving, ampMin-gated so sub-Nyquist stays gray).
  float bloom = 0.55 * u_glow * (0.35 + 0.65 * u_sustain);
  float edgeLum = (edge * edge) * u_glow * 0.6;
  col += bandColor(bv) * bloom * ampMin;
  col += bandColor(0.85) * edgeLum * ampMin;

  float lift = 0.68 + 0.35 * u_sustain;
  col *= lift;

  col += bandColor(bv) * u_kick * (0.22 + 0.4 * u_bass) * ampMin;

  float mx = max(col.r, max(col.g, col.b));
  if (mx > 0.9) {
    col *= (0.9 + 0.1 * (1.0 - exp(-(mx - 0.9) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'density', label: 'band density', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'softness', label: 'band softness', min: 0, max: 1.5, step: 0.05, default: 0.35 },
  { id: 'contrast', label: 'bass contrast depth', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'speed', label: 'rotation speed', min: 0.3, max: 1.5, step: 0.05, default: 1 },
  { id: 'glow', label: 'energy glow', min: 0.3, max: 2, step: 0.05, default: 1 },
];

interface Family {
  name: string;
  arms: number;
  twist: number;
  fu: number;
  fv: number;
  mode2: boolean;
  fu2: number;
  fv2: number;
  rate2: number;
  mandala: boolean;
  angularBands: number;
  ringSweep: boolean;
}

const FAMILIES: Family[] = [
  { name: 'spiral', arms: 4, twist: 6, fu: 1, fv: 1, mode2: false, fu2: 0, fv2: 0, rate2: 1, mandala: false, angularBands: 4, ringSweep: false },
  { name: 'double', arms: 4, twist: 6, fu: 1, fv: 1, mode2: true, fu2: 1, fv2: -1, rate2: -1, mandala: false, angularBands: 4, ringSweep: false },
  { name: 'checker', arms: 8, twist: 8, fu: 1, fv: 0, mode2: true, fu2: 0, fv2: 1, rate2: 1, mandala: false, angularBands: 8, ringSweep: true },
  { name: 'pinwheel', arms: 12, twist: 0, fu: 1, fv: 0, mode2: false, fu2: 0, fv2: 0, rate2: 1, mandala: false, angularBands: 12, ringSweep: false },
  { name: 'mandala', arms: 8, twist: 8, fu: 1, fv: 0, mode2: true, fu2: 0, fv2: 1, rate2: 1, mandala: true, angularBands: 8, ringSweep: true },
];

const DOUBLE_INDEX = 1; // forced on drops (family only — NOT speed)

const FLICKER_CAP_HZ = 2.4;

// Per-bar palette genome (hue phases; luma-equalized in-shader). Wide-span,
// bright/saturated pairs.
const PALETTE_SEQ: Array<[number, number]> = [
  [0.0, 0.45],
  [0.12, 0.62],
  [0.28, 0.72],
  [0.55, 0.9],
  [0.7, 0.15],
  [0.85, 0.35],
  [0.05, 0.5],
  [0.4, 0.82],
];

const g08HypnoEqPreset: VisualizerPreset = {
  id: 'g08-hypno-eq',
  name: 'g08 hypno eq',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    let phase = 0;
    let zoomPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothGlow = 0;
    let surge = 0;
    // Smoothed EQ bands for the three mappings (short smoothing so an EQ sweep
    // reads promptly but doesn't chatter).
    let smoothLow = 0;
    let smoothMid = 0;
    let smoothHigh = 0;
    let midHue = 0; // band A hue travel driven by mids/centroid
    let familyIndex = 0;
    let curArms = FAMILIES[0].arms;
    let curTwist = FAMILIES[0].twist;
    let lastSection = -1;
    let lastBar = -1;
    let paletteStep = 0;
    let paletteOffset = 0;
    let lastBeatInBar = -1;
    let swap = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: false,
      uniforms: (frame: VisualizerFrameData) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const bpm = frame.beat?.bpm ?? 0;
        const beatRate = bpm > 0 ? bpm / 60 : 2;

        // --- Regime split (smoothed ~0.35 s).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, energy * 1.4);
        const glowTarget = Math.max(smoothDrop, sustained);
        smoothGlow += (glowTarget - smoothGlow) * rAlpha;
        const isDrop = smoothDrop > 0.45;

        // --- Smoothed EQ bands (~0.12 s) — prompt but stable for the mappings.
        const eqAlpha = 1 - Math.exp(-dt / 0.12);
        smoothLow += (frame.bands.low - smoothLow) * eqAlpha;
        smoothMid += (frame.bands.mid - smoothMid) * eqAlpha;
        smoothHigh += (frame.bands.high - smoothHigh) * eqAlpha;

        // --- Section / phrase / bar tiers (ladder-correct with fallback).
        const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
        const section = Math.floor(barIndex / 16);
        const phraseBar = barIndex % 4;
        const barPhase = frame.beat?.barPhase ?? 0;

        if (section !== lastSection && lastSection >= 0) {
          familyIndex = (familyIndex + 1) % FAMILIES.length;
          paletteOffset = (paletteOffset + 3) % PALETTE_SEQ.length;
        }
        lastSection = section;
        const targetFamily = isDrop ? FAMILIES[DOUBLE_INDEX] : FAMILIES[familyIndex];

        // --- PALETTE STEPS PER BAR (bpm-aligned hard step).
        if (barIndex !== lastBar) {
          if (lastBar >= 0) paletteStep = (paletteStep + 1) % PALETTE_SEQ.length;
          lastBar = barIndex;
        }
        const pair = PALETTE_SEQ[(paletteStep + paletteOffset) % PALETTE_SEQ.length];

        // --- A/B SWAP ON BEAT.
        const beatInBar = frame.beat?.beatInBar ?? -1;
        if (beatInBar !== lastBeatInBar) {
          if (lastBeatInBar >= 0) swap = swap > 0.5 ? 0 : 1;
          lastBeatInBar = beatInBar;
        }

        // --- Phrase drift: arms/twist ease toward the family base.
        const density = frame.params.density ?? 1;
        const anticipation = phraseBar === 3 ? barPhase : 0;
        const targetArms = targetFamily.arms;

        // LOWS -> TWIST amount. Heavy bass tightens the coils (more twist);
        // bass KILL loosens toward a slack fraction of the family base, so a
        // low-knob kill VISIBLY unwinds the spiral. Independent of mids/highs.
        const lowTwistScale = 0.45 + 0.95 * smoothLow; // 0.45x (kill) .. 1.4x (heavy)
        const targetTwist =
          targetFamily.twist *
          density *
          lowTwistScale *
          (1 + 0.12 * anticipation + 0.15 * smoothBuildup);
        const morphAlpha = 1 - Math.exp(-dt / 2.0);
        curArms += (targetArms - curArms) * morphAlpha;
        curTwist += (targetTwist - curTwist) * morphAlpha;

        // --- Kick twist surge (twist, not speed).
        const kick = frame.impulse.low;
        if (kick > surge) surge = kick;
        surge *= Math.exp(-dt / 0.5);
        const surgeTwist = curTwist * (1 + (0.3 + 0.2 * smoothGlow) * surge);

        // --- CONSTANT-speed beat-locked clock (1 band/bar, bpm + slider only).
        const speedSlider = frame.params.speed ?? 1;
        const bandsPerBar = 1;
        const beatsPerBar = frame.beat?.beatsPerBar ?? 4;
        const barsPerSec = beatRate / Math.max(1, beatsPerBar);
        const angularBands = Math.max(1, targetFamily.angularBands);
        let phaseRate = 2 * Math.PI * bandsPerBar * barsPerSec * speedSlider;
        const maxPhaseRate = (2 * Math.PI * FLICKER_CAP_HZ) / angularBands;
        if (phaseRate > maxPhaseRate) phaseRate = maxPhaseRate;
        phase += dt * phaseRate;

        // --- Zoom pulse (constant drift + kick yank, capped).
        const zoomBase = 0.15 * barsPerSec * speedSlider;
        const kickZoom = 0.6 * surge;
        let zoomRate = zoomBase + kickZoom * beatRate * 0.1;
        const ringFreq = Math.max(1, targetFamily.ringSweep ? curTwist : 0);
        if (ringFreq > 0) {
          const maxZoomRate = FLICKER_CAP_HZ / ringFreq;
          if (zoomRate > maxZoomRate) zoomRate = maxZoomRate;
        }
        zoomPhase += dt * zoomRate;

        // --- LOWS -> contrast depth + softness relax. Heavy bass = blazing/ink
        // + crisp (low softness); bass kill = soft wash + raised softness floor
        // (loose soft spiral). Independent of mids (color) and highs (B edge).
        const contrastSlider = frame.params.contrast ?? 1;
        const contrast = contrastSlider * (0.25 + 1.5 * smoothLow + 0.4 * smoothGlow);
        // Softness rises as lows fall (bass kill => soft matte coils).
        const softSlider = frame.params.softness ?? 0.35;
        const soft = softSlider + (1 - smoothLow) * 0.5;

        // --- MIDS -> band A hue travel. A's hue center follows mid content /
        // centroid; the per-bar step sets the base, mids add a travelling
        // offset (smoothed). Mids ONLY touch band A (u_palA); B is untouched.
        const midTarget = 0.5 * smoothMid + 0.5 * frame.centroid;
        midHue += (midTarget - midHue) * (1 - Math.exp(-dt / 0.4));
        const palA = pair[0] + midHue * 0.6; // wide, legible hue travel on A
        const palB = pair[1]; // B holds its per-bar step (mids don't move it)

        // --- HIGHS -> band B edge crispness (crisp shimmer at high highs).
        const highEdge = Math.min(1, smoothHigh * 1.3 + frame.impulse.high * 0.4);

        // --- Glow amount.
        const glowSlider = frame.params.glow ?? 1;
        const glow = Math.min(1.6, smoothGlow * glowSlider);

        return {
          u_time: frame.time,
          u_phase: phase,
          u_zoomPhase: zoomPhase,
          u_arms: curArms,
          u_twist: surgeTwist,
          u_fu: targetFamily.fu,
          u_fv: targetFamily.fv,
          u_mode2: targetFamily.mode2 ? 1 : 0,
          u_fu2: targetFamily.fu2,
          u_fv2: targetFamily.fv2,
          u_rate2: targetFamily.rate2,
          u_mandala: targetFamily.mandala ? 1 : 0,
          u_soft: soft,
          u_contrast: contrast,
          u_kick: kick,
          u_highEdge: highEdge,
          u_glow: glow,
          u_sustain: sustained,
          u_bass: frame.bands.low,
          u_palA: palA,
          u_palB: palB,
          u_swap: swap,
          u_wash: 1,
        };
      },
    });
  },
};

export default g08HypnoEqPreset;
