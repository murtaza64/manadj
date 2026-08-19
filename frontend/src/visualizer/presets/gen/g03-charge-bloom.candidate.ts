/**
 * "g03 charge-bloom" (genetic arena g03): a NOVEL preset in the Hodgin
 * Magnetosphere / charge-field lineage. The 24 geometric spectrum bins are
 * CHARGED PARTICLES: each bin is a Gaussian charge orbiting the center, its
 * charge magnitude = the bin's level. The whole constellation is phase-
 * locked to the METER — orbit period = whole bars (beat.barPhase drives the
 * orbit angle) so the field is beat-synchronized rather than free-running.
 *
 * The field is the summed potential of all 24 charges, rendered as additive
 * glow plus faint equipotential contour lines. Musical response:
 *   KICK      — solid inward field compression (the constellation collapses
 *               toward the core on impulse.low, then springs back);
 *   DROP      — outward bloom explosion: charges fling outward, glow ramps;
 *   BUILDUP   — orbits tighten inward + palette saturates (tension held
 *               alive, never eerily still);
 *   DECK EQ   — a deck killing its low EQ removes that band's DROP-range
 *               charges from the field (visible bins wink out);
 *   FLATNESS  — noisy/percussive material adds a fine grain shimmer.
 *
 * Assigned tech: 24-band spectrum, beat/bar phase (meter lock), per-band
 * impulse (kick), energy trend (drop/buildup split), deck EQ, flatness.
 * 24 in-shader Gaussian evaluations per pixel (GLSL ES 1.0 constant loop).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerPreset } from '../types';

const CHARGE_COUNT = 24;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_spectrum[24];
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_flatness;
uniform float u_orbit;
uniform float u_barPhase;
uniform float u_decay;
uniform float u_glow;
uniform float u_lines;
uniform float u_palette;
uniform float u_seed;

const float TAU = 6.28318530718;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Wide-phase-span palette so the field's color is free to travel while
// shape carries band identity (chroma-preserving downstream).
vec3 palette(float t) {
  vec3 a; vec3 b; vec3 cf; vec3 d;
  if (u_palette < 0.5) {
    a = vec3(0.20, 0.08, 0.35); b = vec3(0.65, 0.45, 0.55);
    cf = vec3(1.0, 1.1, 0.9); d = vec3(0.0, 0.25, 0.55);
  } else if (u_palette < 1.5) {
    a = vec3(0.05, 0.25, 0.30); b = vec3(0.45, 0.65, 0.55);
    cf = vec3(1.0, 0.9, 1.1); d = vec3(0.15, 0.35, 0.7);
  } else {
    a = vec3(0.35, 0.10, 0.10); b = vec3(0.6, 0.4, 0.3);
    cf = vec3(0.9, 1.0, 1.15); d = vec3(0.0, 0.15, 0.35);
  }
  return a + b * cos(TAU * (cf * t + d));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Feedback advection for glow persistence. Kicks compress the field
  // inward (solid pull toward core); drops fling it outward into bloom;
  // buildups tighten orbits inward. One radial push, chroma-preserving.
  float outward = (0.030 * u_drop + 0.008 * u_sustain) * exp(-r * 0.9);
  float inward = (0.020 * u_kick + 0.014 * u_buildup) * exp(-r * 0.6);
  vec2 src = (c - dir * (outward - inward)) / vec2(aspect, 1.0) + 0.5;
  vec3 medium = texture2D(u_prev, src).rgb * u_decay;

  // ---- Orbit radius: buildups pull the constellation in (tighter orbits),
  // drops push it out (bloom explosion). Kick adds a solid inward squeeze.
  float ringR = 0.34 * (1.0 + 0.55 * u_drop - 0.30 * u_buildup - 0.22 * u_kick);
  ringR = max(0.05, ringR);

  // ---- Summed potential of 24 orbiting charges. Each bin sits at an angle
  // fanned around the circle, spun by the meter-locked orbit phase; low bins
  // orbit the inner ring, high bins the outer, so band identity is spatial.
  float field = 0.0;      // additive glow potential
  float potential = 0.0;  // scalar potential for equipotential contours
  vec3 tint = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float q = u_spectrum[i];
    // Radius spreads by band index; charge pushes it slightly outward.
    float rad = ringR * (0.45 + 0.75 * (fi / 23.0)) * (1.0 + 0.18 * q);
    // Meter-locked orbit: whole-bar period. Alternate bins counter-rotate
    // for a woven constellation; charge speeds a bin's own precession.
    float spin = (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0);
    float ang = (fi / 24.0) * TAU + spin * u_orbit + fi * 0.13 + q * 0.4;
    vec2 pos = vec2(cos(ang), sin(ang)) * rad;
    vec2 delta = c - pos;
    float d2 = dot(delta, delta);
    // Gaussian charge; buildup sharpens it (tenser, brighter cores).
    float sigma = 0.0016 + 0.0060 * (1.0 - 0.5 * u_buildup);
    float g = exp(-d2 / sigma);
    float mag = q * q * (0.6 + 1.4 * q);
    field += g * mag;
    // Soft 1/(r^2) potential well for the contour lines.
    potential += mag * 0.0009 / (d2 + 0.0009);
    // Color travels with band index + centroid; each charge tints locally.
    tint += palette(fi / 24.0 * 0.9 + u_centroid * 0.35 + u_time * 0.02)
      * g * mag;
  }

  // ---- Additive glow from the summed field. Drop ramps the whole field;
  // buildup saturates by pushing the palette color harder.
  vec3 glowCol = (field > 1e-4 ? tint / max(field, 1e-4) : palette(u_centroid));
  float sat = 1.0 + 0.6 * u_buildup;
  glowCol = mix(vec3(dot(glowCol, vec3(0.33))), glowCol, sat);
  medium += glowCol * field * u_glow * (1.0 + 1.8 * u_drop + 0.5 * u_sustain);

  // ---- Faint equipotential lines: thin bright bands where the summed
  // potential crosses integer levels — the field's "magnetic contour".
  float levels = 7.0;
  float band = fract(potential * levels);
  float contour = smoothstep(0.5, 0.0, abs(band - 0.5) * 2.0);
  contour = pow(contour, 6.0);
  medium += palette(u_centroid * 0.5 + 0.2) * contour * u_lines
    * (0.06 + 0.20 * u_mid) * smoothstep(0.02, 0.5, potential);

  // ---- Core well: a dim charged heart, whitening as a drop ignites.
  float heart = exp(-r * r * 90.0);
  medium += mix(vec3(0.25, 0.10, 0.30), vec3(1.0, 0.96, 0.9), 0.8 * u_drop)
    * heart * (0.25 + 0.8 * u_low + 2.4 * u_drop + 0.9 * u_kick);

  // ---- Flatness grain shimmer: noisy/percussive material dusts the field
  // with fine sparkle (mid/high-only, never a kick effect).
  float grain = hash(gl_FragCoord.xy * 1.7 + u_seed);
  float sparkle = step(0.985 - 0.03 * u_flatness, grain);
  medium += palette(0.6 + u_high * 0.3) * sparkle * u_flatness
    * (0.15 + 0.9 * u_high) * smoothstep(0.05, 0.4, r);

  // ---- Chroma-preserving soft knee (scale all channels by one factor so
  // hues hold; never per-channel clamp). Drop lifts the ceiling.
  medium *= 0.9 + 0.5 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(medium.r, max(medium.g, medium.b));
  if (m > 0.82) {
    medium *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(medium, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'glow', label: 'field glow', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'lines', label: 'equipotential lines', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'palette', label: 'palette 0-2 (violet/teal/ember)', min: 0, max: 2, step: 1, default: 0 },
  { id: 'persistence', label: 'glow persistence', min: 0.5, max: 2, step: 0.05, default: 1.2 },
  { id: 'orbitBars', label: 'orbit period (bars)', min: 1, max: 8, step: 1, default: 2 },
];

/** Which spectrum bins count as "drop range" (low/sub bands a deck kills
 * with its low EQ). The first quarter of the 24 log-spaced bands. */
