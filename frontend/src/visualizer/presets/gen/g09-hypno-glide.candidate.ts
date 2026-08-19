/**
 * "g09 hypno glide" (genetic arena g09, tweak of g08-hypno-pulse +
 * g08-hypno-eq — motion-smoothness fix + gen-9 spectral colors).
 *
 * PARENTS: g08-hypno-pulse (1016) and g08-hypno-eq. Both copy the g07-hypno
 * analytic hypnotic-pattern engine (polar field bands, MULTIPLIED layers,
 * analytic antialiasing, Nyquist gray-out) and re-wired dynamics: constant
 * rotation speed, energy -> glow, per-bar palette steps, A/B chroma swap on
 * beat, kick = twist surge.
 *
 * Human note (verbatim, on BOTH parents): "both are still awkwardly
 * jittering, motion doesnt feel smooth".
 *
 * DIAGNOSIS: the jitter came from the rotation clock reacting to the raw beat
 * feed. Even though the parents already INTEGRATE the phase (phase += dt *
 * phaseRate) rather than sampling beat.phase, phaseRate was recomputed every
 * frame from the RAW bpm (frame.beat.bpm), which jumps with feed latency and
 * deck nudges, and from the family-switched angularBands cap, which STEPS the
 * rate discontinuously on section/drop family changes. Both make the visible
 * angular velocity twitch frame-to-frame.
 *
 * MOTION FIX (this candidate):
 *  (1) SMOOTHED BPM (tau ~2 s). The clock's cadence is driven by a heavily
 *      smoothed bpm, never the raw per-frame value. A deck nudge or a feed
 *      hiccup can't jerk the rotation.
 *  (2) INTEGRATED CONSTANT ANGULAR VELOCITY. phase += dt * phaseRate, where
 *      phaseRate is bar-rational (1 band/bar) off the SMOOTHED bpm and the
 *      speed slider ONLY. beat.phase is NEVER sampled into the clock (grep:
 *      no frame.beat.phase read anywhere in this file).
 *  (3) EASED CORRECTIONS (>=250 ms). Any residual change to phaseRate or
 *      zoomRate (family swap changing the flicker cap, bpm drift, slider move)
 *      is eased toward its target with tau = 0.30 s, so the velocity glides to
 *      a new value instead of stepping. No per-frame phase discontinuity.
 *  (4) BEAT-EDGE DETECTOR fires the A/B swap (beatInBar changing = a new beat
 *      landed), it does NOT phase-lock the clock. Integer state, instant
 *      chroma exchange, photosafe (equal-luma endpoints).
 *
 * GEN-9 SPECTRAL COLORS (the generation vocabulary):
 *  - band-A hue center = SLOW centroid (~1 s EMA).
 *  - band-B hue = the COMPLEMENT of band-A (half a hue turn away).
 *  - pair SATURATION = (1 - flatness): tonal music = vivid, noisy = washed.
 *  - the per-bar genome now offsets from this spectral base rather than being
 *    a fixed absolute sequence, so bar steps move around the music's hue.
 *  Spectral quantities are slow-tracked (centroid ~1 s, flatness ~1 s) so the
 *  color base changes on musical time, not per-frame flicker; the discrete
 *  moves (bar step, beat swap) land on musical boundaries.
 *
 * PHOTOSAFETY (kept intact from the parents): flicker-capped clock, analytic
 * Nyquist gray-out, no black/white or saturated-red pairs, equal-luma
 * endpoints (the A/B swap is a pure chroma exchange).
 *
 * Assigned tech: smoothed bpm + beat tiers (primary), impulses, bands.low,
 * ladder tiers, trend split, centroid/spread/flatness (spectral color).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks in this string (including comments). Analytic — no
// uniform-dependent loops, no derivatives extension.
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_phase;      // INTEGRATED rotation phase (radians), constant vel
uniform float u_zoomPhase;  // integrated inward zoom phase (log-r shift)
uniform float u_arms;       // angular band count (family + phrase drift)
uniform float u_twist;      // radial band density (family + phrase drift)
uniform float u_fu;         // family: angular term enable/weight
uniform float u_fv;         // family: radial term enable/weight
uniform float u_mode2;      // 0 = single layer, 1 = double (counter-rot moire)
uniform float u_fu2;        // second layer angular weight (double/checker)
uniform float u_fv2;        // second layer radial weight
uniform float u_rate2;      // second layer rotation sign (counter-rotation)
uniform float u_mandala;    // 1 = first layer static (mandala rays don't spin)
uniform float u_soft;       // band softness floor (0 hard .. ~1.5 sinusoidal)
uniform float u_contrast;   // bass -> ink-black vs blazing band contrast
uniform float u_kick;       // impulse.low: twist surge glow accent (JS-applied)
uniform float u_snareEdge;  // impulse.mid/high counter-phase edge shimmer
uniform float u_glow;       // ENERGY/DROP -> glow: band bloom + edge luminosity
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_bass;       // bands.low
uniform float u_palA;       // band A hue phase = slow centroid + bar offset
uniform float u_palB;       // band B hue phase = complement of A + bar offset
uniform float u_swap;       // A/B chroma swap on beat: 0 = A..B, 1 = B..A
uniform float u_sat;        // pair saturation = (1 - flatness) (spectral)
uniform float u_wash;       // low-bass soft-wash lift (never plain)

// iq cosine palette — bright, saturated (this repo dislikes pastels). A hue
// phase argument travels so the two band colors are never black/white and
// span a wide phase.
vec3 pal(float t) {
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
}

// Rec.601 luma.
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Force a color to a TARGET luma while holding its chroma direction — this is
// what makes the A/B swap photosafe (both endpoints share one luma, so
// exchanging them is a pure chroma move, no full-field luminance flash).
vec3 setLuma(vec3 c, float target) {
  float l = luma(c);
  vec3 shifted = c + (target - l);
  return clamp(shifted, 0.0, 1.0);
}

// Pull a color toward/away from its own luma-gray by amount s (spectral
// saturation = 1 - flatness). Applied BEFORE luma-equalization so the swap
// stays photosafe regardless of how vivid the pair is.
vec3 spectralSat(vec3 c, float s) {
  float l = luma(c);
  return clamp(mix(vec3(l), c, s), 0.0, 1.0);
}

// Two-color travelling pair for a band value v in [0,1]. Endpoints are the
// spectral hue phases u_palA (slow centroid + bar offset) and u_palB (its
// complement + bar offset), scaled by u_sat = (1 - flatness). Both endpoints
// are luma-equalized to a common target so the beat swap is a pure chroma
// exchange (photosafe). u_swap exchanges which endpoint is A vs B.
vec3 bandColor(float v) {
  vec3 a = spectralSat(pal(u_palA), u_sat);
  vec3 b = spectralSat(pal(u_palB), u_sat);
  float lt = 0.5 * (luma(a) + luma(b));
  a = setLuma(a, lt);
  b = setLuma(b, lt);
  vec3 lo = mix(a, b, u_swap);
  vec3 hi = mix(b, a, u_swap);
  return mix(lo, hi, v);
}

// One analytic band layer. base = (fu*arms)*u + (fv*twist)*v ; the band
// frequency fw = layerMag / r (world) scaled to per-pixel; amp fades the band
// to gray as fw approaches Nyquist (reference contrast envelope). rate selects
// rotation direction (counter-rotation for the double family).
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

  float c = u_contrast;
  float centered = (bv - 0.5) * (1.0 + 2.2 * c);
  bv = clamp(0.5 + centered, 0.0, 1.0);

  float edge = 1.0 - abs(bv - 0.5) * 2.0;
  bv = clamp(bv + (edge * edge) * u_snareEdge * (band > 0.0 ? 0.18 : -0.18), 0.0, 1.0);

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

  // Chroma-preserving soft knee (scale all channels by one factor above the
  // knee — never a per-channel clamp, hues hold).
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

// --- Families (ported EFFECTS table) -----------------------------------
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
  /** Bands that pass a fixed screen point per full rotation (photosafety). */
  angularBands: number;
  /** Whether the rotation clock sweeps rings past a point (radial flicker). */
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

