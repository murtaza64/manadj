/**
 * "g04 julia-glacial" (genetic arena g04, song-genome family, direction:
 * FRACTAL). A TWEAK of g03-julia-lumen.
 *
 * Human verdict on the parent: "wayyy too fast but cool ideas". g03's
 * anatomy — constrained dense-annulus C, exterior nebula, guaranteed visual
 * floor, orbit traps, song genome — is all KEPT. The one thing that has to
 * change is TEMPO: everything crept, drifted, and breathed too fast, so the
 * set never felt like it was holding a pose. This candidate slows the whole
 * motion budget 3–4x and rebuilds the C evolution around PHRASE LOCKING.
 *
 * What changed vs g03:
 *
 *  1. GLOBAL DECELERATION (3–4x). Every continuous clock (drift, rotation,
 *     zoom breathing, shell scroll, shimmer) is scaled down by ~0.28–0.33.
 *     The set now glides; filaments hold long enough to read as structure.
 *     EMA taus lengthen so the "material" (breadth/texture/temperature)
 *     changes over a passage, not a phrase.
 *
 *  2. PHRASE-LOCKED C STEPPING (the big one). g03 eased C toward a
 *     continuously-drifting target every frame — motion never stopped. Here
 *     C is QUANTIZED to bars: it holds a pose for a whole bar, then eases
 *     ONE step to the next bar's genome point. The step size is tiered:
 *       - ordinary bar  -> a small nudge (the annulus barely turns)
 *       - phrase bar (every 8) -> a bigger, deliberate step
 *       - section bar (every 32) -> a dramatic jump along the orbit (theatre)
 *     Each step eases with a per-bar time constant, so within a bar the set
 *     is mostly still, then flows to the next pose. Musical, not jittery.
 *
 *  3. SPEED RISES ONLY WHEN THE MUSIC DEMANDS IT. The base state is
 *     RESTRAINED — slow cadence, gentle breathing. A drop injects a
 *     TEMPORARY acceleration (rotation, zoom breathing, shimmer, and the
 *     C ease all quicken) that then SETTLES back as the drop's excitement
 *     plateau fades. True dynamic range: glacial when quiet, alive on the
 *     drop, never flat. Buildups tense (tighten traps, lift iteration) but
 *     do NOT run the clocks away.
 *
 * KEPT verbatim from g03 (the "cool ideas"): exterior nebula (never black),
 * dense-annulus C constraint, guaranteed visual floor, orbit-trap coloring,
 * spectral-tilt nebula hue, snare powder, kick rings, rebirth shock, the
 * bounded computeC. The shader is g03's with only tempo-facing constants
 * eased and a slow-shell term; the JS driver carries the phrase-lock logic.
 *
 * GLSL discipline unchanged: CONSTANT iteration loop (MAX_ITER fixed at
 * compile time), per-pixel early-out via an `alive` mask (no
 * break-on-uniform, ES 1.0 legal), no dynamic indexing, no backticks in the
 * shader string, chroma-preserving soft knee on the feedback composite.
 *
 * Assigned tech: bar/phrase/section tiers (beat.barIndex + barPhase) driving
 * the C step quantization; bpm cadence; drop/buildup split (smoothed) as the
 * only speed lever; slow-stat EMAs (breadth/texture/warmth); 24-band
 * spectral tilt lighting the nebula; per-band impulses (kick rings, snare
 * powder); deck trackId identity + rebirth.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks inside this string. MAX_ITER is a compile-time constant so
// the iteration loop is ES-1.0-legal; per-pixel early exit rides an `alive`
// mask, never break-on-uniform. Only tempo-facing constants differ from g03.
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;       // impulse.low, SOLID responses
uniform float u_snare;      // impulse.mid, powder
uniform float u_hat;        // impulse.high, shimmer
uniform float u_drop;       // smoothed excitement WITH bass (the speed lever)
uniform float u_buildup;    // smoothed excitement WITHOUT bass
uniform float u_sustain;    // bass-weighted sustained loudness
uniform vec2  u_c;          // the Julia constant C = the song genome
uniform float u_zoom;       // magnification (slow breathing + drop shock)
uniform float u_rot;        // orbit-trap frame rotation (slow bpm cadence)
uniform float u_kali;       // 0 = plain Julia, 1 = Kali abs-fold flavour
uniform float u_fold;       // symmetry fold count (seed), continuous
uniform float u_trapMix;    // seed: blend of point-trap vs line-trap coloring
uniform float u_trapRad;    // trap radius: phrase tightens, drop blooms
uniform float u_breadth;    // avg spread => trap spacing / structural breadth
uniform float u_texture;    // avg flatness => crisp filaments <-> granular haze
uniform float u_warm;       // avg centroid => palette temperature
uniform float u_sat;        // saturation surge (buildups saturate)
uniform float u_palette;    // seed palette family, 0..3 (continuous)
uniform float u_iterGain;   // phrase-breathing extra iteration weight
uniform float u_decay;      // feedback persistence
uniform float u_rebirth;    // 0..1 track-change re-genesis intensity
uniform float u_center;     // seed: view-center offset along C's normal
uniform float u_seed;       // scalar seed for hash tinting
uniform float u_nebula;     // exterior nebula brightness (sustain + spectrum)
uniform float u_tilt;       // spectral tilt (dark<->bright content) for nebula hue
uniform float u_floor;      // guaranteed visual floor (never a black frame)
uniform float u_slow;       // global motion scalar (drop lifts it, else glacial)

const int MAX_ITER = 96;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// iq cosine palettes: four families the seed selects between, MORPHED (not
// switched) so every seed lands on its own hue set. Bright, saturated —
// this repo dislikes pastels.
vec3 pal0(float t) { return vec3(0.5, 0.28, 0.5)  + vec3(0.5, 0.45, 0.5)  * cos(6.28318 * (vec3(1.0, 0.9, 0.75) * t + vec3(0.0, 0.18, 0.42))); }
vec3 pal1(float t) { return vec3(0.16, 0.44, 0.5) + vec3(0.4, 0.5, 0.45)  * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.1, 0.32, 0.55))); }
vec3 pal2(float t) { return vec3(0.55, 0.42, 0.2) + vec3(0.5, 0.42, 0.35) * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.14, 0.28))); }
vec3 pal3(float t) { return vec3(0.5, 0.12, 0.32) + vec3(0.5, 0.4, 0.45)  * cos(6.28318 * (vec3(1.0, 0.85, 0.9) * t + vec3(0.2, 0.05, 0.55))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  // Temperature from avg centroid; hot lean on the drop. Wide phase already
  // lives in t, so this is a bias, not the whole hue.
  c += vec3(0.14, 0.02, -0.08) * (u_warm - 0.5) * 1.4;
  c += vec3(0.16, 0.0, -0.06) * u_drop;
  return c;
}

// Saturation control: buildups saturate, flatness (noisy material) desats
// toward a granular haze so a noise sweep and a tonal stab read as different
// MATERIALS, not just different hues.
vec3 saturate(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, amt);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // ---- Feedback advection: a gentle rotating zoom of the previous frame
  // gives motion continuity (trails shear with the orbit-trap rotation and
  // breathe with the zoom cadence). Unsharp tap keeps filaments crisp.
  float fbRot = u_rot * 0.35;
  float fcs = cos(fbRot);
  float fsn = sin(fbRot);
  float fbZoom = 1.0 + (u_zoom - 1.0) * 0.5 + 0.02 * u_kick;
  vec2 fp = mat2(fcs, -fsn, fsn, fcs) * p / fbZoom;
  vec2 src = fp / vec2(aspect, 1.0) + 0.5;
  vec2 pix = 1.0 / u_res;
  // Radial chromatic split, wider through the drop / rebirth shock.
  vec2 rdir = length(p) > 1e-4 ? normalize(p) : vec2(0.0);
  vec2 ab = rdir * (0.0009 + 0.004 * u_drop + 0.006 * u_rebirth) / vec2(aspect, 1.0);
  vec3 fed = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, pix.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, pix.y)).rgb) * 0.25;
  vec3 trail = max(vec3(0.0), fed * 1.32 - blur * 0.32) * u_decay;

  // ---- Sample coordinate into the parameter plane: rotate + zoom (slow
  // cadence, drop shock), shift the view-center along the seed's chosen
  // offset so different songs frame different regions of the set.
  float cs = cos(u_rot);
  float sn = sin(u_rot);
  vec2 z = mat2(cs, -sn, sn, cs) * (p / u_zoom);
  z += vec2(u_center * 0.35, u_center * 0.2);
  // Seed symmetry fold: kaleidoscopic angular wrap so the seed's fold count
  // stamps a rotational symmetry onto the field (structural, not palette).
  float fold = max(1.0, u_fold);
  float a = atan(z.y, z.x);
  float rad = length(z);
  a = abs(mod(a, 6.28318 / fold) - 3.14159 / fold);
  z = vec2(cos(a), sin(a)) * rad;

  // ---- The iteration. Constant loop; an alive mask retires a pixel once it
  // escapes so later iterations are inert (early-out without break-on-uniform).
  vec2 c = u_c;
  float alive = 1.0;
  float iterCount = 0.0;
  // Smooth-escape accumulator: capture |z| at the moment of escape so the
  // exterior gets a continuous escape-velocity coordinate (the nebula's
  // banding), not a stepped integer. Written once, masked so only the
  // escaping frame contributes.
  float escMag = 0.0;
  // Orbit traps: distance to a slowly moving POINT trap and two LINE traps
  // (x-axis and a diagonal). These minima carry the vibrant color. The trap
  // point drifts on the GLOBAL slow clock now (u_time * u_slow), so at rest
  // the whole field holds still.
  float trapPt = 1e9;
  float trapLnX = 1e9;
  float trapLnD = 1e9;
  float tClock = u_time * u_slow;
  vec2 tp = vec2(cos(tClock * 0.13 + u_seed * 6.28), sin(tClock * 0.11 - u_seed * 6.28))
    * (0.25 + 0.35 * u_breadth);
  float diag = 0.70710678;
  float escape = 4.0 + 8.0 * u_breadth;
  for (int i = 0; i < MAX_ITER; i++) {
    // Kali flavour folds |z| before squaring — abs-fold gives the crisp
    // orthogonal filaments the seed can dial in.
    vec2 zf = mix(z, abs(z), u_kali);
    z = cmul(zf, zf) + c;
    float m2 = dot(z, z);
    // Accumulate traps only while alive; multiply by alive so dead pixels
    // stop contributing (the mask IS the early-out).
    float dp = length(z - tp);
    float dlx = abs(z.y);
    float dld = abs(z.x * diag - z.y * diag);
    trapPt = min(trapPt, mix(1e9, dp, alive));
    trapLnX = min(trapLnX, mix(1e9, dlx, alive));
    trapLnD = min(trapLnD, mix(1e9, dld, alive));
    iterCount += alive;
    // Detect the escaping frame: alive==1 AND m2 just crossed escape. Record
    // the magnitude for smooth (normalized-iteration) exterior coloring.
    float justEscaped = alive * (1.0 - step(m2, escape));
    escMag = mix(escMag, sqrt(m2), justEscaped);
    // Escape test folded into the mask; once escaped, alive drops to 0.
    alive *= step(m2, escape);
  }

  // Smooth escape count -> banding coordinate; iterGain (phrase breathing)
  // and hat shimmer modulate how many bands read.
  float esc = iterCount / float(MAX_ITER);
  float bands = esc * (6.0 + 4.0 * u_iterGain + 3.0 * u_high);

  // Smooth iteration count (normalized-iteration coloring): fractional bump
  // from the escape magnitude smooths the exterior into continuous shells,
  // the substrate of the nebula. Guarded log; escMag >= sqrt(escape) > 1.
  float nu = iterCount - log2(max(1.0, log2(max(escMag, 1.0001))));
  float smoothEsc = clamp(nu / float(MAX_ITER), 0.0, 1.0);

  // Trap-driven color: point trap = the saturated core hue, line traps =
  // structural highlights. trapRad controls the falloff (phrase tightens,
  // drop blooms). breadth spaces the line traps out.
  float rInv = 1.0 / max(0.02, u_trapRad);
  float gPt = exp(-trapPt * trapPt * rInv * rInv * 3.0);
  float gLnX = exp(-trapLnX * (30.0 - 18.0 * u_breadth) * rInv);
  float gLnD = exp(-trapLnD * (30.0 - 18.0 * u_breadth) * rInv);
  float lineTrap = max(gLnX, gLnD);

  // Palette coordinate rides the escape banding + point-trap phase + a slow
  // seed drift; texture (flatness) grains it up. Drift on the global clock.
  float grain = (hash(gl_FragCoord.xy + fract(u_time) * 131.0) - 0.5) * u_texture * 0.8;
  float pt = bands * 0.16 + trapPt * 0.7 + tClock * 0.03 + grain;
  vec3 core = palette(pt);
  vec3 edge = palette(pt + 0.35 + 0.2 * u_high);

  // Compose: interior blooms with the point trap, filaments with the line
  // traps; trapMix (seed) sets which dominates the song's look.
  vec3 field = mix(core * gPt, edge * lineTrap, clamp(u_trapMix, 0.0, 1.0));
  field += core * gPt * (0.4 + 0.6 * u_trapMix);

  // ---- EXTERIOR NEBULA (kept): the escape region is a luminous,
  // palette-hued nebula, NEVER black. Smooth-iteration shells give it depth;
  // spectral tilt shifts its hue with the mix's brightness; sustain + the
  // u_nebula drive set its glow so it answers to audio. exterior==1 outside
  // the trapped body. Shell scroll rides the global slow clock so at rest
  // the nebula BREATHES rather than races.
  float exterior = 1.0 - alive;
  float shells = 0.5 + 0.5 * sin(smoothEsc * (24.0 + 10.0 * u_breadth) - tClock * 0.4);
  float nebPhase = smoothEsc * 1.7 + u_tilt * 0.5 + trapPt * 0.3 + tClock * 0.02;
  vec3 nebulaCol = palette(nebPhase);
  // Falloff from the set boundary: bright near the filaments, thinning into
  // deep exterior — but a residual base keeps deep space from going black.
  float depth = smoothEsc;
  float glow = (0.30 + 0.70 * shells) * (0.35 + 0.65 * (1.0 - depth));
  vec3 nebula = nebulaCol * glow * exterior * (0.22 + 1.05 * u_nebula);

  // Interior fill so connected sets read as a lit body, not a hole; the
  // fill dims where the pixel escaped early (the exterior filigree).
  float interior = exterior; // 1 for escaped exterior, 0 for the trapped body
  vec3 body = palette(0.15 + trapPt * 0.5 + tClock * 0.02) * (0.35 + 0.5 * u_low);
  field = mix(body, field, interior * 0.85 + 0.15);
  // Lay the nebula UNDER the trap filaments so filaments stay crisp on top.
  field += nebula;

  // ---- GUARANTEED VISUAL FLOOR (kept): even at zero energy the trap field
  // + nebula contribute a faint breathing base so the frame is never blank.
  float floorGlow = (gPt * 0.5 + lineTrap * 0.4 + glow * exterior * 0.5 + 0.05);
  vec3 floorCol = mix(nebulaCol, core, 0.5);
  field += floorCol * floorGlow * u_floor;

  // Live modulation: bass lifts the body, mids animate the filaments,
  // buildups accelerate a shimmer over the whole field. Shimmer rate now
  // rides the global slow clock AND the drop lever, so the shimmer is
  // glacial at rest and only quickens when the music goes hard.
  float shimmer = 0.85 + 0.15 * sin(tClock * (3.0 + 9.0 * u_drop) + bands * 3.0 + u_seed * 20.0);
  field *= 0.55 + 1.1 * u_sustain + 0.8 * u_drop;
  field *= shimmer;
  field += edge * lineTrap * (0.2 + 1.2 * u_mid) * shimmer;
  // Drop flares the nebula (release), buildup accelerates its shells.
  field += nebula * (0.5 * u_drop + 0.3 * u_buildup);

  // Saturation: buildups saturate hard, flatness (noise) desaturates toward
  // a granular haze -> a tonal stab and a noise sweep are different MATERIALS.
  float satAmt = clamp(u_sat * (1.35 - 0.5 * u_texture), 0.0, 2.0);
  field = saturate(field, satAmt);

  // ---- SOLID kick response: a radial magnification pulse ring travelling
  // out through the set (never a flash — localized).
  float kr = length(p);
  float kickRing = exp(-pow((kr - (0.12 + 0.6 * u_kick)) * 9.0, 2.0)) * u_kick;
  field += palette(0.6 + tClock * 0.05) * kickRing * (0.8 + 1.4 * u_low);
  // Bass core pump: the trapped body glows harder under sustained lows.
  field += body * (1.0 - interior) * (0.4 * u_low + 0.9 * u_kick);

  // Snare powder: discrete sparks scattered into the exterior nebula.
  if (u_snare > 0.03) {
    vec2 q = p * 22.0;
    vec2 cell = floor(q);
    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
    vec2 f = fract(q) - pos;
    float spark = exp(-dot(f, f) * 360.0) * step(0.978, hash(sc * 1.618 + 9.7));
    field += mix(vec3(1.0), edge, 0.5) * spark * u_snare * interior * 1.3;
  }

  // ---- Rebirth shock: the old anatomy dissolves as C eases (JS-side); here
  // a bright expanding shell zooms through the set to mark the re-genesis.
  if (u_rebirth > 0.01) {
    float rr = 0.05 + (1.0 - u_rebirth) * 1.3;
    float shell = exp(-pow((kr - rr) * 6.0, 2.0));
    field += palette(0.3 + tClock * 0.08) * shell * u_rebirth * 2.2;
    field *= 1.0 + 0.4 * u_rebirth * (1.0 - interior);
  }

  // Blend the fresh field into the trail (feedback continuity).
  vec3 outc = trail + field * (1.0 - u_decay) * (2.6 + 1.4 * u_sustain);

  // Vibrant-buildup lift, drop bloom; buildups add energy (NOT dimmed).
  outc *= 0.72 + 0.5 * max(u_drop, u_sustain) + 0.18 * u_buildup;

  // Chroma-preserving soft knee: scale ALL channels by one factor above the
  // knee so hues hold (never a per-channel clamp).
  float mx = max(outc.r, max(outc.g, outc.b));
  if (mx > 0.82) {
    outc *= (0.82 + 0.18 * (1.0 - exp(-(mx - 0.82) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(outc, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'zoomRange', label: 'zoom breathing depth', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'trapDetail', label: 'orbit-trap detail', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'persistence', label: 'feedback persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'cadence', label: 'rotation cadence', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  { id: 'saturation', label: 'color saturation', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'nebula', label: 'exterior nebula glow', min: 0.3, max: 2, step: 0.05, default: 1 },
];

// --- Song genome (JS-side) --------------------------------------------

/** splitmix64-style avalanche of a 32-bit-ish key into [0,1). Operates on
 * doubles but mixes enough bits for stable, well-spread scalars. */