const DROP_BINS = Math.floor(CHARGE_COUNT / 4);

const g03ChargeBloomPreset: VisualizerPreset = {
  id: 'g03-charge-bloom',
  name: 'g03 charge-bloom',
  hiRes: true,
  params,
  create: () => {
    const spectrum = new Float32Array(CHARGE_COUNT);
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let orbit = 0;
    let lastTime = 0;
    let lastBarPhase = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;

        // Deck EQ kill: if any audible deck has pulled its low EQ down,
        // fade out the drop-range (low) charges by that deck's kill depth,
        // scaled by how audible the deck is.
        let lowKill = 0;
        for (const deck of frame.decks) {
          if (!deck.playing || deck.level <= 0.02) continue;
          const kill = Math.max(0, (0.5 - deck.eq.low) / 0.5); // 1 when fully killed
          lowKill = Math.max(lowKill, kill * Math.min(1, deck.level * 1.5));
        }

        // Charge magnitudes = bin levels, drop bins attenuated by EQ kill.
        for (let i = 0; i < CHARGE_COUNT; i++) {
          const level = frame.spectrum[i] ?? 0;
          const kill = i < DROP_BINS ? 1 - lowKill : 1;
          spectrum[i] = level * kill;
        }

        // Meter-locked orbit: advance by whole bars (beat.barPhase), so the
        // constellation completes one revolution every `orbitBars` bars.
        // Fall back to a free clock when no gridded deck is audible.
        const orbitBars = Math.max(1, Math.round(frame.params.orbitBars ?? 2));
        if (frame.beat) {
          let dPhase = frame.beat.barPhase - lastBarPhase;
          if (dPhase < -0.5) dPhase += 1; // wrapped past a downbeat
          if (dPhase < 0) dPhase = 0;
          lastBarPhase = frame.beat.barPhase;
          orbit += (dPhase / orbitBars) * 2 * Math.PI;
        } else {
          orbit += dt * (0.25 + 0.4 * frame.bands.mid);
        }

        const persistence = frame.params.persistence ?? 1.2;
        const baseDecay = 0.985 - 0.008 * energy;

        return {
          u_time: frame.time,
          u_spectrum: spectrum,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: Math.min(1, energy * 1.4),
          u_centroid: frame.centroid,
          u_flatness: frame.flatness,
          u_orbit: orbit,
          u_barPhase: frame.beat ? frame.beat.barPhase : 0,
          u_decay: Math.min(0.996, 1 - (1 - baseDecay) / persistence),
          u_glow: frame.params.glow ?? 1,
          u_lines: frame.params.lines ?? 1,
          u_palette: frame.params.palette ?? 0,
          u_seed: Math.floor(frame.time * 24) % 1000,
        };
      },
    });
  },
};

export default g03ChargeBloomPreset;
