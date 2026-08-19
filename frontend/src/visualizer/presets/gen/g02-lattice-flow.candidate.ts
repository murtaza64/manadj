/**
 * "g02 lattice-flow" (gen candidate g02-lattice-flow). TWEAK of
 * g01-strobe-lattice, fixing the human's two notes: "a little less nausea,
 * more responsiveness to phrase/eq?".
 *
 * (1) LESS NAUSEA. The camera no longer swims: the feedback SAMPLING is
 *     steady — no rotation of u_prev, only a gentle radial kick shove that
 *     springs back — so ghost trails no longer spiral. Only the DRAWN
 *     lattice quarter-turns, and that turn now eases over ~0.3s instead of
 *     snapping. The full-field beat FLASH is gone; the beat now lights
 *     LOCALIZED node pulses (a soft ring of brightened nodes travelling
 *     out from center) rather than washing the whole frame. Ghost-warp
 *     spin is removed entirely.
 *
 * (2) RESPONSIVENESS. Two live couplings:
 *     - PHRASE topology: the wiring is rewired every 4 bars, seeded by the
 *       phrase index (hash → a blend across the tri/hex/rhombic bases). No
 *       longer a marching 0→1→2 cycle; each phrase draws a distinct grid,
 *       eased in over ~0.5s.
 *     - DECK EQ: the lattice's three strut families are tied to the
 *       dominant deck's EQ knobs (frame.decks, highest level). Axis-X
 *       struts ride eq.low, axis-Y struts ride eq.mid, the diagonal family
 *       rides eq.high — killing a band (knob to 0) visibly DELETES its
 *       strut family; boosting it thickens and brightens it. Nodes stay
 *       (they are the skeleton); struts are the EQ-driven flesh.
 *
 * BPM still paces motion. Kicks (impulse.low) shove nodes radially. Highs
 * (impulse.high) shimmer strut edges. Section boundaries still invert +
 * fire a shockwave (kept — the human liked the theatre), but the inversion
 * no longer reverses winding (that added to the swim).
 *
 * Gridless fallback (frame.beat null): free-run on the bass, as g01. EQ
 * couplings fall back to flat (0.5) when no deck state is present.
 * Absolute barIndex can be negative; tier positions use ((x % n) + n) % n.
 */

import { energyOf, energyHue } from '../../style';
import type { BeatInfo, DeckStateInfo } from '../../channel';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;      // impulse.low: radial lattice shove
uniform float u_shimmer;   // impulse.high: strut edge sparkle
uniform float u_energy;    // overall loudness -> brightness
uniform float u_hue;       // energy-swept base hue, degrees
uniform float u_pulse;     // beat pulse envelope, 0..1 (localized rings)
uniform float u_beatPhase; // 0..1 across the beat (ring travel + anticipation)
uniform float u_spin;      // eased bar quarter-turn angle of the DRAWN lattice
uniform float u_wiring;    // blended basis position 0..2 (phrase topology)
uniform float u_invert;    // 0 normal .. 1 fully inverted (section)
uniform float u_shock;     // section shockwave envelope, 0..1
uniform float u_decay;     // feedback persistence (ghost trails)
uniform float u_scale;     // lattice cell density
uniform float u_eqLow;     // dominant deck eq.low knob (0..1) -> axis-X struts
uniform float u_eqMid;     // dominant deck eq.mid knob (0..1) -> axis-Y struts
uniform float u_eqHigh;    // dominant deck eq.high knob (0..1) -> diagonal struts

