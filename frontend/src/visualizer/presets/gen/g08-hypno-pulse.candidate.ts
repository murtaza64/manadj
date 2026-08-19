/**
 * "g08 hypno pulse" (genetic arena g08, tweak of g07-hypno — note-driven).
 *
 * PARENT: g07-hypno (a FLAT analytic hypnotic-pattern engine ported from
 * spiral-vr/generate.py — polar field bands, MULTIPLIED layers, analytic
 * antialiasing, Nyquist gray-out; the rotation phase advances with the beat
 * so the spiral BREATHES with the groove). This file copies that engine
 * wholesale and re-wires its dynamics per the human's verbatim note:
 *
 *   "changing speed based on energy is jarring, keep speed relatively
 *    consistent and modulate some other param with energy (maybe glow?) or
 *    smoothed. i like the phase changes, maybe add palette changes as a more
 *    frequent bpm-aligned movement? and maybe color switching (a<->b) on
 *    beat?"
 *
 * WHAT CHANGED FROM g07 (everything else is the parent, verbatim):
 *  (1) ROTATION SPEED IS CONSTANT. The phase clock is bar-rational and
 *      bpm-scaled ONLY — energy/drop NO LONGER touch it (g07 forced the
 *      fastest rational + 2 bands/bar on drops; that read as jarring). The
 *      pattern advances exactly 1 band per bar at every family, always.
 *  (2) ENERGY/DROP -> GLOW. max(drop, energy) (smoothed ~0.35 s) drives a
 *      new u_glow: band bloom (brighten toward the band color, blooming the
 *      bright bands) + edge luminosity (band boundaries light up). Loudness
 *      lift no longer speeds the eye; it makes the pattern GLOW.
 *  (3) PALETTE STEPS PER BAR. A genome sequence of two-color pairs HARD-STEPS
 *      to the next pair on every bar rollover (bpm-aligned, no interpolation)
 *      — the "more frequent bpm-aligned movement" the human asked for. The
 *      pair endpoints are chosen equal-luminance (see below) and drawn from a
 *      fixed bright/saturated sequence; section still rotates the sequence
 *      offset so a section change re-shuffles which pairs come up.
 *  (4) A/B SWAP ON BEAT. On every whole beat the two band colors (A<->B) swap
 *      instantly (u_swap toggles 0/1, sampled off beat.beatInBar changing).
 *      PHOTOSAFETY: the swap is a pure CHROMA exchange, not a luminance flash.
 *      The two endpoints of every pair are forced to EQUAL luminance (Rec.601
 *      luma equalized in bandColor), so swapping A<->B changes hue at each
 *      pixel but leaves the full-field luma integral unchanged — there is no
 *      luminance alternation to count against the WCAG floor. Bands are also
 *      spatially interleaved (half the field is near A, half near B at any
 *      instant), so even locally the mean luma is swap-invariant.
 *  (5) The phase changes / family morphs the human liked are KEPT verbatim
 *      (phrase drift, section family swap, anticipation). Kick = twist surge
 *      stays (twist, not speed — photosafe, doesn't touch the clock).
 *
 * PHOTOSAFETY MACHINERY (kept intact from g07):
 *  - Flicker cap: the JS clock caps dPhase/dt so angularBands*speed/(2pi) and
 *    ring-sweep zoom both stay < FLICKER_CAP_HZ (< the WCAG 3/sec floor) at
 *    every family. With constant speed this is now trivially satisfied.
 *  - Analytic Nyquist gray-out: bands that collapse below pixel scale fade to
 *    the pair midpoint gray (kills center + fastest-band shimmer).
 *  - No black/white pairs, no saturated-red pairs; equal-luminance endpoints.
 *
 * Assigned tech: beat phase + bpm (primary), impulses, bands.low, ladder
 * tiers (bar/phrase/section), trend split.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks in this string. Everything is analytic — no loops that depend
// on uniforms, no derivatives extension. The band frequency is computed from
// the polar coords directly (|grad(base)| = layerMag / r, per-pixel scaled).
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_phase;      // beat-locked rotation phase (radians), CONSTANT speed
uniform float u_zoomPhase;  // beat-locked inward zoom phase (log-r shift)
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
uniform float u_palA;       // per-bar palette pair: endpoint A hue phase (hard step)
uniform float u_palB;       // per-bar palette pair: endpoint B hue phase (hard step)
uniform float u_swap;       // A/B chroma swap on beat: 0 = A..B, 1 = B..A
uniform float u_wash;       // low-bass soft-wash lift (never plain)

// iq cosine palette — bright, saturated (this repo dislikes pastels). A hue
// phase argument travels so the two band colors are never black/white and
// span a wide phase.
vec3 pal(float t) {
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
}

// Rec.601 luma.
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Force a color to a TARGET luma while holding its hue/chroma direction as
// much as possible (scale toward/away from mid-gray about the target). This
// is what makes the A/B swap photosafe: both endpoints share one luma, so
// exchanging them is pure chroma, no full-field luminance flash.
vec3 setLuma(vec3 c, float target) {
  float l = luma(c);
  // Move c along the line toward gray of the SAME chroma so its luma == target.
  vec3 shifted = c + (target - l);
  return clamp(shifted, 0.0, 1.0);
}

// Two-color travelling pair for a band value v in [0,1]. Endpoints are the
// per-bar palette phases u_palA / u_palB (HARD-STEPPED each bar in JS). Both
// endpoints are luma-equalized to a common target so the beat swap is a pure
// chroma exchange (photosafe). u_swap exchanges which endpoint is A vs B.
vec3 bandColor(float v) {
  vec3 a = pal(u_palA);
  vec3 b = pal(u_palB);
  // Common luma target = mean of the two natural lumas (keeps both bright).
  float lt = 0.5 * (luma(a) + luma(b));
  a = setLuma(a, lt);
  b = setLuma(b, lt);
  // Beat swap: exchange endpoints (chroma only — lt is identical).
  vec3 lo = mix(a, b, u_swap);
  vec3 hi = mix(b, a, u_swap);
  return mix(lo, hi, v);
}

// One analytic band layer. base = (fu*arms)*u + (fv*twist)*v ; the band
// frequency fw = layerMag / r (world) scaled to per-pixel; amp fades the
// band to gray as fw approaches Nyquist (reference contrast envelope). rate
// selects rotation direction (counter-rotation for the double family).
// Returns the signed band value in [-1, 1] pre-amp, and writes amp out.
float layer(float u, float v, float r, float fuw, float fvw, float rot, float pxScale, out float amp) {
  float a = fuw;
  float b = fvw;
  float base = a * u + b * v;
  float layerMag = sqrt(a * a + b * b);
  // |grad(base)| in rad/px: world gradient magnitude (layerMag / r) times the
  // world-units-per-pixel scale. r is guarded away from 0 by the caller.
  float fw = layerMag / r * pxScale;
  float width = max(fw, max(u_soft, 1e-4));
  // Reference envelope: fade to gray where the period nears pixel scale.
  amp = clamp((2.4 - fw) / 1.5, 0.0, 1.0);
  return clamp(sin(base + rot) / width, -1.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // Inward zoom pulse: shift v = log(r) by the zoom phase (kick yanks it in).
  float r = max(length(p), 1e-4);
  float u = atan(p.y, p.x);
  float v = log(r) - u_zoomPhase;

  // World-units-per-pixel: y spans 2.0 over u_res.y pixels.
  float pxScale = 2.0 / u_res.y;

  float fuw = u_fu * u_arms;
  float fvw = u_fv * u_twist;

  // Layer 1 — spins with the phase unless mandala (static rays).
  float amp1;
  float rot1 = mix(u_phase, 0.0, u_mandala);
  float e1 = layer(u, v, r, fuw, fvw, rot1, pxScale, amp1);
  float band = e1 * amp1;
  float ampMin = amp1;

  // Layer 2 — the double / checker / mandala partner. Counter-rotates
  // (u_rate2 = -1) for the moire interference; MULTIPLIED into the field.
  if (u_mode2 > 0.5) {
    float amp2;
    float rot2 = u_phase * u_rate2;
    float e2 = layer(u, v, r, u_fu2 * u_arms, u_fv2 * u_twist, rot2, pxScale, amp2);
    band *= e2 * amp2;
    ampMin = min(ampMin, amp2);
  }

  // band is now in [-1, 1] (product of layers), map to [0, 1].
  float bv = band * 0.5 + 0.5;

  // Bass -> contrast depth: heavy bass drives ink-black vs blazing (push bv
  // toward the rails); low bass leaves a soft saturated wash (never plain).
  float c = u_contrast;
  float centered = (bv - 0.5) * (1.0 + 2.2 * c);
  bv = clamp(0.5 + centered, 0.0, 1.0);

  // Snare counter-phase edge shimmer: rides the band boundary (where bv~0.5),
  // mid/high gated. A localized modulation, not a full-field flash.
  float edge = 1.0 - abs(bv - 0.5) * 2.0;
  bv = clamp(bv + (edge * edge) * u_snareEdge * (band > 0.0 ? 0.18 : -0.18), 0.0, 1.0);

  vec3 col = bandColor(bv);

  // Where the geometry falls below Nyquist (center, or fastest bands) the amp
  // envelope has already flattened the layers toward zero contrast; blend the
  // remaining toward the pair midpoint gray so the center can't flicker.
  vec3 midGray = bandColor(0.5);
  col = mix(midGray, col, ampMin);

  // Low-bass soft wash: never let a quiet passage read as flat gray — lift a
  // gentle saturated wash so it stays coloured (taste: buildups alive, not
  // eerily still).
  col = mix(col, bandColor(0.5 + 0.35 * sin(u_time * 0.4)), (1.0 - u_bass) * u_wash * 0.25);

  // ENERGY/DROP -> GLOW (the note's ask). Two localized, hue-preserving glow
  // terms driven by u_glow = smoothed max(drop, energy):
  //   band bloom  — lift the bright bands (edge^0-weighted toward band peak),
  //                 blooming the pattern's crests without touching the clock.
  //   edge lumin. — the band boundaries (edge~1) light up as energy rises.
  // Both are gated by ampMin so sub-Nyquist regions stay gray (photosafe).
  float bloom = 0.55 * u_glow * (0.35 + 0.65 * u_sustain);
  float edgeLum = (edge * edge) * u_glow * 0.6;
  col += bandColor(bv) * bloom * ampMin;
  col += bandColor(0.85) * edgeLum * ampMin;

  // Base intensity: a fixed floor + gentle sustained lift (NOT speed). Drop no
  // longer speeds the eye; it glows via u_glow above.
  float lift = 0.68 + 0.35 * u_sustain;
  col *= lift;

  // Kick GLOW accent (was a bloom in g07): a solid inward brightening on the
  // twist surge, localized to the lit rings — not a full-field white flash.
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
// Each: fu/fv weights per layer, arms/twist defaults, whether a second
// counter-rotating/partner layer exists, and whether layer 1 is static
// (mandala). rate2 = -1 gives the double family its counter-rotation.
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

// arms/twist chosen so no family exceeds the flicker cap once the clock is
// bounded below. Reference defaults: spiral (4, 6), tunnel (0, 10),
// pinwheel (12, 0), double (4, 6), checker (8, 8), mandala (8, 8).
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

// --- Per-bar palette genome ---------------------------------------------
// A fixed sequence of two-color pairs (endpoint hue phases into pal()). The
// pattern HARD-STEPS to the next entry on every bar rollover (bpm-aligned).
// Values are just hue phases; bandColor() luma-equalizes the endpoints so the
// beat swap stays photosafe regardless of which pair is up. The pairs span a
// wide hue distance (bright/saturated, never near-white/near-black).
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

const g08HypnoPulsePreset: VisualizerPreset = {
  id: 'g08-hypno-pulse',
  name: 'g08 hypno pulse',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // Beat-locked clocks.
    let phase = 0;
    let zoomPhase = 0;
    // Regime smoothing (taste: ride max(drop, energy), ~0.35 s split).
    let smoothDrop = 0;
    let smoothBuildup = 0;
    // Energy -> glow, smoothed the same ~0.35 s (the note asked for smoothed).
    let smoothGlow = 0;
    // Kick twist surge with elastic recovery.
    let surge = 0;
    // Family selection + morph.
    let familyIndex = 0;
    let curArms = FAMILIES[0].arms;
    let curTwist = FAMILIES[0].twist;
    let lastSection = -1;
    // Per-bar palette stepping + per-beat A/B swap (integer state, no interp).
    let lastBar = -1;
    let paletteStep = 0;
    let paletteOffset = 0; // section rotates which pairs come up
    let lastBeatInBar = -1;
    let swap = 0; // 0/1 toggled each whole beat

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: false,
      uniforms: (frame: VisualizerFrameData) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const bpm = frame.beat?.bpm ?? 0;
        const beatRate = bpm > 0 ? bpm / 60 : 2; // beats/sec

        // --- Regime split (smoothed ~0.35 s). drop rides bass presence;
        // buildup is the bass-light excitement. Sustained rides energy.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, energy * 1.4);
        // GLOW driver: smoothed max(drop, energy) (the note's "maybe glow?").
        const glowTarget = Math.max(smoothDrop, sustained);
        smoothGlow += (glowTarget - smoothGlow) * rAlpha;
        const isDrop = smoothDrop > 0.45;

        // --- Section / phrase / bar tiers (ladder-correct with fallback).
        const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
        const section = Math.floor(barIndex / 16);
        const phraseBar = barIndex % 4;
        const barPhase = frame.beat?.barPhase ?? 0;

        // SECTION = family change (the phase change the human liked). A drop
        // FORCES the double family (topology only — NOT the clock speed).
        if (section !== lastSection && lastSection >= 0) {
          familyIndex = (familyIndex + 1) % FAMILIES.length;
          // Re-shuffle which palette pairs come up on the new section.
          paletteOffset = (paletteOffset + 3) % PALETTE_SEQ.length;
        }
        lastSection = section;
        const targetFamily = isDrop ? FAMILIES[DOUBLE_INDEX] : FAMILIES[familyIndex];

        // --- PALETTE STEPS PER BAR (bpm-aligned, hard step, no interpolation).
        // On every bar rollover advance the palette genome by one entry.
        if (barIndex !== lastBar) {
          if (lastBar >= 0) paletteStep = (paletteStep + 1) % PALETTE_SEQ.length;
          lastBar = barIndex;
        }
        const pair = PALETTE_SEQ[(paletteStep + paletteOffset) % PALETTE_SEQ.length];

        // --- A/B SWAP ON BEAT (instant chroma swap; photosafe — see shader).
        // beat.beatInBar is the whole-beat ordinal; when it changes a new beat
        // landed -> toggle the swap. Integer state, never interpolated.
        const beatInBar = frame.beat?.beatInBar ?? -1;
        if (beatInBar !== lastBeatInBar) {
          if (lastBeatInBar >= 0) swap = swap > 0.5 ? 0 : 1;
          lastBeatInBar = beatInBar;
        }

        // --- Phrase drift: arms/twist wander slowly within the family, then
        // ease toward the (possibly new) family's base. Anticipation on the
        // last phrase bar nudges twist up (tension) without flicker risk.
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
        // Elastic decay ~0.5 s (a spring-back feel).
        surge *= Math.exp(-dt / 0.5);
        // Twist surge: +30-50% at full kick (spiral tightens), added on top.
        // Note: this modulates TWIST (spatial density), not the clock speed.
        const surgeTwist = curTwist * (1 + (0.3 + 0.2 * smoothGlow) * surge);

        // --- Beat-locked rotation clock, CONSTANT speed, photosafety-capped.
        // Bar-rational base speed: advance EXACTLY 1 band per bar so the
        // pattern locks. Speed scales with bpm (per-bar) and the speed slider
        // ONLY — energy/drop DO NOT touch it (the note: speed was jarring).
        const speedSlider = frame.params.speed ?? 1;
        const bandsPerBar = 1; // constant — no drop acceleration
        const beatsPerBar = frame.beat?.beatsPerBar ?? 4;
        const barsPerSec = beatRate / Math.max(1, beatsPerBar);
        const angularBands = Math.max(1, targetFamily.angularBands);
        // Desired phase rate so 1 band sweeps a point per bar at bpm cadence.
        let phaseRate = 2 * Math.PI * bandsPerBar * barsPerSec * speedSlider;
        // PHOTOSAFETY CAP: full-field alternations/sec at a fixed point =
        // angularBands * phaseRate / (2*pi). Cap it below FLICKER_CAP_HZ.
        const maxPhaseRate = (2 * Math.PI * FLICKER_CAP_HZ) / angularBands;
        if (phaseRate > maxPhaseRate) phaseRate = maxPhaseRate;
        phase += dt * phaseRate;

        // --- Inward zoom pulse (kick yanks r inward). CONSTANT drift base;
        // its ring-sweep flicker = ringFreq * zoomRate / (2*pi). Cap the same.
        const zoomBase = 0.15 * barsPerSec * speedSlider; // gentle drift (log-r/sec)
        const kickZoom = 0.6 * surge; // impulse inward yank
        let zoomRate = zoomBase + kickZoom * beatRate * 0.1;
        const ringFreq = Math.max(1, targetFamily.ringSweep ? curTwist : 0);
        if (ringFreq > 0) {
          const maxZoomRate = FLICKER_CAP_HZ / ringFreq;
          if (zoomRate > maxZoomRate) zoomRate = maxZoomRate;
        }
        zoomPhase += dt * zoomRate;

        // --- Bass contrast depth. Heavy bass -> blazing/ink; low bass -> wash.
        const contrastSlider = frame.params.contrast ?? 1;
        const contrast =
          contrastSlider * (0.35 + 1.1 * frame.bands.low + 0.5 * smoothGlow);

        // --- Glow amount: smoothed max(drop, energy) scaled by the glow slider.
        const glowSlider = frame.params.glow ?? 1;
        const glow = Math.min(1.6, smoothGlow * glowSlider);

        // Snare edge shimmer (mid/high gated).
        const snareEdge = Math.min(1, frame.impulse.mid * 0.7 + frame.impulse.high * 0.5);

        // Softness slider.
        const soft = frame.params.softness ?? 0.35;

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
          u_palA: pair[0],
          u_palB: pair[1],
          u_swap: swap,
          u_wash: 1,
        };
      },
    });
  },
};

export default g08HypnoPulsePreset;
