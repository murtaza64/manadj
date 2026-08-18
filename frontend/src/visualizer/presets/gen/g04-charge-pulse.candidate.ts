/**
 * "g04 charge-pulse" (genetic arena g04): a TWEAK of g03-charge-bloom whose
 * one job is to ANSWER the music. The g03 pair note was "not very responsive
 * to music"; charge-pulse rebuilds the field as a LIVING VU METER.
 *
 * Same charge-field lineage (24 spectrum bins = Gaussian charges orbiting the
 * meter-locked center, summed potential + equipotential contours), but every
 * charge now has PUNCHY per-bin ballistics computed JS-side: instant attack
 * on a bin's onset, musical release afterward. So a hi-hat SNAPS its bin
 * bright and lets it fall; a sustained pad glows steady. The displayed bin
 * array is computed in JS before it reaches the shader — the GPU just draws.
 *
 * Musical answers (all gated on real signals, taste-calibrated):
 *   KICK       — whole-field COMPRESSION (constellation collapses to the core
 *                on impulse.low) + a SOLID white core flash (rate-limited);
 *   SNARE      — charge-scatter JOLT: mid impulse fans the charges outward
 *                in an angular jitter (the field shivers on the backbeat);
 *   DOWNBEAT   — orbit realignment SNAP: on each bar's downbeat the orbit
 *                phase kicks forward, a visible constellation re-lock;
 *   PHRASE     — orbit-radius REGIME change: every N bars the field switches
 *                between tight/mid/wide radius regimes (in-phrase evolution);
 *   DROP       — outward bloom explosion + glow ramp (dynamic range: quiet
 *                stays restrained, drops go maximal);
 *   BUILDUP    — orbits tighten + palette saturates (tense but alive);
 *   EQ KILL    — a deck killing a band drops those bins with a visible
 *                IMPLOSION: the killed charges snap inward as they fade.
 *
 * Assigned tech: 24-band spectrum (per-bin ballistics), beat/bar phase +
 * barIndex (meter lock, downbeat snap, phrase regimes), per-band impulse
 * (kick/snare), energy trend (drop/buildup), deck EQ, centroid, flatness.
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
uniform float u_snare;
uniform float u_flash;
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_flatness;
uniform float u_orbit;
uniform float u_scatter;
uniform float u_regime;
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

  // ---- Feedback advection for glow persistence. Kicks COMPRESS the field
  // inward (solid pull toward core); drops fling it outward into bloom;
  // buildups tighten orbits inward. One radial push, chroma-preserving.
  float outward = (0.032 * u_drop + 0.008 * u_sustain) * exp(-r * 0.9);
  float inward = (0.028 * u_kick + 0.014 * u_buildup) * exp(-r * 0.6);
  vec2 src = (c - dir * (outward - inward)) / vec2(aspect, 1.0) + 0.5;
  vec3 medium = texture2D(u_prev, src).rgb * u_decay;

  // ---- Orbit radius: phrase REGIME sets the base ring (tight/mid/wide);
  // buildups pull the constellation in, drops push it out, kick squeezes it.
  float ringR = u_regime * (1.0 + 0.55 * u_drop - 0.30 * u_buildup - 0.26 * u_kick);
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
    // SNARE SCATTER: a mid-band jolt fans each charge with a per-bin angular
    // jitter (the field shivers on the backbeat, never a kick effect).
    float spin = (mod(fi, 2.0) < 0.5 ? 1.0 : -1.0);
    float jitter = (hash(vec2(fi, 3.0)) - 0.5) * u_scatter * 1.4;
    float ang = (fi / 24.0) * TAU + spin * u_orbit + fi * 0.13 + q * 0.4 + jitter;
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

  // ---- Core well + KICK FLASH: a dim charged heart, whitening as a drop
  // ignites; u_flash is a rate-limited kick pop (solid white core flash).
  float heart = exp(-r * r * 90.0);
  medium += mix(vec3(0.25, 0.10, 0.30), vec3(1.0, 0.96, 0.9), min(1.0, 0.8 * u_drop + u_flash))
    * heart * (0.25 + 0.8 * u_low + 2.4 * u_drop + 0.9 * u_kick + 2.2 * u_flash);

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
  { id: 'persistence', label: 'glow persistence', min: 0.5, max: 2, step: 0.05, default: 1.1 },
  { id: 'orbitBars', label: 'orbit period (bars)', min: 1, max: 8, step: 1, default: 2 },
  { id: 'phraseBars', label: 'phrase regime length (bars)', min: 2, max: 16, step: 1, default: 4 },
  { id: 'punch', label: 'per-bin punch', min: 0, max: 2, step: 0.05, default: 1 },
];

/** Which spectrum bins count as "drop range" (low/sub bands a deck kills
 * with its low EQ). The first quarter of the 24 log-spaced bands. */
const DROP_BINS = Math.floor(CHARGE_COUNT / 4);
/** Mid/high boundary for EQ-kill routing across the 24 log-spaced bands. */
const MID_END = Math.floor((CHARGE_COUNT * 2) / 3);

/** Base ring radius per phrase regime (tight → mid → wide). The phrase tier
 * cycles these so the field's scale evolves across a track. */
const RADIUS_REGIMES = [0.24, 0.34, 0.44];

