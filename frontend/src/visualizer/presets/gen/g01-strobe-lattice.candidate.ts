/**
 * "g01 strobe-lattice" (gen candidate g01-strobe-lattice). NOVEL, GL
 * feedback. A sparse geometric lattice — a triangular/hex grid of glowing
 * nodes and struts — that STROBES its structure on the beat and climbs the
 * full metric ladder made visible:
 *
 *   beat            → the whole lattice FLASHES (nodes + struts light up)
 *   bar downbeat    → the lattice QUARTER-TURNS (90° snap, eased in JS)
 *   4-bar phrase    → topology REWIRES: the grid morphs tri ↔ hex ↔ rhombic
 *                     (a discrete wiring index the shader interpolates)
 *   16-bar section  → the field INVERTS: colors negate, winding reverses,
 *                     a white shock sweeps out from center
 *
 * BPM scales every motion rate (spin, shimmer, strut travel) so the scene
 * paces itself to the track. Kicks (impulse.low) displace the lattice
 * RADIALLY — nodes shove outward on the hit and spring back. Highs
 * (impulse.high) shimmer the strut edges. GL feedback smears each flash
 * into ghost trails that shear as the field turns.
 *
 * Gridless fallback (frame.beat null): free-run on the bass — a synthetic
 * beat phase is advanced by bass energy, so the lattice still breathes and
 * strobes on the low end without a grid. Absolute barIndex can be
 * negative; tier positions use ((x % n) + n) % n.
 */

import { energyOf, energyHue } from '../../style';
import type { BeatInfo } from '../../channel';
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
uniform float u_flash;     // beat strobe envelope, 0..1
uniform float u_spin;      // accumulated bar quarter-turn angle, radians
uniform float u_wiring;    // 0 tri .. 1 hex .. 2 rhombic (phrase topology)
uniform float u_invert;    // 0 normal .. 1 fully inverted (section)
uniform float u_shock;     // section shockwave envelope, 0..1
uniform float u_decay;     // feedback persistence (ghost trails)
uniform float u_scale;     // lattice cell density
uniform float u_beatPhase; // 0..1 across the beat (anticipation glow)
uniform float u_barPhase;  // 0..1 across the bar (turn interpolation ref)

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

// Skew a plane point into one of three lattice bases; the phrase morphs
// BETWEEN them (u_wiring), rewiring the grid's topology live.
vec2 latticeBasis(vec2 p, float wiring) {
  vec2 tri = vec2(p.x + p.y * 0.5, p.y * 0.8660254);
  vec2 hex = vec2(p.x + 0.5 * floor(p.y + 0.5), p.y);
  vec2 rho = vec2(p.x + p.y, p.x - p.y) * 0.7071068;
  vec2 a = mix(tri, hex, clamp(wiring, 0.0, 1.0));
  return mix(a, rho, clamp(wiring - 1.0, 0.0, 1.0));
}

