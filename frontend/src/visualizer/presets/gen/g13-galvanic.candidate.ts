/**
 * "g13 galvanic" (genetic arena g13, NOVEL — territory: natural phenomena /
 * physics, lightning / electrical discharge).
 *
 * A dark dielectric gap between two charged rails. Bass energy accumulates as
 * visible CHARGE on the rails (tense, building glow). A kick triggers
 * dielectric breakdown: a fractal, midpoint-displaced lightning bolt fires
 * across the gap — a bright main channel with recursive side-branches — that
 * LIGHTS the field it crosses (voyage/odyssey traveling-ripple idiom) then
 * decays fast, leaving a dim ionized trail on a CONTRACTIVE feedback field.
 *
 * The bolt geometry is computed on the CPU (a branching polyline, recursively
 * subdivided + jittered, splitmix-seeded per fire) and passed to the fragment
 * shader as a fixed-size segment buffer. The shader renders glowing capsules
 * (distance-to-segment) additively over the contracted previous frame, plus
 * corona sparks along the rails. GL feedback (context-loss safe).
 *
 * Band vocabulary (distinct):
 *   low  — rail CHARGE + MAIN STROKE. Bass charges the rails; KICK
 *          (impulse.low, gated → solid, never "kick powder") FIRES the main
 *          bolt: the one scene-scale event. Lights a horizon ring on landing.
 *   mid  — LEADER FLICKER + side branches. mid level sets branch density;
 *          SNARE (impulse.mid) spawns a secondary-stroke burst.
 *   high — CORONA SIZZLE. HAT (impulse.high) sprays sharp bright spark points
 *          along the electrodes — glints that die in a frame (not dust).
 *
 * Grammar: BUILDUP charges rails + ionizes air (tense, never still); DROP
 * fires strokes on beat subdivisions riding max(drop,energy), branch depth up,
 * trail persists longer (field stays contractive; dark floor between strokes);
 * PHRASE flips electrode polarity (top⇄bottom origin); SECTION cross-fades the
 * palette regime (arc-blue → violet → sodium-orange → green plasma).
 *
 * Photosafety: the only near-full-field brightening is the drop storm; each
 * stroke is a one-shot with fast decay and the feedback grade is capped < 1
 * (contractive), so strokes cannot compound into a flash. Stroke firing is
 * rate-limited by beat subdivision (< 3 cycles/sec). No saturated-red
 * strobing (cores are blue/violet/orange/green). Corona glints are localized.
 *
 * Assigned tech: per-band impulses (PRIMARY), bands + bandsSlow (charge,
 * storm rate), trend drop/buildup split (~0.35 s), beat + ladder tiers
 * (subdivisions, polarity, palette regime), trackId genome (bolt seeds +
 * palette order), centroid (core color-temperature). GL feedback contractive.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks in this string. Fixed-size segment loop (MAX_SEGS) — no
// uniform-dependent loop bounds. Each segment is (x1,y1,x2,y2,bright) packed
// into u_segs. Corona sparks packed into u_sparks (x,y,bright). Additive
// glow over the contracted previous frame; chroma-preserving soft knee.
const MAX_SEGS = 40;
const SEG_FLOATS = MAX_SEGS * 5;
const MAX_SPARKS = 24;
const SPARK_FLOATS = MAX_SPARKS * 3;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_decay;       // feedback persistence (< 1, contractive)
uniform float u_charge;      // rail charge glow 0..1
uniform float u_polarity;    // 0 = top->bottom origin, 1 = bottom->top
uniform float u_ring;        // horizon ring intensity (kick landing), decays
uniform float u_ringY;       // ring y position (the struck rail)
uniform float u_boltWidth;   // main channel thickness scale
uniform vec3 u_core;         // stroke core color (near white-hot)
uniform vec3 u_glow;         // stroke outer glow color (palette family)
uniform vec3 u_railCol;      // rail charge color
uniform float u_segs[` + SEG_FLOATS + `];
uniform float u_sparks[` + SPARK_FLOATS + `];

// distance from point p to segment a-b.
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// chroma-preserving soft knee: scale the whole vec3 by a luminance knee so
// hue survives (never per-channel clamp — the washout law).
vec3 softKnee(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  if (m <= 1.0) return c;
  float knee = 1.0 - 0.5 / m; // maps m>1 toward ~1 while keeping ratios
  return c * (knee / m) + c * (1.0 - knee) / m;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;          // 0..1
  vec2 p = vec2(uv.x, uv.y);                    // work in 0..1 space
  float aspect = u_res.x / u_res.y;

  // Contracted previous frame (feedback trail of ionized air).
  vec3 prev = texture2D(u_prev, uv).rgb * clamp(u_decay, 0.0, 0.99);

  vec3 col = vec3(0.0);

  // --- Rails: two charged electrodes top and bottom. Charge = tense glow. 
  float railTop = 0.06;
  float railBot = 0.94;
  float dTop = abs(uv.y - railTop);
  float dBot = abs(uv.y - railBot);
  float railGlow = u_charge * (exp(-dTop * 60.0) + exp(-dBot * 60.0));
  // faint pre-breakdown ionization stress between the rails during charge.
  railGlow += u_charge * 0.12 * exp(-abs(uv.y - 0.5) * 3.0)
              * (0.5 + 0.5 * sin(uv.x * 40.0 + u_time * 6.0));
  col += u_railCol * railGlow;

  // --- The bolt: sum glow contributions from all segments (fixed loop). ---
  float coreAcc = 0.0;
  float glowAcc = 0.0;
  for (int i = 0; i < ` + MAX_SEGS + `; i++) {
    int o = i * 5;
    float bright = u_segs[o + 4];
    if (bright <= 0.001) continue;
    vec2 a = vec2(u_segs[o + 0], u_segs[o + 1]);
    vec2 b = vec2(u_segs[o + 2], u_segs[o + 3]);
    // correct for aspect so capsules are round on screen.
    vec2 pa = vec2(p.x * aspect, p.y);
    vec2 aa = vec2(a.x * aspect, a.y);
    vec2 bb = vec2(b.x * aspect, b.y);
    float d = segDist(pa, aa, bb);
    float w = 0.0024 * u_boltWidth * (0.6 + 0.8 * bright);
    // hot thin core + wider soft glow.
    coreAcc += bright * exp(-d * d / (w * w));
    glowAcc += bright * exp(-d / (w * 6.0));
  }
  col += u_core * coreAcc;
  col += u_glow * glowAcc * 0.7;

  // --- Corona sparks: sharp bright glints along the rails (fixed loop). ---
  for (int s = 0; s < ` + MAX_SPARKS + `; s++) {
    int o = s * 3;
    float sb = u_sparks[o + 2];
    if (sb <= 0.001) continue;
    vec2 sp = vec2(u_sparks[o + 0], u_sparks[o + 1]);
    vec2 pa = vec2(p.x * aspect, p.y);
    vec2 spa = vec2(sp.x * aspect, sp.y);
    float d = length(pa - spa);
    col += (u_glow * 0.5 + u_core * 0.5) * sb * exp(-d * d / 0.00003);
  }

  // --- Horizon ring: a thin bright band on the struck rail (kick landing).
  float ringD = abs(uv.y - u_ringY);
  col += (u_core * 0.4 + u_glow * 0.6) * u_ring
         * exp(-ringD * ringD / 0.0006);

  // Composite over the contracted trail; chroma-preserving knee.
  vec3 outc = softKnee(prev + col);
  gl_FragColor = vec4(outc, 1.0);
}
`;

// --- CPU bolt geometry --------------------------------------------------

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). */
function splitmix(key: number): () => number {
  let state = (Math.round(key) >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

function dominantTrackId(frame: VisualizerFrameData): number | null {
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (!deck.playing || deck.trackId == null) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck.trackId;
    }
  }
  return best;
}