const g04ChargePulsePreset: VisualizerPreset = {
  id: 'g04-charge-pulse',
  name: 'g04 charge-pulse',
  hiRes: true,
  params,
  create: () => {
    const spectrum = new Float32Array(CHARGE_COUNT);
    // Per-bin punchy ballistics: instant attack, musical release. Each bin's
    // displayed level is an envelope that snaps UP to the raw level on an
    // onset and falls back exponentially — a living VU meter, computed here.
    const env = new Float32Array(CHARGE_COUNT);
    const prevRaw = new Float32Array(CHARGE_COUNT);
    const killEnv = new Float32Array(CHARGE_COUNT); // per-bin implosion state
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let orbit = 0;
    let scatter = 0;
    let flash = 0;
    let regime = RADIUS_REGIMES[1];
    let lastTime = 0;
    let lastBarPhase = 0;
    let lastBarIndex = -1;
    let lastPhraseSlot = -1;
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

        // ---- KICK FLASH: rate-limited so it never strobes (photosensitivity
        // floor). A kick pops the envelope to ~1, which then decays; the pop
        // only re-fires once the previous flash has fallen away.
        const kick = frame.impulse.low;
        const release = Math.exp(-dt / 0.14); // ~0.14 s musical fall
        flash *= release;
        if (kick > 0.45 && flash < 0.2) flash = Math.min(1, kick);

        // ---- SNARE SCATTER: mid-band onset jolt fans the charges; decays
        // fast so the field shivers then re-settles.
        const snare = Math.max(0, frame.impulse.mid - 0.5 * frame.impulse.low);
        scatter *= Math.exp(-dt / 0.18);
        if (snare > 0.35) scatter = Math.min(1, snare * 1.3);

        // ---- Deck EQ kills, resolved per band range. A deck pulling an EQ
        // knob down removes those bins with a visible IMPLOSION.
        let lowKill = 0;
        let midKill = 0;
        let highKill = 0;
        for (const deck of frame.decks) {
          if (!deck.playing || deck.level <= 0.02) continue;
          const audible = Math.min(1, deck.level * 1.5);
          const kLow = Math.max(0, (0.5 - deck.eq.low) / 0.5);
          const kMid = Math.max(0, (0.5 - deck.eq.mid) / 0.5);
          const kHigh = Math.max(0, (0.5 - deck.eq.high) / 0.5);
          lowKill = Math.max(lowKill, kLow * audible);
          midKill = Math.max(midKill, kMid * audible);
          highKill = Math.max(highKill, kHigh * audible);
        }

        // ---- Per-bin ballistics + EQ-kill implosion. The envelope snaps to
        // the raw level on a rising onset and releases; the kill envelope
        // ramps toward each band's kill depth and multiplies the charge, so
        // killed bins fade AND (via the shader ring pull) collapse inward.
        const punch = frame.params.punch ?? 1;
        const binRelease = Math.exp(-dt / (0.22 / Math.max(0.25, punch)));
        for (let i = 0; i < CHARGE_COUNT; i++) {
          const raw = frame.spectrum[i] ?? 0;
          const rising = raw - prevRaw[i];
          prevRaw[i] = raw;
          // Instant attack: jump straight to raw (plus onset overshoot),
          // otherwise release toward raw's floor.
          if (raw >= env[i] || rising > 0.04) {
            env[i] = Math.min(1.4, raw * (1 + 0.6 * punch * Math.max(0, rising * 6)));
          } else {
            env[i] = raw + (env[i] - raw) * binRelease;
          }
          const target =
            i < DROP_BINS ? lowKill : i < MID_END ? midKill : highKill;
          // Implosion tracks the kill target quickly on kill, recovers slower.
          const kAlpha = target > killEnv[i] ? 1 - Math.exp(-dt / 0.06) : 1 - Math.exp(-dt / 0.4);
          killEnv[i] += (target - killEnv[i]) * kAlpha;
          spectrum[i] = Math.min(1.4, env[i]) * (1 - killEnv[i]);
        }

        // ---- Meter-locked orbit with DOWNBEAT SNAP. Advance by whole bars;
        // on each new bar index, kick the orbit phase forward (a visible
        // realignment snap). Fall back to a free clock when no grid.
        const orbitBars = Math.max(1, Math.round(frame.params.orbitBars ?? 2));
        if (frame.beat) {
          let dPhase = frame.beat.barPhase - lastBarPhase;
          if (dPhase < -0.5) dPhase += 1; // wrapped past a downbeat
          if (dPhase < 0) dPhase = 0;
          lastBarPhase = frame.beat.barPhase;
          orbit += (dPhase / orbitBars) * 2 * Math.PI;

          // Downbeat snap: new bar → nudge the orbit forward once.
          if (frame.beat.barIndex !== lastBarIndex) {
            if (lastBarIndex >= 0) orbit += (Math.PI / 6) / orbitBars;
            lastBarIndex = frame.beat.barIndex;

            // ---- PHRASE regime change: every phraseBars bars, switch the
            // base ring radius regime (tight/mid/wide) for in-phrase scale
            // evolution and section-scale theatre.
            const phraseBars = Math.max(2, Math.round(frame.params.phraseBars ?? 4));
            const slot = Math.floor(frame.beat.barIndex / phraseBars);
            if (slot !== lastPhraseSlot) {
              lastPhraseSlot = slot;
              regime = RADIUS_REGIMES[Math.abs(slot) % RADIUS_REGIMES.length];
            }
          }
        } else {
          orbit += dt * (0.25 + 0.4 * frame.bands.mid);
        }

        const persistence = frame.params.persistence ?? 1.1;
        const baseDecay = 0.985 - 0.008 * energy;

        return {
          u_time: frame.time,
          u_spectrum: spectrum,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: snare,
          u_flash: flash,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: Math.min(1, energy * 1.4),
          u_centroid: frame.centroid,
          u_flatness: frame.flatness,
          u_orbit: orbit,
          u_scatter: scatter,
          u_regime: regime,
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

export default g04ChargePulsePreset;