// Distance to the nearest lattice NODE and to the nearest STRUT in a given
// basis cell. Returns vec2(nodeGlow, strutGlow).
vec2 lattice(vec2 uv, float wiring, float shimmerJitter) {
  vec2 g = latticeBasis(uv, wiring);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;

  float wob = (hash(cell) - 0.5) * 0.12 * shimmerJitter;
  float nodeD = length(f) + wob;
  float node = exp(-nodeD * nodeD * 34.0);

  float sx = exp(-abs(f.y) * 40.0) * smoothstep(0.5, 0.35, abs(f.x));
  float sy = exp(-abs(f.x) * 40.0) * smoothstep(0.5, 0.35, abs(f.y));
  float diagW = clamp(wiring, 0.0, 1.0) * 0.7;
  float sd = exp(-abs(f.x - f.y) * 44.0) * smoothstep(0.5, 0.3, abs(f.x + f.y)) * diagW;
  float strut = max(max(sx, sy), sd);

  return vec2(node, strut);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Feedback warp: the field spins (bar quarter-turn accumulates in
  // u_spin) and pushes outward under a kick, so ghost trails shear.
  float kickPush = u_kick * 0.06 * (0.5 + 0.5 * u_energy);
  vec2 warp = rot(c, -u_spin * 0.04) - dir * kickPush;
  vec2 src = warp / vec2(aspect, 1.0) + 0.5;
  vec3 ghost = texture2D(u_prev, src).rgb * u_decay;

  // ---- Fresh lattice, drawn in the ROTATED, kick-DISPLACED frame.
  vec2 lp = rot(c, u_spin);
  lp += dir * u_kick * 0.09;
  lp += vec2(0.0, u_time * 0.02);
  vec2 grid = lp * u_scale;

  vec2 ns = lattice(grid, u_wiring, u_shimmer);
  float node = ns.x;
  float strut = ns.y;

  // Beat strobe: the structure LIGHTS on the beat and decays; struts
  // travel a bright pulse outward from center on each flash.
  float travel = fract(r * 3.0 - u_time * (0.6 + u_energy) - u_beatPhase);
  float pulse = smoothstep(0.85, 1.0, travel) * u_flash;
  float strutLit = strut * (0.25 + 1.6 * u_flash + 1.2 * pulse + 1.4 * u_shimmer * u_high);
  float nodeLit = node * (0.4 + 2.2 * u_flash + 1.0 * u_energy);

  // Anticipation: a faint pre-flash swell over the last of the beat.
  float antic = smoothstep(0.7, 1.0, u_beatPhase);
  nodeLit += node * antic * 0.5;

  vec3 nodeCol = hsl2rgb(u_hue, 1.0, 0.55) * nodeLit;
  vec3 strutCol = mix(hsl2rgb(u_hue + 30.0, 1.0, 0.55), vec3(1.0), 0.35 * u_high) * strutLit;
  vec3 fresh = nodeCol + strutCol;

  // Section shockwave: a white ring sweeping out on the 16-bar rollover.
  float shockR = u_shock * 1.1;
  float shockRing = exp(-pow((r - shockR) * 7.0, 2.0)) * u_shock;
  fresh += vec3(1.0) * shockRing * 1.5;

  vec3 col = ghost + fresh * (0.7 + 0.8 * u_energy);

  // Section INVERSION: negate the field toward its complement around the
  // swept-hue midpoint (chroma-preserving-ish).
  vec3 mid = hsl2rgb(u_hue, 0.6, 0.5);
  vec3 inverted = 2.0 * mid - col;
  col = mix(col, inverted, u_invert);

  // Soft-knee highlight roll-off (chroma-preserving).
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

const g01StrobeLatticePreset: VisualizerPreset = {
  id: 'g01-strobe-lattice',
  name: 'g01 strobe-lattice',
  hiRes: true,
  params: [
    { id: 'density', label: 'lattice density', min: 3, max: 16, step: 0.5, default: 7 },
    { id: 'trails', label: 'ghost trails', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'strobe', label: 'strobe punch', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let turnTarget = 0;
    let turnAngle = 0;
    let prevBar: number | null = null;
    let wiringTarget = 0;
    let wiring = 0;
    let invertTarget = 0;
    let invert = 0;
    let shock = 0;
    let flash = 0;
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
        let barPhase: number;
        let barIndex: number;
        const beatsPerBar = beat?.beatsPerBar ?? 4;

        if (beat) {
          beatPhase = beat.phase;
          barPhase = beat.barPhase;
          barIndex = beat.barIndex;
        } else {
          const drive = beatsPerSec * (0.6 + 0.8 * frame.bands.low);
          freePhase += dt * drive;
          while (freePhase >= 1) {
            freePhase -= 1;
            freeBar += 1 / beatsPerBar;
          }
          beatPhase = freePhase;
          barPhase = mod(freeBar, 1);
          barIndex = Math.floor(freeBar);
        }

        const strobePunch = frame.params.strobe ?? 1;
        const beatEnv = Math.pow(1 - beatPhase, 3);
        flash = approach(
          flash,
          Math.min(1, (beatEnv + 1.4 * frame.impulse.low) * strobePunch),
          0.04,
          dt
        );

        if (prevBar !== null && barIndex !== prevBar) {
          const dirSign = invertTarget > 0.5 ? -1 : 1;
          turnTarget += dirSign * (Math.PI / 2);
          if (mod(barIndex, 4) === 0) {
            wiringTarget = mod(wiringTarget + 1, 3);
          }
          if (mod(barIndex, 16) === 0) {
            invertTarget = invertTarget > 0.5 ? 0 : 1;
            shock = 1;
          }
        }
        prevBar = barIndex;

        turnAngle = approach(turnAngle, turnTarget, 0.09, dt);
        wiring = approach(wiring, wiringTarget, 0.3, dt);
        invert = approach(invert, invertTarget, 0.4, dt);
        shock = Math.max(0, shock - dt * 1.3);

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
          u_flash: flash,
          u_spin: turnAngle,
          u_wiring: wiring,
          u_invert: invert,
          u_shock: shock,
          u_decay: decay,
          u_scale: density,
          u_beatPhase: beatPhase,
          u_barPhase: barPhase,
        };
      },
    });
  },
};

export default g01StrobeLatticePreset;