vec3 hsl2rgb(float h, float s, float l) {
  h = fract(h / 360.0);
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  rgb = rgb * rgb * (3.0 - 2.0 * rgb);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  return (rgb - 0.5) * c + l;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

// Skew a plane point into one of three lattice bases; the phrase blends
// BETWEEN them (u_wiring in 0..2), rewiring the grid's topology live.
vec2 latticeBasis(vec2 p, float wiring) {
  vec2 tri = vec2(p.x + p.y * 0.5, p.y * 0.8660254);
  vec2 hex = vec2(p.x + 0.5 * floor(p.y + 0.5), p.y);
  vec2 rho = vec2(p.x + p.y, p.x - p.y) * 0.7071068;
  vec2 a = mix(tri, hex, clamp(wiring, 0.0, 1.0));
  return mix(a, rho, clamp(wiring - 1.0, 0.0, 1.0));
}

// Distance to the nearest lattice NODE and the three STRUT FAMILIES in a
// given basis cell. Returns node glow (.x) and per-family strut glow
// (.y = axis-X, .z = axis-Y, .w = diagonal) so EQ can gate each family.
vec4 lattice(vec2 uv, float wiring, float shimmerJitter) {
  vec2 g = latticeBasis(uv, wiring);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;

  float wob = (hash(cell) - 0.5) * 0.12 * shimmerJitter;
  float nodeD = length(f) + wob;
  float node = exp(-nodeD * nodeD * 34.0);

  // Three independent strut families (EQ deletes/boosts each).
  float sx = exp(-abs(f.y) * 40.0) * smoothstep(0.5, 0.35, abs(f.x)); // axis-X
  float sy = exp(-abs(f.x) * 40.0) * smoothstep(0.5, 0.35, abs(f.y)); // axis-Y
  float sd = exp(-abs(f.x - f.y) * 44.0) * smoothstep(0.5, 0.3, abs(f.x + f.y)); // diagonal

  return vec4(node, sx, sy, sd);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Feedback warp: STEADY camera. No rotation of the sampled field
  // (that was the swim). Only a small radial kick shove that springs back,
  // so ghost trails breathe in/out instead of spiralling.
  float kickPush = u_kick * 0.045 * (0.5 + 0.5 * u_energy);
  vec2 warp = c - dir * kickPush;
  vec2 src = warp / vec2(aspect, 1.0) + 0.5;
  vec3 ghost = texture2D(u_prev, src).rgb * u_decay;

  // ---- Fresh lattice, drawn in the EASED-turn frame (only the drawing
  // rotates, not the sampling). Slow scroll for life, no dizziness.
  vec2 lp = rot(c, u_spin);
  lp += dir * u_kick * 0.07;
  lp += vec2(0.0, u_time * 0.012);
  vec2 grid = lp * u_scale;

  vec4 ns = lattice(grid, u_wiring, u_shimmer);
  float node = ns.x;

  // EQ gates each strut family: knob at 0 deletes it, 0.5 flat, 1.0 boosts.
  float gainX = smoothstep(0.02, 0.5, u_eqLow) * (0.6 + 1.4 * u_eqLow);
  float gainY = smoothstep(0.02, 0.5, u_eqMid) * (0.6 + 1.4 * u_eqMid);
  float gainD = smoothstep(0.02, 0.5, u_eqHigh) * (0.6 + 1.4 * u_eqHigh);
  float strutX = ns.y * gainX;
  float strutY = ns.z * gainY;
  float strutD = ns.w * gainD;
  float strut = strutX + strutY + strutD;

  // LOCALIZED beat pulse: a soft ring of brightened nodes travelling out
  // from center on the beat — no full-field flash.
  float ringR = fract(u_beatPhase) * 1.15;
  float ring = exp(-pow((r - ringR) * 5.0, 2.0)) * u_pulse;
  float shimmerLift = 1.2 * u_shimmer * u_high;

  float nodeLit = node * (0.45 + 1.4 * ring + 0.8 * u_energy);
  float strutLit = strut * (0.30 + 0.9 * ring + shimmerLift);

  // Anticipation: a faint pre-swell of nodes over the last of the beat.
  float antic = smoothstep(0.75, 1.0, u_beatPhase);
  nodeLit += node * antic * 0.35;

  // Colour: nodes on the base hue; each strut FAMILY carries a band-like
  // hue offset so a soloed EQ band reads as its own colour.
  vec3 nodeCol = hsl2rgb(u_hue, 1.0, 0.55) * nodeLit;
  vec3 strutColX = hsl2rgb(u_hue + 0.0, 1.0, 0.55) * (strutX * (0.30 + 0.9 * ring + shimmerLift));
  vec3 strutColY = hsl2rgb(u_hue + 45.0, 1.0, 0.55) * (strutY * (0.30 + 0.9 * ring + shimmerLift));
  vec3 strutColD = hsl2rgb(u_hue + 90.0, 1.0, 0.60) * (strutD * (0.30 + 0.9 * ring + shimmerLift));
  vec3 fresh = nodeCol + strutColX + strutColY + strutColD;

  // Section shockwave: a white ring sweeping out on the 16-bar rollover.
  float shockR = u_shock * 1.1;
  float shockRing = exp(-pow((r - shockR) * 7.0, 2.0)) * u_shock;
  fresh += vec3(1.0) * shockRing * 1.3;

  vec3 col = ghost + fresh * (0.65 + 0.75 * u_energy);

  // Section INVERSION: negate toward the swept-hue midpoint. Chroma-
  // preserving-ish; winding is NOT reversed (that added to the nausea).
  vec3 mid = hsl2rgb(u_hue, 0.6, 0.5);
  vec3 inverted = 2.0 * mid - col;
  col = mix(col, inverted, u_invert);

  // Soft-knee highlight roll-off (chroma-preserving, never per-channel).
  float m = max(col.r, max(col.g, col.b));
  float knee = 0.75;
  if (m > knee) {
    float over = m - knee;
    float compressed = knee + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
    col *= compressed / m;
  }

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** Ease a value toward a target with a frame-rate-independent one-pole. */
function approach(current: number, target: number, tau: number, dt: number): number {
  const alpha = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-4, tau));
  return current + (target - current) * alpha;
}