function splitmix(key: number): () => number {
  let state = (key >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

/** Six stable scalars in [0,1] hashed from a seed key (trackId or frozen
 * pseudo-seed). Discrete/structural genome: C anchor + radius, palette,
 * fold, trap mix, kali flavour, center offset, drift phase. */
interface SeedGenome {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
}

function hashSeed(key: number): SeedGenome {
  const next = splitmix(Math.round(key));
  return { s0: next(), s1: next(), s2: next(), s3: next(), s4: next(), s5: next() };
}

/** Dominant audible deck's trackId (highest level); null when unknown. */
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

/** The parameter-plane point C for a genome. UNCHANGED from g03: C is
 * CONSTRAINED to the visually DENSE annulus |C| in [0.70, 0.85] with a
 * seeded angle. The seed picks the angle (distinct anatomy per song) and
 * stats only WANDER the angle + nudge the radius within the annulus; the
 * composite radius is hard-clamped so no stat stack can dust it out. The
 * `phase` argument is now the PHRASE-QUANTIZED drift + section jump (glacial
 * driver below), not a continuous per-frame drift. */
function computeC(
  g: SeedGenome,
  stats: { centroid: number; spread: number; flatness: number; energy: number },
  phase: number
): [number, number] {
  const anchorAngle = g.s0 * Math.PI * 2;
  // Angle wanders with the mix; the DENSE annulus is fixed.
  const theta = anchorAngle + phase + (stats.centroid - 0.5) * 0.9 + (g.s5 - 0.5) * 0.6;
  // Radius stays inside [0.70, 0.85]: seed picks a base within the band,
  // spread/energy nudge it, then clamp so it can never leave the annulus.
  const baseRadius = 0.72 + 0.1 * g.s1;
  const radiusNudge = (stats.spread - 0.5) * 0.04 + (stats.energy - 0.5) * 0.03;
  const radius = Math.min(0.85, Math.max(0.7, baseRadius + radiusNudge));
  let cx = radius * Math.cos(theta);
  let cy = radius * Math.sin(theta);
  // Flatness jitters C slightly off the arc (granular vs clean) — kept tiny
  // and bounded so it stays inside the dense region.
  cx += (stats.flatness - 0.5) * 0.012;
  cy += (g.s4 - 0.5) * 0.012;
  return [cx, cy];
}

const g04JuliaGlacialPreset: VisualizerPreset = {
  id: 'g04-julia-glacial',
  name: 'g04 julia-glacial',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // Slow-stat EMAs — taus LENGTHENED (~24 s) so material evolves over a
    // passage, not a phrase. Part of the 3–4x deceleration.
    let emaCentroid = 0.5;
    let emaSpread = 0.5;
    let emaFlatness = 0.5;
    let emaEnergy = 0;
    let emaBpm = 0;
    let statsPrimed = false;
    // C easing state.
    let curC: [number, number] = [-0.4, 0.6];
    let targetC: [number, number] = [-0.4, 0.6];
    // Genome / identity.
    let seededKey: number | null = null;
    let genome: SeedGenome = hashSeed(1);
    // Rebirth + regime smoothing.
    let rebirth = 0;
    let lastTrackId: number | null = null;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    // Cadence clocks (advanced glacially; the drop lever adds temporary speed).
    let rot = 0;
    let zoomPhase = 0;
    // ---- PHRASE-LOCK state. C holds a pose per bar and steps ONE ease to
    // the next bar's genome point. We latch the bar index and, on each new
    // bar, compute a fresh quantized phase (small nudge / bigger at phrases /
    // dramatic at sections). barStepTau is set per-tier so the ease within a
    // bar is proportionate to the step size.
    let lastBarIndex = -1;
    let barPhaseAccum = 0; // the quantized drift phase, advanced one step/bar
    let barStepTau = 6; // ease time constant for the current step (s)

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        // --- Slow stats: EMA tau ~24 s (was 15 — lengthened for glacial).
        const energy = energyOf(frame.bands);
        const bpm = frame.beat?.bpm ?? 0;
        const slowAlpha = 1 - Math.exp(-dt / 24);
        emaCentroid += (frame.centroid - emaCentroid) * slowAlpha;
        emaSpread += (frame.spread - emaSpread) * slowAlpha;
        emaFlatness += (frame.flatness - emaFlatness) * slowAlpha;
        emaEnergy += (energy - emaEnergy) * slowAlpha;
        if (bpm > 0) emaBpm += (bpm - emaBpm) * slowAlpha;
        statsPrimed = true;

        // --- Identity + rebirth. Dominant trackId seeds the genome; a
        // change stages re-genesis. No trackId => freeze the slow stats as
        // a pseudo-seed (stable while the mix's character holds).
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round(
                (emaCentroid * 4096 + emaSpread * 811 + emaFlatness * 173 + emaEnergy * 97) * 131
              );
        if (seededKey == null) {
          seededKey = key;
          genome = hashSeed(key);
          lastTrackId = trackId;
        } else if (trackId != null && trackId !== lastTrackId) {
          // Track change = REBIRTH: re-seed, ease C to the new genome over
          // ~3 s (glacial), fire the shockwave.
          seededKey = key;
          genome = hashSeed(key);
          lastTrackId = trackId;
          rebirth = 1;
        }
        rebirth = Math.max(0, rebirth - dt / 3);

        // --- Regime split (smoothed ~0.35 s; taste calibration). This is the
        // ONLY speed lever: smoothDrop rises when the drop hits and settles as
        // the excitement plateau fades.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, energy * 1.4);

        // --- GLOBAL MOTION SCALAR. Base is glacial (~0.28); the drop lifts it
        // toward ~1.0 temporarily, then it settles with smoothDrop. Sustain
        // adds a touch so a loud-but-not-dropping passage still drifts. This
        // single scalar is handed to the shader (u_slow) AND scales every
        // JS-side clock, so "speed only rises when the music demands it".
        const motion = 0.28 + 0.85 * smoothDrop + 0.18 * sustained + 0.35 * rebirth;

        // --- Bar/phrase/section tiers. barIndex quantizes C evolution; the
        // section (every 32 bars) is theatre.
        const barIndex = frame.beat?.barIndex ?? 0;
        const barPhase = frame.beat?.barPhase ?? 0;
        const beatRate = emaBpm > 0 ? emaBpm / 60 : 2;

        // --- PHRASE-LOCKED C STEP. On each NEW bar, advance the quantized
        // drift phase ONE step, tiered by where the bar sits:
        //   ordinary bar        -> small nudge
        //   phrase bar (%8==0)   -> bigger, deliberate step
        //   section bar (%32==0) -> dramatic jump along the orbit
        // The step direction is seeded per-bar so the walk isn't monotonic.
        if (barIndex !== lastBarIndex) {
          lastBarIndex = barIndex;
          const isPhrase = barIndex % 8 === 0;
          const isSection = barIndex % 32 === 0;
          const barSeed = hashSeed((seededKey ?? 1) + barIndex * 2654435761);
          const dir = barSeed.s0 < 0.5 ? -1 : 1;
          if (isSection) {
            // Dramatic jump: a big stepped offset seeded per-section, plus a
            // signed leap so the anatomy visibly reconfigures. Ease is quick
            // (theatre) but still ~2 s, not instant.
            const sectionJump = hashSeed((seededKey ?? 1) + Math.floor(barIndex / 32) * 1013).s0;
            barPhaseAccum += dir * (0.9 + 0.6 * sectionJump);
            barStepTau = 2.0;
          } else if (isPhrase) {
            // Bigger deliberate step at phrase boundaries.
            barPhaseAccum += dir * (0.18 + 0.14 * barSeed.s1);
            barStepTau = 3.5;
          } else {
            // Ordinary bar: the annulus barely turns.
            barPhaseAccum += dir * (0.05 + 0.05 * barSeed.s2);
            barStepTau = 6.0;
          }
        }

        // --- Target C from genome + slow stats + the QUANTIZED phrase phase.
        // No continuous per-frame drift term: at rest C holds its bar pose.
        const stats = {
          centroid: emaCentroid,
          spread: emaSpread,
          flatness: emaFlatness,
          energy: emaEnergy,
        };
        targetC = computeC(genome, stats, barPhaseAccum);
        // Ease C toward the bar's target. The per-tier barStepTau sets the
        // pace; rebirth overrides with a fast (~2 s) morph; the drop lets C
        // settle a bit quicker (music demands motion). Otherwise glacial.
        const easeTau = rebirth > 0.05
          ? 2 * (1 - 0.6 * rebirth) + 0.5
          : barStepTau * (1 - 0.4 * smoothDrop);
        const cAlpha = 1 - Math.exp(-dt / Math.max(0.4, easeTau));
        curC = [curC[0] + (targetC[0] - curC[0]) * cAlpha, curC[1] + (targetC[1] - curC[1]) * cAlpha];

        // --- Cadence: bpm-locked rotation + zoom breathing, but scaled by the
        // global motion scalar so they're glacial at rest and only quicken on
        // the drop. (g03 constants were ~0.12 / 0.06; here ~0.35x of that at
        // base, lifting toward g03-ish speed on a hard drop.)
        const cadence = frame.params.cadence ?? 1;
        rot += dt * beatRate * 0.12 * cadence * motion;
        zoomPhase += dt * beatRate * 0.06 * cadence * motion;
        const zoomRange = frame.params.zoomRange ?? 1;
        // Base breathing + drop magnification punch + kick micro-pulse. The
        // sinusoid amplitude is unchanged; only its RATE (via zoomPhase) slows.
        const zoom =
          1 +
          0.18 * zoomRange * Math.sin(zoomPhase) +
          0.5 * smoothDrop +
          0.9 * frame.impulse.low * (0.5 + 0.5 * smoothDrop) +
          0.6 * rebirth -
          0.15 * smoothBuildup;

        // --- Phrase evolution: last-bar anticipation tightens the trap
        // radius and lifts iteration weight; sections widen briefly.
        const phraseBar = barIndex % 8;
        const anticipation = phraseBar === 7 ? barPhase : 0;
        const trapDetail = frame.params.trapDetail ?? 1;
        // trapRad: buildups + anticipation TIGHTEN (tension), drop BLOOMS.
        const trapRad =
          0.5 * trapDetail * (1 + 0.6 * smoothDrop - 0.35 * smoothBuildup - 0.3 * anticipation);
        const iterGain = 0.4 + 0.5 * sustained + 0.6 * smoothBuildup + 0.4 * anticipation;

        // --- Feedback persistence (chroma-preserving upstream). Slightly
        // HIGHER base decay so the slower field trails longer (glacial smear).
        const persistence = frame.params.persistence ?? 1;
        const baseDecay = 0.992 - 0.005 * emaEnergy - 0.008 * smoothBuildup;
        const decay = Math.min(0.997, 1 - (1 - baseDecay) / persistence);

        // --- Saturation: buildups saturate, drops stay saturated; slider on top.
        const saturation = frame.params.saturation ?? 1;
        const sat = saturation * (0.85 + 0.6 * smoothBuildup + 0.35 * smoothDrop + 0.2 * sustained);

        // --- Spectral tilt (nebula lighting): bright-vs-dark balance from the
        // 24-band spectrum. Low half vs high half of the spectrum.
        let tilt = 0.5;
        const spec = frame.spectrum;
        if (spec.length > 1) {
          const mid = Math.floor(spec.length / 2);
          let lo = 0;
          let hi = 0;
          for (let i = 0; i < mid; i++) lo += spec[i];
          for (let i = mid; i < spec.length; i++) hi += spec[i];
          const tot = lo + hi;
          tilt = tot > 1e-4 ? hi / tot : 0.5;
        }

        // --- Exterior nebula brightness: sustain + overall spectrum energy so
        // the escape region answers to audio. Never zero (the floor handles
        // silence), but responsive.
        const nebulaSlider = frame.params.nebula ?? 1;
        const specEnergy = spec.length > 0 ? spec.reduce((a, b) => a + b, 0) / spec.length : 0;
        const nebula =
          nebulaSlider * (0.35 + 0.7 * sustained + 0.5 * Math.min(1, specEnergy * 2) + 0.4 * smoothDrop);

        // --- Guaranteed visual floor: a small always-on base that rises a
        // touch with slow energy so quiet passages still breathe but are never
        // black. Independent of the energy modulation that scales the field.
        const floor = 0.22 + 0.18 * emaEnergy;

        void statsPrimed;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: sustained,
          u_c: [curC[0], curC[1]] as [number, number],
          u_zoom: Math.max(0.35, zoom),
          u_rot: rot,
          // Kali flavour + fold count + trap mix + center from the seed.
          u_kali: genome.s2 > 0.5 ? 1 : 0,
          u_fold: 1 + Math.floor(genome.s3 * 5), // 1..5 rotational folds
          u_trapMix: 0.25 + 0.6 * genome.s1,
          u_trapRad: Math.max(0.08, trapRad),
          u_breadth: emaSpread,
          u_texture: emaFlatness,
          u_warm: emaCentroid,
          u_sat: sat,
          u_palette: genome.s0 * 3,
          u_iterGain: iterGain,
          u_decay: decay,
          u_rebirth: rebirth,
          u_center: (genome.s4 - 0.5) * 2,
          u_seed: genome.s5,
          u_nebula: nebula,
          u_tilt: tilt,
          u_floor: floor,
          u_slow: motion,
        };
      },
    });
  },
};

export default g04JuliaGlacialPreset;
