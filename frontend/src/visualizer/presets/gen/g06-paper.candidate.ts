/**
 * g06-paper — "Cut-Paper Theatre" (gen-6 NOVEL; sol-review concept).
 *
 * A clean-room retest of g04-story's narrative premise in a completely
 * different visual language. g04-story lost twice; the falsifiable question
 * (brief) is whether its weakness was the LOOK — glowing actors on a ring —
 * rather than the STORY. So this candidate keeps g04's five-act / four-phrase
 * scaffolding (establish → develop/pursuit → intensify/compression →
 * build → release) but DISCARDS the ring stage, the glow-core, and the
 * particle powder entirely. There is no orbit, no center-radial layout, no
 * bright object floating on a dark field.
 *
 * The world is a shadow-puppet / cut-paper stage seen from the front:
 *   - Layered PAPER SILHOUETTES stacked in depth, staged LATERALLY (stage
 *     left / stage right, near / far parallax planes), never radially.
 *   - The paper is DARK. Color lives ENTIRELY as saturated LIGHT BEHIND the
 *     paper (a backlit scrim). Strict contrast hierarchy: near-black cutouts
 *     read against a luminous, saturated backlight. This is the invariant.
 *   - LOWS carry a stable PROTAGONIST silhouette (a slow massive shape that
 *     holds the stage — the through-line of the story).
 *   - MIDS articulate JOINTS and SCENERY: secondary silhouette planes that
 *     slide and hinge (the "one readable action per phrase").
 *   - HIGHS cut PERFORATIONS — pinpricks of backlight punched THROUGH the
 *     paper (holes that let light leak, NOT confetti, NOT dust; they are
 *     fixed to the paper and gated on impulse.high so they read as cut
 *     detail rather than floating powder).
 *
 * Narrative grammar (fossil scaffold, re-expressed):
 *   Each FOUR-BAR phrase performs one readable action inside a 16-bar chapter:
 *     phrase 0  bars 0-3   REVEAL      — curtain lifts, protagonist alone.
 *     phrase 1  bars 4-7   PURSUIT     — a second silhouette enters stage
 *                                        left and travels across (lateral).
 *     phrase 2  bars 8-11  COMPRESSION — the depth planes crowd inward, the
 *                                        scene tightens between the layers.
 *     phrase 3  bars 12-15 RELEASE     — the central aperture tears open on
 *                                        the drop into a broad backlit world.
 *   Actions cross-fade at phrase boundaries so the story flows, never cuts.
 *
 * Song genome (trackId hash, g02 pattern): six stable scalars pick the
 * SILHOUETTE FAMILY (organic ridges vs architectural steps vs botanical
 * fronds vs figure), the scenery vocabulary, the staging DIRECTION (which
 * way pursuit travels), the layer count, and the backlight palette family.
 * Same song → same theatre every play; a new dominant trackId eases the
 * genome across a CURTAIN WIPE (a horizontal occluding sweep, never a flash).
 *
 * Dynamics ride max(smoothed-drop, energy) so a quiet section plays its
 * story in whispers (few layers, dim scrim) and a hard section plays it at
 * full backlight. Buildup rapidly shifts the backlight HUE through the
 * cutouts while the scenery keeps moving (tense-but-alive). The drop tears
 * the central aperture open on max(drop, energy). Section boundaries are a
 * continuous CURTAIN WIPE / slow occlusion — never a flash.
 *
 * Assigned tech: phrase/section tiers via `beat.ladderBarIndex ??
 * beat.barIndex` (primary dramatic clock); trackId genome; per-band impulses
 * (kick = stage impact / aperture punch, mid = scenery articulation, high =
 * perforations); trend (bass-weighted smoothed drop, derived JS-side — the
 * frame has no `drop` field). No feedback needed; the paper is redrawn each
 * frame, so there are no trails to smear.
 *
 * Safety: photosensitivity floor — the only near-full-field envelope is the
 * curtain-wipe backlight lift, which is a SLOW smoothed occlusion (tau ~0.5 s
 * rise), rate-limited by the section clock, never a strobe and never
 * saturated-red-flashing. Kick stage-impacts are localized bounded pulses.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type {
  PresetParam,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

// --- GLSL ---------------------------------------------------------------
// GLSL ES 1.0. NO backticks in this string. All loops are constant-bound.
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low: stage impact / aperture punch
uniform float u_articulate;  // impulse.mid: scenery joints
uniform float u_perf;        // impulse.high: perforation intensity
uniform float u_drop;        // bass-weighted smoothed drop (JS-derived)
uniform float u_buildup;     // smoothed excitement WITHOUT bass
uniform float u_drama;       // max(drop, energy), smoothed: the volume knob
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
// narrative clock
uniform float u_phase;       // continuous position within the 16-bar chapter, 0..1
uniform float u_reveal;      // phrase-0 action weight
uniform float u_pursuit;     // phrase-1 action weight
uniform float u_compress;    // phrase-2 action weight
uniform float u_release;     // phrase-3 action weight
uniform float u_barPhase;    // 0..1 within the current bar (breathing)
// genome
uniform float u_family;      // silhouette family 0..3 (continuous morph)
uniform float u_scenery;     // scenery vocabulary 0..1
uniform float u_dir;         // staging direction: -1 or +1 (pursuit travel)
uniform float u_layers;      // layer count target (continuous)
uniform float u_palette;     // backlight palette family 0..3
uniform float u_hueTravel;   // slow + buildup hue travel
// transitions
uniform float u_curtain;     // 0..1 curtain-wipe position (section occlusion)
uniform float u_curtainDir;  // wipe direction
uniform float u_aperture;    // central aperture opening 0..1 (release/drop)

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = p * 2.03 + vec2(19.1, 7.7);
    a *= 0.5;
  }
  return v;
}

// iq cosine palettes — bright, saturated (this repo dislikes pastels). These
// are the BACKLIGHT colors; the paper stays dark, so full saturation reads.
vec3 pal0(float t) { return vec3(0.55, 0.15, 0.35) + vec3(0.5, 0.45, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.9) * t + vec3(0.0, 0.18, 0.42))); }
vec3 pal1(float t) { return vec3(0.15, 0.45, 0.55) + vec3(0.45, 0.5, 0.5) * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.1, 0.32, 0.55))); }
vec3 pal2(float t) { return vec3(0.6, 0.4, 0.1) + vec3(0.5, 0.45, 0.35) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.14, 0.28))); }
vec3 pal3(float t) { return vec3(0.35, 0.15, 0.55) + vec3(0.5, 0.4, 0.5) * cos(6.28318 * (vec3(1.0, 0.8, 1.0) * t + vec3(0.2, 0.05, 0.55))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  // centroid biases temperature, but wide phase already lives in t.
  c += vec3(0.12, 0.02, -0.07) * (u_centroid - 0.5) * 1.3;
  return c;
}

// Silhouette height profile at horizontal position x (in [-aspect/2..]) for a
// given family. Returns the TOP EDGE height (paper occupies y below it). The
// families give band identity to the SHAPE (color is free to travel).
float familyProfile(float x, float seedPhase, float fam, float breath) {
  // fam 0: organic rolling ridges (fbm hills)
  float ridges = fbm(vec2(x * 1.1 + seedPhase, 3.7)) * 0.9;
  // fam 1: architectural stepped skyline (quantized)
  float stepped = floor(fbm(vec2(x * 0.8 + seedPhase, 11.3)) * 5.0) / 5.0 * 0.85 + 0.1;
  // fam 2: botanical fronds (stacked sine fingers)
  float fronds = 0.35 + 0.35 * abs(sin(x * 3.3 + seedPhase * 2.0))
    + 0.15 * abs(sin(x * 7.1 - seedPhase));
  // fam 3: a reclining figure profile (broad hump + shoulder)
  float figure = 0.5 + 0.32 * exp(-x * x * 0.7) + 0.12 * exp(-(x - 0.6) * (x - 0.6) * 6.0);
  float p01 = mix(ridges, stepped, clamp(fam, 0.0, 1.0));
  p01 = mix(p01, fronds, clamp(fam - 1.0, 0.0, 1.0));
  p01 = mix(p01, figure, clamp(fam - 2.0, 0.0, 1.0));
  // subtle bar-locked breathing so the paper is alive, not a frozen loop.
  return p01 * (0.9 + 0.1 * breath);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  // stage coordinate: x centered & aspect-corrected, y from stage floor (0)
  // to fly-loft (1). Lateral staging lives entirely in x.
  vec2 sc = vec2((uv.x - 0.5) * aspect, uv.y);

  // ---- BACKLIGHT SCRIM ------------------------------------------------
  // A saturated, luminous field behind all paper. Brighter toward a warm
  // "footlight" band near the stage floor, cooler up high — a lit scrim.
  float scrimT = u_hueTravel + sc.y * 0.35 + sc.x * 0.05 + u_time * 0.01;
  vec3 back = palette(scrimT);
  // a soft luminous gradient: footlight glow near the floor, dimmer aloft.
  float footlight = exp(-abs(sc.y - 0.12) * 2.2);
  float loftFall = mix(0.55, 1.0, smoothstep(0.0, 0.8, sc.y));
  float scrimLum = (0.35 + 0.65 * u_drama) * (0.6 + 0.8 * footlight) * loftFall;
  // buildup rapidly shifts backlight hue while scenery keeps moving.
  back = palette(scrimT + u_buildup * 0.5);
  back *= scrimLum * (0.7 + 0.6 * u_buildup);
  // central aperture: the release tears a broad bright world open. A soft
  // oval of extra backlight blooming from an OFF-floor centre.
  vec2 apC = vec2(0.0, 0.42);
  float apR = 0.05 + u_aperture * (0.55 + 0.25 * u_drama);
  float apMask = smoothstep(apR, apR * 0.4, length((sc - apC) * vec2(0.85, 1.15)));
  vec3 apCol = palette(scrimT + 0.4 + 0.2 * u_drop);
  back += apCol * apMask * u_aperture * (1.1 + 0.9 * u_drama);

  // ---- PAPER LAYERS ---------------------------------------------------
  // Stack N depth planes from far (dim, high on stage, slow) to near (dark,
  // low, fast parallax). Each is a dark silhouette that OCCLUDES backlight.
  // We composite front-to-back-ish by tracking how much backlight survives.
  vec3 col = back;
  const int MAX_LAYERS = 5;
  float activeLayers = clamp(u_layers, 1.0, float(MAX_LAYERS));

  // pursuit traveller offset (lateral): a silhouette crossing the stage.
  float travel = u_dir * (u_pursuit * (sc.x * 0.0 + 1.0)) * mix(-0.9, 0.9, u_barPhase * u_pursuit + 0.5 * u_pursuit);

  for (int L = 0; L < MAX_LAYERS; L++) {
    float li = float(L);
    if (li >= activeLayers) break;
    float depth = li / max(1.0, activeLayers - 1.0); // 0 far .. 1 near
    float seedPhase = li * 1.7 + u_scenery * 3.0;

    // Parallax: near planes slide more with the scene's lateral motion.
    // COMPRESSION crowds the planes' horizontal scale inward.
    float parallax = mix(0.15, 0.7, depth);
    float compressScale = 1.0 - u_compress * 0.35 * depth;
    float lx = (sc.x) / max(0.2, compressScale)
      + travel * parallax
      + sin(u_time * (0.1 + 0.15 * depth) + seedPhase) * (0.05 + 0.1 * u_articulate);

    // Per-layer silhouette top edge. The FAR plane is the protagonist
    // (low-band mass, stable); nearer planes are scenery/joints (mid).
    float protagonist = (li < 0.5) ? 1.0 : 0.0;
    float breath = sin(u_barPhase * 6.28318 + li) * (0.5 + 0.5 * u_low);
    float baseTop = familyProfile(lx, seedPhase, u_family, breath);

    // protagonist mass rides the lows; scenery articulation rides the mids.
    float mass = protagonist > 0.5
      ? (0.34 + 0.30 * u_low + 0.10 * u_kick)
      : (0.20 + 0.18 * depth + 0.16 * u_mid * u_articulate);
    // reveal raises the far protagonist first (curtain lifts on it alone);
    // pursuit brings in the traveller plane; compression lifts inner planes.
    float presence = protagonist > 0.5
      ? (0.4 + 0.6 * u_reveal + 0.4 * u_drama)
      : (li < 1.5 ? u_pursuit : (0.3 * u_compress + 0.25 * u_drama)) ;
    float top = baseTop * mass * (0.5 + 0.9 * presence) + 0.04;

    // paper occupancy: 1 where this plane's dark paper covers the pixel.
    // Soft edge for anti-alias; a hair of translucency at the very edge so
    // it reads as backlit paper, not a hard vector cut.
    float edge = 0.006 + 0.01 * depth;
    float paper = smoothstep(top + edge, top - edge, sc.y);
    if (paper <= 0.001) continue;

    // ---- PERFORATIONS: pinpricks of backlight punched THROUGH the paper.
    // Fixed to the paper (a stable lattice in layer-local coords), gated on
    // impulse.high so they read as cut detail, NOT floating confetti.
    vec2 perfCoord = vec2(lx * 18.0 + seedPhase * 5.0, sc.y * 22.0);
    vec2 pcell = floor(perfCoord);
    vec2 pf = fract(perfCoord) - 0.5;
    float perfLit = step(0.62, hash21(pcell + li * 3.1)); // sparse holes
    float perfDot = smoothstep(0.34, 0.16, length(pf));
    // holes twinkle with a per-hole phase but never move; high energy widens
    // and brightens the leak. Perforation lets the scrim show through.
    float perfPhase = 0.6 + 0.4 * sin(u_time * 3.0 + hash21(pcell) * 20.0);
    float perforation = perfLit * perfDot * perfPhase
      * (0.15 + 1.4 * u_perf + 0.4 * u_high) * (0.4 + 0.6 * depth);

    // dark paper color: nearly black, faintly tinted by the depth (near
    // planes coldest/darkest → strict contrast hierarchy vs the scrim).
    vec3 paperCol = mix(vec3(0.03, 0.03, 0.05), vec3(0.005, 0.005, 0.01), depth);

    // The pixel behind the paper is the current backlight (col). Perforation
    // lets that light leak through the paper; otherwise the paper occludes.
    float leak = clamp(perforation, 0.0, 1.0);
    vec3 behind = col;
    // rim of backlight bleeding around the silhouette's top edge (a thin
    // luminous halo where paper meets light — reinforces legibility).
    float rim = smoothstep(top + edge * 3.0, top, sc.y) - smoothstep(top, top - edge * 3.0, sc.y);
    vec3 rimCol = palette(scrimT + 0.15 + depth * 0.1) * (0.6 + 0.8 * u_drama);
    vec3 papered = mix(paperCol, behind, leak) + rimCol * max(0.0, rim) * (0.5 + 0.5 * paper);

    col = mix(col, papered, paper);
  }

  // ---- KICK STAGE IMPACT ----------------------------------------------
  // A SOLID bounded response: on the kick the whole stage floor flexes — a
  // low horizontal band of extra footlight rises briefly. Localized (near
  // the floor), not a full-field flash.
  float impactBand = exp(-abs(sc.y - 0.06) * (6.0 - 3.0 * u_kick));
  col += palette(u_hueTravel + 0.05) * impactBand * u_kick * (0.5 + 0.9 * u_low) * 0.7;

  // ---- CURTAIN WIPE (section boundary) --------------------------------
  // A continuous horizontal occlusion sweeping across the stage: a dark
  // curtain edge with a luminous leading rim carries the new chapter in.
  // Slow (JS-smoothed) — never a flash.
  if (u_curtain > 0.001 && u_curtain < 0.999) {
    float edgeX = mix(-aspect * 0.6, aspect * 0.6, u_curtain);
    float sx = (sc.x - edgeX) * u_curtainDir;
    float behindCurtain = smoothstep(0.0, -0.02, sx); // fully occluded side
    float rimGlow = exp(-abs(sx) * 14.0);
    vec3 curtainCol = vec3(0.01, 0.01, 0.015);
    vec3 rimC = palette(u_hueTravel + 0.5) * (0.8 + 0.7 * u_drama);
    col = mix(col, curtainCol, behindCurtain);
    col += rimC * rimGlow * 0.9;
  }

  // gentle paper grain (flatness → material: noisy sound = grainier paper),
  // applied only faintly so contrast survives. Not particles.
  float grain = (fbm(sc * (30.0 + 60.0 * u_flatness) + u_time * 0.2) - 0.5);
  col += grain * (0.01 + 0.03 * u_flatness) * clamp(col, 0.0, 1.0);

  // ---- Chroma-preserving soft knee (never per-channel clamp) ----------
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.9) {
    col *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

// --- Song genome (JS-side, g02 pattern) --------------------------------

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

interface Genome {
  family: number; // 0..3 silhouette family
  scenery: number; // 0..1 scenery vocabulary
  dir: number; // -1 | +1 staging direction
  layers: number; // 1..5 layer count
  palette: number; // 0..3 backlight palette
  driftPhase: number; // slow hue drift start
}

function hashGenome(key: number): Genome {
  const next = splitmix(Math.round(key));
  return {
    family: next() * 3,
    scenery: next(),
    dir: next() > 0.5 ? 1 : -1,
    layers: 2 + Math.floor(next() * 3.999), // 2..5
    palette: next() * 3,
    driftPhase: next() * 6.28318,
  };
}

function dominantTrackId(frame: VisualizerFrameData): number | null {
  // dominant: smoothed frame.dominantChannel (layering jitter fix)
  const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (dom && dom.trackId != null) return dom.trackId;
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

/** Smoothstep 0→1. */
function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

