/**
 * "g07 hypno" (genetic arena g07, novel — human ask: "spirals are also
 * cool, see hypnotic spiral work in ~/spiral-vr").
 *
 * A FLAT hypnotic-pattern engine ported from spiral-vr/generate.py's field
 * math, made MUSICAL: the rotation phase advances with the beat (bar-rational
 * speeds) so the spiral BREATHES with the groove instead of spinning free.
 * Not the tunnel family — no feedback, no depth illusion, no camera warp;
 * this is flat, analytic pattern hypnosis.
 *
 * Reference math (generate.py, ported to GLSL ES 1.0 here):
 *   polar coords u = atan2(y, x)  (wrapping angular)
 *                v = log(r)       (radial)
 *   a layer's field base = fu*arms*u + fv*twist*v
 *   drawn as a smooth square wave sin(base + rate*phase), layers MULTIPLIED.
 *   Analytic antialiasing: the local band frequency fw = |grad(base)| in
 *   rad/px. For flat polar coords |grad u| = |grad v| = 1/r in world units,
 *   so |grad(base)| = sqrt((fu*arms)^2 + (fv*twist)^2) / r, converted to
 *   per-pixel by the world-units-per-pixel scale (2/height). Band edge width
 *   = max(fw, soft); where fw exceeds ~Nyquist the amplitude fades to
 *   mid-gray (kills sub-pixel shimmer AND center flicker) — computed here
 *   from the polar coords, NO derivatives extension.
 *
 * Families (EFFECTS table): spiral (arms*u + twist*v), tunnel (rings only),
 * pinwheel (rays only), double (two counter-rotating spirals MULTIPLIED =
 * moire), checker (rays x rings), mandala (static rays, bands pulse through).
 *
 * REACTIVITY:
 *  - beat phase drives the rotation clock at a bar-rational speed (the
 *    pattern advances a whole number of bands per bar -> it locks, never
 *    slides). bpm scales the clock.
 *  - KICK = a twist SURGE (spiral tightens, twist +30-50%, elastic recovery)
 *    + an inward zoom pulse. Spacetime yanks, no flash.
 *  - SNARE = a counter-phase shimmer riding the band edges (mid/high gated).
 *  - BASS level = band contrast depth (heavy bass -> ink-black vs blazing;
 *    low bass -> soft saturated wash, never plain).
 *  - PHRASE = slow arms/twist drift within a family.
 *  - SECTION = family change staged as a visible re-twist + palette regime.
 *  - DROP = DOUBLE mode forced: counter-rotating moire at max contrast +
 *    fastest rational speed, riding max(drop, energy).
 *
 * PHOTOSAFETY (the central constraint for this preset): band flicker rate =
 * (spatial band count) * (angular/zoom speed) / (2*pi) full-field
 * alternations per second at any radius. The JS clock caps dPhase/dt so that
 * arms*speed/(2*pi) and ringFreq*zoomSpeed both stay < ~2.4 Hz (under the
 * WCAG 3 flashes/sec floor) at EVERY family/speed, including the forced-fast
 * drop. The analytic Nyquist gray-out removes center flicker where bands
 * collapse below pixel scale. Palettes are two-color travelling pairs, never
 * black/white, never a saturated-red pair.
 *
 * Assigned tech: beat phase + bpm (primary), impulses, bands.low, ladder
 * tiers (phrase/section), trend split.
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
uniform float u_phase;      // beat-locked rotation phase (radians), bar-rational
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
uniform float u_kick;       // impulse.low: twist surge + zoom pulse (JS-applied)
uniform float u_snareEdge;  // impulse.mid/high counter-phase edge shimmer
uniform float u_drop;       // max(drop, energy) intensity
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_bass;       // bands.low
uniform float u_paletteA;   // travelling two-color pair, endpoint A phase
uniform float u_paletteB;   // endpoint B phase
uniform float u_paletteMix; // section palette regime blend
uniform float u_wash;       // low-bass soft-wash lift (never plain)

// iq cosine palette — bright, saturated (this repo dislikes pastels). A hue
// phase argument travels so the two band colors are never black/white and
// span a wide phase.
vec3 pal(float t) {
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
}

// Two-color travelling pair for a band value v in [0,1]. Endpoints ride
// u_paletteA / u_paletteB (which drift over time + section), so the pair is
// always coloured and moving. A second regime blends in on section change.
vec3 bandColor(float v) {
  vec3 a0 = pal(u_paletteA);
  vec3 b0 = pal(u_paletteB);
  vec3 a1 = pal(u_paletteA + 0.5);
  vec3 b1 = pal(u_paletteB + 0.37);
  vec3 a = mix(a0, a1, u_paletteMix);
  vec3 b = mix(b0, b1, u_paletteMix);
  return mix(a, b, v);
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

  // Intensity: ride max(drop, energy); the drop's double-moire blazes.
  float lift = 0.62 + 0.85 * u_drop + 0.4 * u_sustain;
  col *= lift;
  // Kick core bloom: a solid inward brightening (localized to the swept-in
  // rings, not a full-field white flash).
  col += bandColor(bv) * u_kick * (0.25 + 0.5 * u_bass) * ampMin;

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
  { id: 'saturation', label: 'palette travel', min: 0.5, max: 2, step: 0.05, default: 1 },
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

const DOUBLE_INDEX = 1; // forced on drops

/** The hard flicker cap in full-field alternations/sec (WCAG floor is 3). */
const FLICKER_CAP_HZ = 2.4;