/** Non-negative modulo (absolute bar index can be negative). */
function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/** Deterministic 0..1 hash of an integer (phrase-seeded wiring). */
function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Dominant audible deck = highest Master-audible level (EQ source). */
function dominantDeck(decks: DeckStateInfo[]): DeckStateInfo | null {
  let best: DeckStateInfo | null = null;
  for (const d of decks) {
    if (!best || d.level > best.level) best = d;
  }
  return best;
}

const g02LatticeFlowPreset: VisualizerPreset = {
  id: 'g02-lattice-flow',
  name: 'g02 lattice-flow',
  hiRes: true,
  params: [
    { id: 'density', label: 'lattice density', min: 3, max: 16, step: 0.5, default: 7 },
    { id: 'trails', label: 'ghost trails', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'pulse', label: 'beat pulse', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let turnTarget = 0;
    let turnAngle = 0;
    let prevBar: number | null = null;
    let prevPhrase: number | null = null;
    let wiringTarget = 0;
    let wiring = 0;
    let invertTarget = 0;
    let invert = 0;
    let shock = 0;
    let pulse = 0;
    // Eased EQ gates (avoid strut families popping when a knob snaps).
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    // Gridless free-run: a synthetic beat phase advanced by bass energy.
    let freePhase = 0;
    let freeBar = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const hue = energyHue(energy, (frame.centroid - 0.5) * 60);
        const beat: BeatInfo | null = frame.beat;

        const bpm = beat?.bpm ?? 120;
        const beatsPerSec = bpm / 60;

        let beatPhase: number;
        let barIndex: number;
        const beatsPerBar = beat?.beatsPerBar ?? 4;

        if (beat) {
          beatPhase = beat.phase;
          barIndex = beat.barIndex;
        } else {
          const drive = beatsPerSec * (0.6 + 0.8 * frame.bands.low);
          freePhase += dt * drive;
          while (freePhase >= 1) {
            freePhase -= 1;
            freeBar += 1 / beatsPerBar;
          }
          beatPhase = freePhase;
          barIndex = Math.floor(freeBar);
        }

        // Localized beat pulse envelope (fast attack on the beat, decay).
        const pulseGain = frame.params.pulse ?? 1;
        const beatEnv = Math.pow(1 - beatPhase, 3);
        pulse = approach(
          pulse,
          Math.min(1, (beatEnv + 1.2 * frame.impulse.low) * pulseGain),
          0.05,
          dt
        );

        // Bar rollover: ease a quarter-turn of the DRAWN lattice (~0.3s).
        if (prevBar !== null && barIndex !== prevBar) {
          turnTarget += Math.PI / 2;
          if (mod(barIndex, 16) === 0) {
            invertTarget = invertTarget > 0.5 ? 0 : 1;
            shock = 1;
          }
        }
        prevBar = barIndex;

        // Phrase rollover (every 4 bars): rewire, seeded by phrase index.
        const phrase = Math.floor(barIndex / 4);
        if (prevPhrase === null || phrase !== prevPhrase) {
          // Distinct blended basis position per phrase; not a marching cycle.
          wiringTarget = hash1(phrase) * 2;
          prevPhrase = phrase;
        }

        turnAngle = approach(turnAngle, turnTarget, 0.13, dt);
        wiring = approach(wiring, wiringTarget, 0.5, dt);
        invert = approach(invert, invertTarget, 0.4, dt);
        shock = Math.max(0, shock - dt * 1.3);

        // Dominant deck EQ → strut families (eased). Flat (0.5) fallback.
        const dom = dominantDeck(frame.decks);
        const targetLow = dom ? dom.eq.low : 0.5;
        const targetMid = dom ? dom.eq.mid : 0.5;
        const targetHigh = dom ? dom.eq.high : 0.5;
        eqLow = approach(eqLow, targetLow, 0.12, dt);
        eqMid = approach(eqMid, targetMid, 0.12, dt);
        eqHigh = approach(eqHigh, targetHigh, 0.12, dt);

        const trails = frame.params.trails ?? 1;
        const decay = Math.min(0.985, 1 - (0.09 + 0.05 * energy) / trails);
        const density = frame.params.density ?? 7;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_shimmer: frame.impulse.high,
          u_energy: energy,
          u_hue: hue,
          u_pulse: pulse,
          u_beatPhase: beatPhase,
          u_spin: turnAngle,
          u_wiring: wiring,
          u_invert: invert,
          u_shock: shock,
          u_decay: decay,
          u_scale: density,
          u_eqLow: eqLow,
          u_eqMid: eqMid,
          u_eqHigh: eqHigh,
        };
      },
    });
  },
};

export default g02LatticeFlowPreset;
