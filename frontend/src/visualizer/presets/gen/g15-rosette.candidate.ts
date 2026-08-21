/**
 * g15-rosette (gen-15 NOVEL, feedback-space optics lens).
 *
 * A CATHEDRAL ROSE WINDOW THAT BUILDS ITSELF. The optic living inside the
 * resample loop is a KALEIDOSCOPIC FOLD: every frame the previous frame is
 * re-sampled through a k-fold mirror (rotate → fold the angle into a
 * mirrored wedge → un-project), so any asymmetric injection is symmetrized
 * within ~10 frames into mandala structure. A slow inward radial crawl
 * renews the glass toward the center; an unsharp tap keeps the lead lines
 * crisp through endless resampling.
 *
 * ARCHITECTURE = GENOME: fold count k ∈ {5..9} from the trackId genome
 * (via frame.dominantChannel — the LAW). SECTION boundaries (16-bar
 * ladder tier) re-roll k: the whole window re-architects — theatre.
 * Phrase boundaries (4 bars) flip the fold-rotation direction.
 *
 * INJECTION (asymmetric + sparse; the fold multiplies it):
 *   JEWEL SCRIBE  one glowing lozenge gliding radially with barPhase;
 *                 color steps through a committed jewel cycle
 *                 (ruby/amber/emerald/sapphire) per bar.
 *   KICK          a hot ring stamp at the horizon radius (solid bass).
 *   MID           a lattice arc at mid radius.
 *   HIGH IMPULSE  thin radial filaments at the outer rim (approved
 *                 vocabulary — filaments, not dust).
 *   LEAD LINES    multiplicative dark spokes at wedge boundaries + dark
 *                 rings (cames) — ≤ 1 by construction, contraction-safe.
 *   BUILDUP       fold rotation accelerates, glass cools.
 *   DROP          gold flood: injection gains lift riding max(drop,
 *                 energy); the ring runs white-hot.
 *
 * CONTRACTION: the fold is pure sampling; decay < 1 always; grade capped
 * at 0.99; chroma-preserving soft knee. Fold rotation rides bandsSlow
 * (erratic-motion law); k snaps only on section boundaries. GLSL ES 1.0,
 * no backticks in GLSL.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

// No backticks inside this GLSL string (GLSL ES 1.0).
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_kick;
uniform float u_folds;      // k (integer-valued float, 5..9)
uniform float u_foldRot;    // accumulated fold rotation (radians)
uniform float u_crawl;      // inward radial crawl step
uniform float u_decay;
uniform float u_grade;      // capped <= 0.99 JS-side
uniform float u_scribeR;    // jewel scribe radial position (0..0.46)
uniform float u_scribeGain;
uniform vec3 u_jewel;       // current jewel color
uniform float u_ringAmp;    // kick ring stamp envelope
uniform float u_ringR;
uniform float u_filAmp;     // high filament strike envelope
uniform float u_filSeed;
uniform float u_lead;       // lead-line (cames) strength 0..1
uniform float u_drop;
uniform float u_buildup;
uniform float u_cool;       // buildup cooling 0..1

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 rot2(vec2 p, float a) {
  float cs = cos(a);
  float sn = sin(a);
  return mat2(cs, -sn, sn, cs) * p;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- The kaleidoscopic fold: rotate, fold the angle into a mirrored
  // wedge, un-project. Pure sampling — contraction-safe.
  float wedge = 3.14159265 / u_folds; // half-sector (mirror period is 2*wedge)
  float a = ang + u_foldRot;
  float folded = abs(mod(a, 2.0 * wedge) - wedge);
  // Inward crawl: sample slightly OUTWARD so glass flows to the center.
  float rs = r * (1.0 + u_crawl);
  vec2 fc = vec2(cos(folded), sin(folded)) * rs;
  vec2 src = fc / vec2(aspect, 1.0) + 0.5;

  vec3 samp = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 glass = max(vec3(0.0), samp * 1.30 - blur * 0.30) * u_decay;
  // Buildup cooling: a gentle spectral pull toward blue glass (multiplier
  // <= 1 per channel — contraction-safe).
  glass *= mix(vec3(1.0), vec3(0.93, 0.97, 1.0), u_cool);

  // ---- Fresh glazing, injected at (1 - decay). Deliberately asymmetric:
  // the fold does the multiplication.
  vec3 fresh = vec3(0.0);
  // Jewel scribe: a lozenge gliding radially at a fixed unfolded angle.
  vec2 scribePos = vec2(0.894, 0.447) * u_scribeR;
  vec2 sd = c - scribePos;
  sd = rot2(sd, 0.6);
  float loz = exp(-(sd.x * sd.x * 500.0 + sd.y * sd.y * 1500.0));
  fresh += u_jewel * loz * u_scribeGain * 5.5;
  // Kick ring: hot stamp at the horizon radius, white-hot through drops.
  if (u_ringAmp > 0.01) {
    float ring = exp(-pow((r - u_ringR) * 36.0, 2.0));
    vec3 ringCol = mix(u_jewel * 1.2, vec3(1.0, 0.95, 0.82), 0.35 + 0.5 * u_drop);
    fresh += ringCol * ring * u_ringAmp * (2.2 + 1.4 * u_drop);
  }
  // Mid lattice arc: a beaded arc at mid radius, one side only.
  float arc = exp(-pow((r - 0.27) * 40.0, 2.0))
    * pow(max(0.0, sin(ang * 9.0 + t * 0.4)), 6.0)
    * smoothstep(-0.6, 0.9, cos(ang - 0.7));
  fresh += mix(u_jewel, vec3(1.0), 0.25) * arc * u_mid * 3.2;
  // High filaments: thin radial strikes at the outer rim.
  if (u_filAmp > 0.01) {
    float fa = fract(u_filSeed) * 6.28318;
    float dAng = abs(mod(ang - fa + 3.14159, 6.28318) - 3.14159);
    float fil = exp(-dAng * dAng * 900.0) * smoothstep(0.3, 0.42, r) * smoothstep(0.5, 0.44, r);
    fresh += vec3(0.95, 0.98, 1.0) * fil * u_filAmp * 4.5;
  }
  glass += fresh * (1.0 - u_decay) * 5.5;

  // ---- Lead lines (cames): multiplicative darkening at wedge boundaries,
  // concentric rings, and the outer frame — the stained-glass skeleton.
  float aa = abs(mod(ang + u_foldRot, 2.0 * wedge) - wedge);
  float spoke = 1.0 - u_lead * exp(-pow(aa * u_folds * 4.6, 2.0)) * smoothstep(0.05, 0.12, r);
  float rings = 1.0 - u_lead * 0.85 * (
    exp(-pow((r - 0.155) * 120.0, 2.0)) +
    exp(-pow((r - 0.315) * 120.0, 2.0)));
  float masonry = smoothstep(0.5, 0.44, r);
  glass *= spoke * rings;
  glass *= 0.12 + 0.88 * masonry; // beyond the window: near-dark stone
  // Oculus glow: keep the very center alive with the bass.
  glass += u_jewel * exp(-r * r * 260.0) * (0.12 + 0.5 * u_low + 0.7 * u_kick) * (1.0 - u_decay) * 6.0;

  // Grade (capped) + grain.
  glass *= u_grade;
  glass += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * 0.008;

  float m = max(glass.r, max(glass.g, glass.b));
  if (m > 0.8) {
    glass *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(glass, 0.0), 1.0);
}
`;

// Committed jewel cycle: ruby, amber, emerald, sapphire (saturated,
// luminance-comparable — photosafety across bar swaps).
const JEWELS: [number, number, number][] = [
  [0.95, 0.1, 0.22],
  [1.0, 0.62, 0.08],
  [0.08, 0.85, 0.4],
  [0.16, 0.4, 1.0],
];

const preset: VisualizerPreset = {
  id: 'g15-rosette',
  name: 'g15 Rosette',
  hiRes: true,
  params: [
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'crawl', label: 'crawl speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'lead', label: 'lead lines', min: 0, max: 1, step: 0.05, default: 0.7 },
  ],
  create: () => {
    let foldRot = 0;
    let rotDir = 1;
    let folds = 7;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let ringAmp = 0;
    let ringR = 0.16;
    let filAmp = 0;
    let filSeed = 0.3;
    let lastSection = -1;
    let lastPhrase = -1;
    let lastBar = -1;
    let jewelIdx = 0;
    let lastAnchorTrack: number | null = null;
    let slowCentroid = 0.5;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(1 / 240, frame.dt || 1 / 60));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        const energyMotion = energyOf(motion);
        const alpha = 1 - Math.exp(-dt / 0.35);
        if (frame.regime) {
          smoothDrop += (Math.max(frame.regime.dropTransition, frame.regime.sustained) - smoothDrop) * alpha;
          smoothBuildup += (frame.regime.buildup - smoothBuildup) * alpha;
        } else {
          const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
          smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
          smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        }
        const drive = Math.max(smoothDrop, Math.min(1, energy * 1.3));
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        // Genome (dominantChannel LAW).
        if (frame.dominantChannel) {
          const deck = frame.decks.find((d) => d.channel === frame.dominantChannel);
          if (deck && deck.trackId !== null && deck.trackId !== lastAnchorTrack) {
            lastAnchorTrack = deck.trackId;
            folds = 5 + Math.floor(splitmix01(deck.trackId) * 5); // 5..9
          }
        }
        // Ladder tiers: section re-rolls k (theatre); phrase flips rotation;
        // bar steps the jewel cycle.
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        if (bar !== null) {
          if (bar !== lastBar) {
            lastBar = bar;
            jewelIdx = (jewelIdx + 1) % JEWELS.length;
          }
          const phrase = Math.floor(bar / 4);
          if (phrase !== lastPhrase) {
            lastPhrase = phrase;
            rotDir = -rotDir;
          }
          const section = Math.floor(bar / 16);
          if (section !== lastSection) {
            lastSection = section;
            folds = 5 + Math.floor(splitmix01((lastAnchorTrack ?? 1) * 131 + section * 17) * 5);
          }
        }
        // Fold rotation: rate rides bandsSlow (motion law), buildup lifts it.
        foldRot += rotDir * dt * (0.05 + 0.35 * energyMotion + 0.3 * smoothBuildup);
        // Kick ring stamp envelope.
        ringAmp = ringAmp * Math.exp(-dt / 0.16) + frame.impulse.low * 0.9;
        ringAmp = Math.min(1.4, ringAmp);
        ringR = 0.13 + 0.06 * frame.bands.low;
        // High filament strikes.
        filAmp *= Math.exp(-dt / 0.14);
        if (frame.impulse.high > 0.4 && filAmp < 0.3) {
          filAmp = Math.min(1, frame.impulse.high * 1.1);
          filSeed = splitmix01(Math.floor(frame.time * 31));
        }
        // Scribe glide: radial position from barPhase (gridless: slow saw).
        const barPhase = frame.beat ? frame.beat.barPhase : (frame.time * 0.11) % 1;
        const scribeR = 0.06 + 0.4 * barPhase;
        const persistence = frame.params.persistence ?? 1;
        const baseDecay = 0.99 - 0.006 * smoothBuildup;
        const jewel = JEWELS[jewelIdx];
        // Centroid drift: bright spectra push jewels warmer (small mix).
        const warm = (slowCentroid - 0.5) * 0.3;
        const tint = (c: [number, number, number]): [number, number, number] => [
          Math.min(1, c[0] * (1 + warm)),
          c[1],
          Math.min(1, c[2] * (1 - warm)),
        ];
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_kick: frame.impulse.low,
          u_folds: folds,
          u_foldRot: foldRot,
          u_crawl: dt * (0.02 + 0.1 * energyMotion) * (frame.params.crawl ?? 1),
          u_decay: Math.min(0.996, 1 - (1 - baseDecay) / persistence),
          u_grade: Math.min(0.99, 0.92 + 0.07 * drive - 0.04 * smoothBuildup),
          u_scribeR: scribeR,
          u_scribeGain: (0.35 + 0.65 * Math.max(drive, frame.bands.mid)) / (1 + 0.6 * smoothBuildup),
          u_jewel: tint(jewel),
          u_ringAmp: Math.min(1.2, ringAmp),
          u_ringR: ringR,
          u_filAmp: filAmp,
          u_filSeed: filSeed,
          u_lead: frame.params.lead ?? 0.7,
          u_drop: drive,
          u_buildup: smoothBuildup,
          u_cool: Math.min(1, smoothBuildup * 1.2),
        };
      },
    });
  },
};

export default preset;