const g07HypnoPreset: VisualizerPreset = {
  id: 'g07-hypno',
  name: 'g07 hypno',
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
    // Kick twist surge with elastic recovery.
    let surge = 0;
    // Family selection + morph.
    let familyIndex = 0;
    let curArms = FAMILIES[0].arms;
    let curTwist = FAMILIES[0].twist;
    let paletteRegime = 0;
    let smoothRegime = 0;
    let lastSection = -1;

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
        const dropRide = Math.max(smoothDrop, sustained);
        const isDrop = smoothDrop > 0.45;

        // --- Section / phrase tiers (ladder-correct with fallback).
        const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
        const section = Math.floor(barIndex / 16);
        const phraseBar = barIndex % 4;
        const barPhase = frame.beat?.barPhase ?? 0;

        // SECTION = family change (staged palette + family swap). A drop
        // FORCES the double family (takes priority over the section cycle).
        if (section !== lastSection && lastSection >= 0) {
          familyIndex = (familyIndex + 1) % FAMILIES.length;
          paletteRegime = 1 - paletteRegime;
        }
        lastSection = section;
        const targetFamily = isDrop ? FAMILIES[DOUBLE_INDEX] : FAMILIES[familyIndex];

        // Palette regime blend eases over ~1.5 s (a visible re-twist).
        const regimeAlpha = 1 - Math.exp(-dt / 1.5);
        smoothRegime += (paletteRegime - smoothRegime) * regimeAlpha;

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
        const surgeTwist = curTwist * (1 + (0.3 + 0.2 * dropRide) * surge);

        // --- Beat-locked rotation clock, photosafety-capped.
        // Bar-rational base speed: advance a whole number of bands per bar so
        // the pattern locks. Speed scales with bpm (per-bar), the speed
        // slider, and the drop (fastest rational on drops).
        const speedSlider = frame.params.speed ?? 1;
        // Bands-per-bar target (rational): 1 normally, 2 on the drop.
        const bandsPerBar = isDrop ? 2 : 1;
        const beatsPerBar = frame.beat?.beatsPerBar ?? 4;
        // Angular speed of the phase clock (rad/sec) BEFORE the cap.
        // barsPerSec = beatRate / beatsPerBar; phase advances
        // 2*pi*bandsPerBar per bar / angularBands => whole bands per bar.
        const barsPerSec = beatRate / Math.max(1, beatsPerBar);
        const angularBands = Math.max(1, targetFamily.angularBands);
        // Desired phase rate so `angularBands` bands sweep a point at the
        // rational cadence. dPhase/dt (rad/sec):
        let phaseRate = 2 * Math.PI * bandsPerBar * barsPerSec * speedSlider;
        // PHOTOSAFETY CAP: full-field alternations/sec at a fixed point =
        // angularBands * phaseRate / (2*pi). Cap it below FLICKER_CAP_HZ.
        const maxPhaseRate = (2 * Math.PI * FLICKER_CAP_HZ) / angularBands;
        if (phaseRate > maxPhaseRate) phaseRate = maxPhaseRate;
        phase += dt * phaseRate;

        // --- Inward zoom pulse (kick yanks r inward). Zoom shifts v=log(r);
        // its ring-sweep flicker = ringFreq * zoomRate / (2*pi). Cap the same.
        // The ring band count near a point scales with twist; use curTwist.
        const zoomBase = 0.15 * barsPerSec * speedSlider; // gentle drift (log-r/sec)
        const kickZoom = 0.6 * surge; // impulse inward yank
        let zoomRate = zoomBase + kickZoom * beatRate * 0.1;
        // ring flicker cap: twist bands per unit v -> alternations/sec.
        const ringFreq = Math.max(1, targetFamily.ringSweep ? curTwist : 0);
        if (ringFreq > 0) {
          const maxZoomRate = FLICKER_CAP_HZ / ringFreq;
          if (zoomRate > maxZoomRate) zoomRate = maxZoomRate;
        }
        zoomPhase += dt * zoomRate;

        // --- Bass contrast depth. Heavy bass -> blazing/ink; low bass -> wash.
        const contrastSlider = frame.params.contrast ?? 1;
        const contrast =
          contrastSlider * (0.35 + 1.1 * frame.bands.low + 0.5 * dropRide);

        // --- Palette travel (two-color pair drifts; slider widens the span).
        const sat = frame.params.saturation ?? 1;
        const paletteA = (frame.time * 0.02 + smoothRegime * 0.4) * sat;
        const paletteB = paletteA + 0.4 + 0.15 * sat + 0.1 * frame.centroid;

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
          u_drop: dropRide,
          u_sustain: sustained,
          u_bass: frame.bands.low,
          u_paletteA: paletteA,
          u_paletteB: paletteB,
          u_paletteMix: smoothRegime,
          u_wash: 1,
        };
      },
    });
  },
};

export default g07HypnoPreset;