const params: PresetParam[] = [
  { id: 'layers', label: 'depth layers', min: 1, max: 5, step: 1, default: 4 },
  { id: 'backlight', label: 'backlight intensity', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'perforation', label: 'perforation cut detail', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'palette', label: 'backlight palette (rose→teal→amber→violet)', min: -1, max: 3, step: 0.05, default: -1 },
  { id: 'aperture', label: 'release aperture size', min: 0.3, max: 2, step: 0.05, default: 1 },
];

const g06PaperPreset: VisualizerPreset = {
  id: 'g06-paper',
  name: 'g06 paper',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // identity / genome (with curtain-wipe easing)
    let seededKey: number | null = null;
    let curGenome: Genome = hashGenome(1);
    let prevGenome: Genome = curGenome;
    let targetGenome: Genome = curGenome;
    let lastTrackId: number | null = null;
    let wipeT = 1; // 1 = settled; <1 = mid curtain wipe
    let wipeDir = 1;
    // dynamics
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let drama = 0;
    let hueTravel = 0;
    let sCentroid = 0.5;
    let sSpread = 0.5;
    let sFlatness = 0.5;
    // narrative clock
    let curtain = 1; // section curtain-wipe position (1 = settled)
    let curtainDir = 1;
    let lastSection = -1;
    let aperture = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: false,
      uniforms: (frame) => {
        const dt =
          lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);

        // slow spectral stats.
        const slowA = 1 - Math.exp(-dt / 8);
        sCentroid += (frame.centroid - sCentroid) * slowA;
        sSpread += (frame.spread - sSpread) * slowA;
        sFlatness += (frame.flatness - sFlatness) * slowA;

        // --- Identity + curtain-wipe on track change (g02 pattern) --------
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round(sCentroid * 733 + sSpread * 971 + sFlatness * 613 + 1);
        if (seededKey == null) {
          seededKey = key;
          curGenome = hashGenome(key);
          prevGenome = curGenome;
          targetGenome = curGenome;
          lastTrackId = trackId;
          wipeT = 1;
        } else if (trackId != null && trackId !== lastTrackId) {
          prevGenome = curGenome;
          targetGenome = hashGenome(key);
          lastTrackId = trackId;
          seededKey = key;
          wipeT = 0; // start a curtain wipe to the new chapter's world
          wipeDir = targetGenome.dir;
        }
        // ease the wipe (slow occlusion, never a flash).
        if (wipeT < 1) wipeT = Math.min(1, wipeT + dt / 1.4);
        const wipeEase = smoothstep01(wipeT);
        // interpolate the genome across the wipe.
        curGenome = {
          family: prevGenome.family + (targetGenome.family - prevGenome.family) * wipeEase,
          scenery: prevGenome.scenery + (targetGenome.scenery - prevGenome.scenery) * wipeEase,
          dir: wipeEase < 0.5 ? prevGenome.dir : targetGenome.dir,
          layers: prevGenome.layers + (targetGenome.layers - prevGenome.layers) * wipeEase,
          palette: prevGenome.palette + (targetGenome.palette - prevGenome.palette) * wipeEase,
          driftPhase: targetGenome.driftPhase,
        };
        // wipe curtain position: sweeps across then settles.
        const trackWipe = wipeT < 1 ? wipeT : 1;

        // --- Regime split: bass-weighted smoothed drop (no `drop` field) ---
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rA = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rA;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rA;
        // the story's volume knob: ride max(drop, energy), smoothed.
        const demand = Math.max(energy, smoothDrop * 0.9 + energy * 0.4);
        drama += (Math.min(1, demand) - drama) * Math.min(1, dt * 3.0);

        // --- Narrative clock: phrase/section from the ladder ---------------
        const beat = frame.beat;
        const ladderBar = beat ? beat.ladderBarIndex ?? beat.barIndex : null;
        const hasGrid = beat != null && ladderBar != null;
        const barPhase = beat?.barPhase ?? 0;
        const barInChapter = hasGrid ? ((ladderBar % 16) + 16) % 16 : 0;
        const phasePos = hasGrid ? (barInChapter + barPhase) / 16 : 0;
        // gridless drift: a gentle self-running chapter so there is always a
        // story even without a grid.
        const chapterPos = hasGrid ? phasePos : (frame.time * 0.03) % 1;

        // section rollover → curtain wipe (chapter boundary).
        if (hasGrid) {
          const section = Math.floor(ladderBar / 16);
          if (lastSection >= 0 && section !== lastSection) {
            curtain = 0; // begin a fresh curtain wipe
            curtainDir = ((section % 2) === 0 ? 1 : -1) * curGenome.dir;
          }
          lastSection = section;
        }
        // advance / settle the section curtain (slow occlusion).
        if (curtain < 1) curtain = Math.min(1, curtain + dt / 1.1);
        // when a track-change wipe is running it overrides the section one.
        const curtainOut = wipeT < 1 ? trackWipe : curtain;
        const curtainDirOut = wipeT < 1 ? wipeDir : curtainDir;

        // --- Act / phrase weights (four four-bar phrases, cross-faded) -----
        // continuous chapter position b in 0..16.
        const b = chapterPos * 16;
        const reveal = 1 - smoothstep01((b - 3) / 1.5);
        const pursuit = smoothstep01((b - 3) / 1.5) * (1 - smoothstep01((b - 7.5) / 1.5));
        const compress = smoothstep01((b - 7) / 1.5) * (1 - smoothstep01((b - 11.5) / 1.5));
        const release = smoothstep01((b - 11) / 1.5);

        // aperture opens on RELEASE, torn wide on the drop (max(drop,energy)).
        const apParam = frame.params.aperture ?? 1;
        const apTarget = release * (0.35 + 0.65 * drama) * apParam;
        aperture += (apTarget - aperture) * (1 - Math.exp(-dt / 0.4));

        // hue travel: slow always; buildup accelerates it (tense-but-alive).
        hueTravel += dt * (0.03 + 0.02 * frame.bands.high) + dt * 0.5 * smoothBuildup;
        const hueOut = curGenome.driftPhase / 6.28318 + hueTravel + sCentroid * 0.2;

        // --- params -------------------------------------------------------
        const layersP = frame.params.layers ?? 4;
        const backlightP = frame.params.backlight ?? 1;
        const perfP = frame.params.perforation ?? 1;
        const paletteP = frame.params.palette ?? -1;

        const paletteOut = paletteP >= 0 ? paletteP : curGenome.palette;
        // clamp declared layer count to the shader's MAX_LAYERS (5).
        const layerCount = Math.min(5, Math.max(1, Math.min(layersP, curGenome.layers)));

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_articulate: frame.impulse.mid,
          u_perf: frame.impulse.high * perfP,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_drama: drama * backlightP,
          u_centroid: sCentroid,
          u_spread: sSpread,
          u_flatness: sFlatness,
          u_phase: chapterPos,
          u_reveal: reveal,
          u_pursuit: pursuit,
          u_compress: compress,
          u_release: release,
          u_barPhase: barPhase,
          u_family: curGenome.family,
          u_scenery: curGenome.scenery,
          u_dir: curGenome.dir,
          u_layers: layerCount,
          u_palette: paletteOut,
          u_hueTravel: hueOut,
          u_curtain: curtainOut,
          u_curtainDir: curtainDirOut,
          u_aperture: aperture,
        };
      },
    });
  },
};

export default g06PaperPreset;