/** The hard flicker cap in full-field alternations/sec (WCAG floor is 3). */
const FLICKER_CAP_HZ = 2.4;

// --- Per-bar hue OFFSET genome ------------------------------------------
// The gen-9 spectral base (band-A = slow centroid, band-B = its complement)
// gives the hue CENTER; this genome supplies the per-bar hue OFFSET applied
// to both endpoints (kept small so bar steps move AROUND the music's hue
// rather than overriding it). Hard-stepped each bar rollover (bpm-aligned).
const BAR_OFFSETS: number[] = [0.0, 0.08, 0.17, 0.28, 0.14, 0.05, 0.22, 0.11];

const g09HypnoGlidePreset: VisualizerPreset = {
  id: 'g09-hypno-glide',
  name: 'g09 hypno glide',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // INTEGRATED clocks (constant angular velocity — never sampled from phase).
    let phase = 0;
    let zoomPhase = 0;
    // Eased velocities (the >=250 ms correction glide). These are what phase /
    // zoomPhase integrate; targets change, these follow smoothly.
    let phaseRateCur = 0;
    let zoomRateCur = 0;
    // SMOOTHED bpm (tau ~2 s) — the clock cadence source. Never the raw bpm.
    let smoothBpm = 0;
    // Regime smoothing (taste: ride max(drop, energy), ~0.35 s split).
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothGlow = 0;
    // Kick twist surge with elastic recovery.
    let surge = 0;
    // Slow spectral trackers (~1 s EMA) — hue center + saturation base.
    let slowCentroid = 0.5;
    let slowFlatness = 0.5;
    // Family selection + morph.
    let familyIndex = 0;
    let curArms = FAMILIES[0].arms;
    let curTwist = FAMILIES[0].twist;
    let lastSection = -1;
    // Per-bar hue-offset stepping + per-beat A/B swap (integer state).
    let lastBar = -1;
    let offsetStep = 0;
    let offsetShift = 0; // section rotates which offsets come up
    let lastBeatInBar = -1;
    let swap = 0; // 0/1 toggled each whole beat (beat-edge detector)

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: false,
      uniforms: (frame: VisualizerFrameData) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);

        // --- SMOOTHED BPM (tau ~2 s). The rotation cadence source; a raw bpm
        // hiccup or deck nudge can never jerk the clock. Seed on first valid
        // reading so the pattern doesn't drift up from zero.
        const rawBpm = frame.beat?.bpm ?? 0;
        if (rawBpm > 0) {
          if (smoothBpm <= 0) smoothBpm = rawBpm;
          else smoothBpm += (rawBpm - smoothBpm) * (1 - Math.exp(-dt / 2.0));
        }
        const effBpm = smoothBpm > 0 ? smoothBpm : 120; // free-clock fallback
        const beatRate = effBpm / 60; // beats/sec (smoothed)

        // --- Regime split (smoothed ~0.35 s).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, energy * 1.4);
        const glowTarget = Math.max(smoothDrop, sustained);
        smoothGlow += (glowTarget - smoothGlow) * rAlpha;
        const isDrop = smoothDrop > 0.45;

        // --- Slow spectral trackers (~1 s EMA): hue center + saturation.
        const specAlpha = 1 - Math.exp(-dt / 1.0);
        slowCentroid += (frame.centroid - slowCentroid) * specAlpha;
        slowFlatness += (frame.flatness - slowFlatness) * specAlpha;

        // --- Section / phrase / bar tiers (ladder-correct with fallback).
        const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
        const section = Math.floor(barIndex / 16);
        const phraseBar = barIndex % 4;
        const barPhase = frame.beat?.barPhase ?? 0;

        // SECTION = family change. A drop FORCES the double family (topology
        // only — NOT the clock speed).
        if (section !== lastSection && lastSection >= 0) {
          familyIndex = (familyIndex + 1) % FAMILIES.length;
          offsetShift = (offsetShift + 3) % BAR_OFFSETS.length;
        }
        lastSection = section;
        const targetFamily = isDrop ? FAMILIES[DOUBLE_INDEX] : FAMILIES[familyIndex];

        // --- PER-BAR HUE OFFSET (bpm-aligned hard step, no interpolation).
        if (barIndex !== lastBar) {
          if (lastBar >= 0) offsetStep = (offsetStep + 1) % BAR_OFFSETS.length;
          lastBar = barIndex;
        }
        const barOffset = BAR_OFFSETS[(offsetStep + offsetShift) % BAR_OFFSETS.length];

        // --- A/B SWAP via BEAT-EDGE DETECTOR. beat.beatInBar is the whole-beat
        // ordinal; when it changes a new beat landed -> toggle the swap. This
        // FIRES the swap; it does NOT phase-lock the rotation clock. Integer
        // state, never interpolated, photosafe (equal-luma endpoints).
        const beatInBar = frame.beat?.beatInBar ?? -1;
        if (beatInBar !== lastBeatInBar) {
          if (lastBeatInBar >= 0) swap = swap > 0.5 ? 0 : 1;
          lastBeatInBar = beatInBar;
        }

        // --- Phrase drift: arms/twist wander slowly within the family, then
        // ease toward the family base.
        const density = frame.params.density ?? 1;
        const anticipation = phraseBar === 3 ? barPhase : 0;
        const targetArms = targetFamily.arms;
        const targetTwist =
          targetFamily.twist * density * (1 + 0.12 * anticipation + 0.15 * smoothBuildup);
        const morphAlpha = 1 - Math.exp(-dt / 2.0);
        curArms += (targetArms - curArms) * morphAlpha;
        curTwist += (targetTwist - curTwist) * morphAlpha;

        // --- Kick twist surge: instant attack, elastic (spring) recovery.
        const kick = frame.impulse.low;
        if (kick > surge) surge = kick;
        surge *= Math.exp(-dt / 0.5);
        const surgeTwist = curTwist * (1 + (0.3 + 0.2 * smoothGlow) * surge);

        // --- INTEGRATED ROTATION CLOCK, constant angular velocity.
        // Bar-rational base speed (1 band/bar) off the SMOOTHED bpm and the
        // speed slider ONLY. beat.phase is NEVER read into the clock.
        const speedSlider = frame.params.speed ?? 1;
        const bandsPerBar = 1; // constant — no drop acceleration
        const beatsPerBar = frame.beat?.beatsPerBar ?? 4;
        const barsPerSec = beatRate / Math.max(1, beatsPerBar);
        const angularBands = Math.max(1, targetFamily.angularBands);
        let phaseRateTarget = 2 * Math.PI * bandsPerBar * barsPerSec * speedSlider;
        // PHOTOSAFETY CAP: full-field alternations/sec at a fixed point =
        // angularBands * phaseRate / (2*pi). Cap below FLICKER_CAP_HZ.
        const maxPhaseRate = (2 * Math.PI * FLICKER_CAP_HZ) / angularBands;
        if (phaseRateTarget > maxPhaseRate) phaseRateTarget = maxPhaseRate;
        // EASED CORRECTION (tau = 0.30 s >= 250 ms): the velocity glides to a
        // new target (family swap changing the cap, bpm drift, slider move)
        // instead of stepping — no per-frame phase discontinuity.
        const easeAlpha = 1 - Math.exp(-dt / 0.3);
        if (phaseRateCur === 0) phaseRateCur = phaseRateTarget; // seed
        phaseRateCur += (phaseRateTarget - phaseRateCur) * easeAlpha;
        phase += dt * phaseRateCur;

        // --- Inward zoom pulse (kick yanks r inward). CONSTANT drift base off
        // the smoothed bpm; the kick contribution rides the elastic surge (an
        // envelope that returns to zero), so it's a bounded transient, not a
        // sustained clock jump. Eased the same >=250 ms; flicker-capped.
        const zoomBase = 0.15 * barsPerSec * speedSlider;
        const kickZoom = 0.6 * surge;
        let zoomRateTarget = zoomBase + kickZoom * beatRate * 0.1;
        const ringFreq = Math.max(1, targetFamily.ringSweep ? curTwist : 0);
        if (ringFreq > 0) {
          const maxZoomRate = FLICKER_CAP_HZ / ringFreq;
          if (zoomRateTarget > maxZoomRate) zoomRateTarget = maxZoomRate;
        }
        if (zoomRateCur === 0) zoomRateCur = zoomRateTarget; // seed
        zoomRateCur += (zoomRateTarget - zoomRateCur) * easeAlpha;
        zoomPhase += dt * zoomRateCur;

        // --- Bass contrast depth.
        const contrastSlider = frame.params.contrast ?? 1;
        const contrast = contrastSlider * (0.35 + 1.1 * frame.bands.low + 0.5 * smoothGlow);

        // --- Glow amount.
        const glowSlider = frame.params.glow ?? 1;
        const glow = Math.min(1.6, smoothGlow * glowSlider);

        const snareEdge = Math.min(1, frame.impulse.mid * 0.7 + frame.impulse.high * 0.5);
        const soft = frame.params.softness ?? 0.35;

        // --- GEN-9 SPECTRAL COLORS.
        // band-A hue center = slow centroid; band-B = its complement (0.5
        // turn); per-bar offset added to both. Saturation = (1 - flatness).
        const palA = slowCentroid + barOffset;
        const palB = slowCentroid + 0.5 + barOffset;
        const sat = Math.min(1, Math.max(0.25, 1 - slowFlatness));

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
          u_snareEdge: snareEdge,
          u_glow: glow,
          u_sustain: sustained,
          u_bass: frame.bands.low,
          u_palA: palA,
          u_palB: palB,
          u_swap: swap,
          u_sat: sat,
          u_wash: 1,
        };
      },
    });
  },
};

export default g09HypnoGlidePreset;