interface BoltSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bright: number;
  /** decay timer 0..1, 1 = fresh. */
  life: number;
  /** whether this is a main-channel segment (slower decay) or a branch. */
  main: boolean;
}

/** Palette family: stroke core, outer glow, rail charge. Bright/saturated,
 * luminance-comparable so section swaps read as chroma events. No red core. */
interface Family {
  core: [number, number, number];
  glow: [number, number, number];
  rail: [number, number, number];
}

const FAMILIES: Family[] = [
  // arc-blue / white core
  { core: [0.9, 0.95, 1.0], glow: [0.25, 0.55, 1.0], rail: [0.2, 0.4, 0.9] },
  // violet corona
  { core: [1.0, 0.9, 1.0], glow: [0.7, 0.25, 1.0], rail: [0.55, 0.2, 0.85] },
  // sodium-orange arc
  { core: [1.0, 0.95, 0.8], glow: [1.0, 0.55, 0.1], rail: [0.9, 0.45, 0.1] },
  // green plasma
  { core: [0.85, 1.0, 0.9], glow: [0.15, 1.0, 0.45], rail: [0.15, 0.85, 0.4] },
];

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const g13GalvanicPreset: VisualizerPreset = {
  id: 'g13-galvanic',
  name: 'g13 galvanic',
  hiRes: true,
  create() {
    // genome state
    let lastTrackId: number | null = null;
    let familyOrder = FAMILIES.map((_, i) => i);
    let familyIndex = 0;
    let fireCount = 0;

    // active bolt segments (ring capacity MAX_SEGS)
    const segs: BoltSeg[] = [];
    // corona sparks
    const sparks: { x: number; y: number; life: number }[] = [];

    // envelopes / regime
    let charge = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let ring = 0;
    let ringY = 0.94;
    let polarity = 0; // 0 top->bottom, 1 bottom->top

    // regime scheduling
    let prevBar: number | null = null;
    let prevSubCell: number | null = null;
    let pseudoBeat = 0;

    // palette cross-fade
    let famA = 0;
    let famB = 0;
    let famMix = 1;

    function reseed(key: number): void {
      const r = splitmix(key);
      const order = FAMILIES.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
      }
      familyOrder = order;
      familyIndex = order[0];
      famA = familyIndex;
      famB = familyIndex;
      famMix = 1;
    }

    /** Build a fractal main channel + branches from origin rail to opposite,
     * midpoint-displaced, splitmix-seeded per fire. Pushes BoltSeg entries. */
    function fireBolt(branchDepthGain: number, seed: number): void {
      fireCount++;
      const r = splitmix(seed);
      const fromTop = polarity < 0.5;
      const y0 = fromTop ? 0.06 : 0.94;
      const y1 = fromTop ? 0.94 : 0.06;
      ringY = y1;
      ring = 1;

      // main channel points, midpoint displacement.
      let pts: [number, number][] = [
        [0.5 + (r() - 0.5) * 0.15, y0],
        [0.5 + (r() - 0.5) * 0.4, y1],
      ];
      const iterations = 5;
      let disp = 0.16;
      for (let it = 0; it < iterations; it++) {
        const next: [number, number][] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          next.push(a);
          const mx = (a[0] + b[0]) / 2 + (r() - 0.5) * disp;
          const my = (a[1] + b[1]) / 2;
          next.push([mx, my]);
        }
        next.push(pts[pts.length - 1]);
        pts = next;
        disp *= 0.55;
      }

      // push main segments (bright, slow decay).
      for (let i = 0; i < pts.length - 1; i++) {
        pushSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1, true);
      }

      // side branches: fork off a subset of main vertices toward a rail-ward
      // wander. Count scales with branch density (mid).
      const branchN = Math.floor((3 + r() * 4) * clamp01(branchDepthGain));
      for (let bIdx = 0; bIdx < branchN; bIdx++) {
        const vi = 1 + Math.floor(r() * (pts.length - 2));
        let bx = pts[vi][0];
        let by = pts[vi][1];
        const dir = (r() - 0.5) * 0.6;
        const steps = 2 + Math.floor(r() * 3);
        const dy = (y1 - y0) * (0.06 + r() * 0.08);
        for (let s = 0; s < steps; s++) {
          const nx = clamp01(bx + dir * (0.3 + r() * 0.5) + (r() - 0.5) * 0.05);
          const ny = by + dy * (fromTop ? 1 : -1);
          pushSeg(bx, by, nx, ny, 0.55 - s * 0.12, false);
          bx = nx;
          by = ny;
        }
      }
    }

    function pushSeg(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      bright: number,
      main: boolean
    ): void {
      segs.push({ x1, y1, x2, y2, bright, life: 1, main });
      // Never exceed the shader budget; drop the oldest (dimmest first).
      if (segs.length > MAX_SEGS) segs.shift();
    }

    // reusable uniform buffers (avoid per-frame allocation).
    const segBuf = new Float32Array(SEG_FLOATS);
    const sparkBuf = new Float32Array(SPARK_FLOATS);

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData) => {
        const dt = Math.min(0.1, Math.max(0, frame.dt));
        const energy = energyOf(frame.bands);
        const bands = frame.bands;
        const bandsSlow = frame.bandsSlow ?? frame.bands;

        // --- Genome ---------------------------------------------------------
        const trackId = dominantTrackId(frame);
        if (lastTrackId === null && trackId === null && prevBar === null) {
          const pseudo =
            Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
          reseed(pseudo);
          lastTrackId = -1; // mark seeded so we don't re-seed each frame
        }
        if (trackId != null && trackId !== lastTrackId) {
          lastTrackId = trackId;
          reseed(trackId);
        }

        // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) -------
        const lowPresence = clamp01((bands.low - 0.2) / 0.5);
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustain = clamp01(energy * 1.4);
        const drive = Math.max(drop, sustain);
        const dropOn = drive > 0.42;

        // --- Rail charge: rises with bass, extra tension in buildups -------
        const chargeParam = frame.params.charge ?? 1;
        const chargeTarget = clamp01(
          (0.15 + 0.6 * bandsSlow.low + 0.5 * buildup + 0.35 * drop) * chargeParam
        );
        const cAlpha = 1 - Math.exp(-dt / 0.25);
        charge += (chargeTarget - charge) * cAlpha;

        // --- Beat scheduling: kick fire, phrase polarity, section palette --
        const beat = frame.beat;
        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        const hasGrid = beat !== null && tierBar !== null;

        const branchParam = frame.params.branch ?? 1;
        const branchGain = (0.5 + 1.1 * bands.mid) * branchParam; // mid → branch density

        // KICK → fire main bolt (gated: solid response, never kick powder).
        if (frame.impulse.low > 0.22) {
          fireBolt(branchGain, fireCount * 2654435761 + (lastTrackId ?? 1));
        }

        // SNARE → secondary short strokes (leader flicker).
        if (frame.impulse.mid > 0.16) {
          const r = splitmix(fireCount * 40503 + Math.floor(frame.time * 1000));
          const y0 = polarity < 0.5 ? 0.06 : 0.94;
          const bursts = 1 + Math.floor(frame.impulse.mid * 3);
          for (let k = 0; k < bursts; k++) {
            const sx = r();
            const sy = 0.2 + r() * 0.6;
            pushSeg(sx, sy, clamp01(sx + (r() - 0.5) * 0.2), sy + (r() - 0.5) * 0.15, 0.5, false);
            void y0;
          }
        }

        // HAT → corona sparks along the rails (sizzle, die in a frame).
        if (frame.impulse.high > 0.14) {
          const count = 2 + Math.floor(frame.impulse.high * 8);
          for (let k = 0; k < count; k++) {
            const onTop = Math.random() < 0.5;
            sparks.push({
              x: Math.random(),
              y: onTop ? 0.06 + Math.random() * 0.02 : 0.92 + Math.random() * 0.02,
              life: 1,
            });
          }
        }

        // Drop subdivisions: fire on offbeats too (rate-limited storm).
        if (hasGrid) {
          const barIndex = tierBar as number;
          const sub = Math.floor(clamp01(beat!.barPhase) * 8); // 8th-note cells
          const subCell = barIndex * 8 + sub;
          if (prevSubCell === null || subCell !== prevSubCell) {
            if (dropOn && (sub % 2 === 1)) {
              fireBolt(branchGain * 1.3, fireCount * 2654435761 + subCell);
            }
            prevSubCell = subCell;
          }
          if (prevBar === null || barIndex !== prevBar) {
            // PHRASE (%4) → polarity flip; SECTION (%16) → palette cross-fade.
            if (barIndex % 4 === 0) polarity = polarity < 0.5 ? 1 : 0;
            if (barIndex % 16 === 0) {
              const secIdx = Math.floor(barIndex / 16);
              famA = famB;
              famB = familyOrder[((secIdx % familyOrder.length) + familyOrder.length) %
                familyOrder.length];
              famMix = 0;
            }
            prevBar = barIndex;
          }
        } else {
          pseudoBeat += dt * (0.8 + 2.4 * energy);
          const subCell = Math.floor(pseudoBeat * 2);
          if (prevSubCell === null || subCell !== prevSubCell) {
            if (dropOn && subCell % 2 === 1) {
              fireBolt(branchGain * 1.3, fireCount * 2654435761 + subCell);
            }
            if (subCell % 8 === 0) polarity = polarity < 0.5 ? 1 : 0;
            prevSubCell = subCell;
          }
        }

        // palette cross-fade ease.
        famMix = Math.min(1, famMix + dt / 0.5);

        // --- Age segments + sparks + ring ----------------------------------
        for (const s of segs) {
          // main channel decays ~0.18 s; branches faster.
          s.life -= dt / (s.main ? 0.18 : 0.1);
        }
        while (segs.length > 0 && segs[0].life <= 0) segs.shift();
        // also filter interior dead segments cheaply.
        for (let i = segs.length - 1; i >= 0; i--) {
          if (segs[i].life <= 0) segs.splice(i, 1);
        }
        for (const sp of sparks) sp.life -= dt / 0.09;
        for (let i = sparks.length - 1; i >= 0; i--) {
          if (sparks[i].life <= 0) sparks.splice(i, 1);
        }
        if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
        ring = Math.max(0, ring - dt / 0.22);

        // --- Pack segment buffer -------------------------------------------
        segBuf.fill(0);
        const nSeg = Math.min(segs.length, MAX_SEGS);
        for (let i = 0; i < nSeg; i++) {
          const s = segs[i];
          const o = i * 5;
          segBuf[o + 0] = s.x1;
          segBuf[o + 1] = s.y1;
          segBuf[o + 2] = s.x2;
          segBuf[o + 3] = s.y2;
          segBuf[o + 4] = clamp01(s.life) * s.bright;
        }
        sparkBuf.fill(0);
        const nSpark = Math.min(sparks.length, MAX_SPARKS);
        for (let i = 0; i < nSpark; i++) {
          const sp = sparks[i];
          const o = i * 3;
          sparkBuf[o + 0] = sp.x;
          sparkBuf[o + 1] = sp.y;
          sparkBuf[o + 2] = clamp01(sp.life);
        }

        // --- Palette (cross-faded, centroid warms the core) ----------------
        const fam = lerpFamily(FAMILIES[famA], FAMILIES[famB], famMix);
        // centroid nudges core temperature: brighter centroid → cooler/whiter.
        const warm = 0.5 + (frame.centroid - 0.5) * 0.4;
        const core: [number, number, number] = [
          clamp01(fam.core[0] * (1 + (0.5 - warm) * 0.2)),
          clamp01(fam.core[1]),
          clamp01(fam.core[2] * (1 + (warm - 0.5) * 0.2)),
        ];

        // --- Feedback decay: contractive, longer trail on drops ------------
        const decayParam = frame.params.decay ?? 0.72;
        const decay = Math.min(0.94, decayParam + (dropOn ? 0.1 : 0));

        const boltWidth = frame.params.boltWidth ?? 1;

        return {
          u_time: frame.time,
          u_decay: decay,
          u_charge: charge,
          u_polarity: polarity,
          u_ring: ring,
          u_ringY: ringY,
          u_boltWidth: boltWidth,
          u_core: core,
          u_glow: fam.glow,
          u_railCol: fam.rail,
          u_segs: segBuf,
          u_sparks: sparkBuf,
        };
      },
    });
  },
};

function lerpFamily(a: Family, b: Family, t: number): Family {
  return {
    core: lerp3(a.core, b.core, t),
    glow: lerp3(a.glow, b.glow, t),
    rail: lerp3(a.rail, b.rail, t),
  };
}

const params: PresetParam[] = [
  { id: 'charge', label: 'rail charge', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'branch', label: 'branch density', min: 0.6, max: 1.6, step: 0.05, default: 1 },
  { id: 'decay', label: 'trail persistence', min: 0.5, max: 0.92, step: 0.02, default: 0.72 },
  { id: 'boltWidth', label: 'bolt thickness', min: 0.5, max: 1.8, step: 0.05, default: 1 },
];

g13GalvanicPreset.params = params;

export default g13GalvanicPreset;
