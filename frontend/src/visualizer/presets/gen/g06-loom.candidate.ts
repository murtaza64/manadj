/**
 * g06-loom (gen-6 NOVEL — sol-review concept "Kinetic Loom").
 *
 * A woven FABRIC, not a spectrum bar chart. The 24-band spectrum are WARP
 * threads strung diagonally across the frame; three broad low/mid/high WEFT
 * families cross them laterally. Band identity lives in THREAD CLASS and
 * GEOMETRY, never in brightness:
 *
 *   - lows  = thick load-bearing CORDS (few, wide, slow, heavy sag)
 *   - mids  = woven RIBBONS (medium count, braided cross-weave)
 *   - highs = hairline FILAMENTS (many, taut, fine iridescent shimmer)
 *
 * Each band's live value changes the thread's TENSION and CURVATURE — a loud
 * band pulls its thread taut and straight and thick; a quiet band lets it sag
 * and thin. Brightness barely moves with level; the eye reads the WEAVE.
 *
 * Meter / dynamics:
 *   - KICK = one solid YANK of the whole loom frame (a lateral shear of the
 *     fabric) plus a COMPRESSION KINK that travels down the cords, lighting
 *     what it passes. Gated on impulse.low so it never reads as "kick powder".
 *   - snare/hat SHED mid/high FIBERS only (brief filament flares), never the
 *     cords.
 *   - phrase (ladder tier) weaves DENSER and more KNOTTED toward the boundary.
 *   - buildup pulls the whole fabric TAUT while color races along it.
 *   - drop releases a large PERSISTENT FOLD riding max(drop, energy).
 *   - section boundary changes WEAVE TOPOLOGY: plain / twill / braid / mesh.
 *
 * trackId hashes to a stable MOTIF genome (weave lean, warp skew, palette
 * phase) so a song always weaves a recognizable cloth; a track change stages
 * a visible re-thread.
 *
 * Composition is LATERAL/DIAGONAL — no centered radial glow, no starfield,
 * no tunnel, no dust medium. Persistence via feedback with a chroma-
 * preserving soft knee. Photosensitivity floor: no full-field strobe (the
 * kick yank is a localized shear + traveling kink, rate-limited).
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const SPECTRUM_BANDS = 24;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_centroid;
uniform float u_drop;        // bass-weighted excitement (smoothed)
uniform float u_buildup;     // excitement without bass (tautness)
uniform float u_phrase;      // 0 phrase start .. 1 approaching boundary
uniform float u_section;     // section-change pulse 0..1 (decays)
uniform float u_topology;    // 0 plain, 1 twill, 2 braid, 3 open mesh (blended)
uniform float u_decay;
uniform float u_seed;
uniform float u_shearAge;    // seconds since last kick yank
uniform float u_shearAmp;    // that yank's strength
uniform float u_fold;        // persistent drop fold amount (rides max(drop,energy))
uniform float u_foldPhase;   // slow travel of the fold band
uniform float u_weave;       // weave density slider
uniform float u_threadGain;  // thread brightness slider
uniform float u_skew;        // genome warp skew
uniform float u_palPhase;    // genome palette phase
uniform float u_spectrum[24];

const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Bright, fully saturated traveling palette (no pastels). Wide phase span so
// color TRAVELS along the cloth rather than mapping to level.
vec3 cloth(float t) {
  return vec3(0.5) + vec3(0.5) * cos(TWO_PI * (vec3(1.0, 0.9, 0.75) * t
    + vec3(0.0, 0.33, 0.66) + u_palPhase));
}

// Constant-loop lookup (GLSL ES 1.0 forbids dynamic indexing).
float specAt(int idx) {
  float v = 0.0;
  for (int k = 0; k < 24; k++) {
    if (k == idx) v = u_spectrum[k];
  }
  return v;
}

// One warp thread's contribution. wx = the thread's home x in [0,1]; cls
// selects class geometry (0 cord, 1 ribbon, 2 filament). Returns coverage
// and writes the traveling color into col.
float warpThread(vec2 p, float wx, float lvl, int cls, float t, out vec3 col) {
  // Diagonal skew so threads run corner-to-corner, not straight up-down.
  float skew = u_skew * (p.y - 0.5);
  float baseX = wx + skew;

  // TENSION: loud band => taut & straight; quiet band => slack & wandering.
  // Curvature amplitude falls with level (geometry response, not luminance).
  float tension = 0.15 + 0.85 * lvl;
  float slack = (1.0 - tension);

  // CURVATURE: the band value bends the thread. Class sets the wobble grain.
  float classFreq = cls == 0 ? 2.2 : (cls == 1 ? 4.5 : 9.0);
  float wob = slack * (0.10 + 0.06 * u_mid) * sin(p.y * classFreq * TWO_PI
      + t * (0.5 + float(cls) * 0.4) + wx * 9.0);
  // Weft cross-weave: the thread ducks over/under the lateral wefts. Topology
  // morphs the interleave (plain even, twill sheared, braid doubled, mesh gaps).
  float weftN = mix(6.0, 14.0, u_phrase) * (0.6 + 0.4 * u_weave);
  float twill = u_topology;
  float over = sin(p.y * weftN * TWO_PI + baseX * (3.0 + twill * 4.0)
      + t * 0.6 + twill * p.x * 6.0);
  float duck = over * mix(0.006, 0.018, float(cls) * 0.5) * (0.4 + 0.6 * tension);

  // FOLD: the persistent drop fold lifts a lateral band of cloth.
  float foldBand = exp(-pow((p.y - (0.5 + 0.35 * sin(u_foldPhase))) * 3.2, 2.0));
  float fold = u_fold * foldBand * 0.05 * sin(baseX * 5.0 + u_foldPhase * 2.0);

  float x = baseX + wob + duck + fold;
  float d = abs(p.x - x);

  // THICKNESS by class AND tension: cords thick, filaments hairline. Loud
  // bands read slightly thicker but the CLASS dominates identity.
  float baseThick = cls == 0 ? 0.020 : (cls == 1 ? 0.010 : 0.004);
  float thick = baseThick * (0.65 + 0.5 * lvl) * (0.9 + 0.2 * u_section);
  float cov = smoothstep(thick, thick * 0.25, d);

  // Compression KINK travelling down the cords on a kick (cords only).
  if (cls == 0) {
    float front = 1.0 - u_shearAge * 1.6;       // travels top->bottom
    float kink = exp(-pow((p.y - front) * 7.0, 2.0)) * exp(-u_shearAge * 2.2) * u_shearAmp;
    cov += smoothstep(thick * 2.4, 0.0, d) * kink * 1.6;
  }

  // Color TRAVELS with position + centroid; brightness only gently rides level.
  col = cloth(wx * 1.4 + p.y * 0.5 + t * 0.04 + u_centroid * 0.35 + float(cls) * 0.12);
  // Highs shimmer iridescent along their length (fibers, not dust).
  if (cls == 2) {
    float sh = 0.5 + 0.5 * sin(p.y * 40.0 + t * 6.0 + wx * 30.0);
    col = mix(col, vec3(1.0), 0.3 * sh * (0.4 + 0.6 * u_hat));
  }
  return cov * (0.55 + 0.55 * lvl);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 px = 1.0 / u_res;
  float t = u_time;

  // ---- Fabric advection: a lateral SHEAR on kicks (the loom-frame yank) +
  // a slow breathing drift. Sampling the previous frame builds persistence.
  float shear = exp(-u_shearAge * 3.0) * u_shearAmp * 0.03 * sin(uv.y * 3.0 + t);
  float breathe = 0.004 * sin(uv.y * 4.0 + t * 0.3) * (0.5 + 0.5 * u_buildup);
  // Buildup pulls the cloth TAUT: advection converges toward straightness.
  vec2 src = uv + vec2(shear + breathe, 0.0);
  src.x = mix(src.x, uv.x, 0.15 * u_buildup);

  vec3 sampled = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 field = max(vec3(0.0), sampled * 1.3 - blur * 0.3) * u_decay;

  // ---- Weave the 24 warp threads. Bands 0..7 = cords, 8..15 = ribbons,
  // 16..23 = filaments. Home x spreads them laterally across the frame.
  vec3 fresh = vec3(0.0);
  for (int b = 0; b < 24; b++) {
    float lvl = clamp(specAt(b), 0.0, 1.0);
    int cls = b < 8 ? 0 : (b < 16 ? 1 : 2);
    float fb = float(b);
    // Lateral home position, edge-margined so nothing hugs the border.
    float wx = 0.06 + 0.88 * (fb + 0.5) / 24.0;
    vec3 col;
    float cov = warpThread(uv, wx, lvl, cls, t, col);
    // Snare sheds mid fibers; hat sheds high fibers (brief flares, mid/high
    // only — cords untouched by transients).
    float shed = cls == 1 ? u_snare : (cls == 2 ? u_hat : 0.0);
    fresh += col * cov * u_threadGain * (1.0 + 1.4 * shed);
  }

  // ---- Lateral WEFT beams: three broad bands (low/mid/high) crossing the
  // warp, giving the cloth its horizontal structure. These carry the band
  // ENERGY as presence, still color-traveled.
  float weftY0 = 0.30, weftY1 = 0.5, weftY2 = 0.70;
  float wobY = 0.03 * sin(uv.x * 6.0 + t * 0.7);
  float lowBeam = exp(-pow((uv.y - weftY0 - wobY) * (18.0 - 8.0 * u_low), 2.0));
  float midBeam = exp(-pow((uv.y - weftY1 + wobY) * (26.0 - 8.0 * u_mid), 2.0));
  float highBeam = exp(-pow((uv.y - weftY2 - wobY * 0.5) * (40.0 - 10.0 * u_high), 2.0));
  fresh += cloth(uv.x * 1.2 + t * 0.05) * lowBeam * (0.15 + 0.9 * u_low);
  fresh += cloth(uv.x * 1.2 + 0.33 + t * 0.05) * midBeam * (0.12 + 0.8 * u_mid);
  fresh += cloth(uv.x * 1.2 + 0.66 + t * 0.05) * highBeam * (0.10 + 0.7 * u_high);

  // ---- Persistent DROP FOLD glow: a lit crease riding max(drop, energy).
  float foldY = 0.5 + 0.35 * sin(u_foldPhase);
  float foldGlow = exp(-pow((uv.y - foldY) * 4.5, 2.0));
  fresh += cloth(0.5 + u_foldPhase * 0.1) * foldGlow * u_fold * (0.5 + 0.6 * u_low);

  // ---- Section-change bloom: the whole cloth flashes as the weave re-threads
  // (localized to a diagonal sweep, not a full-field flash).
  float sweep = exp(-pow((uv.x - fract(u_section * 1.3)) * 3.0, 2.0));
  fresh += cloth(uv.y + t * 0.1) * sweep * u_section * 0.7;

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * max(u_drop, 0.5 * (u_low + u_mid)) + 1.0 * u_buildup);

  // Whole-frame kick punch stays small + gated (photosensitivity floor).
  field *= 1.0 + 0.08 * u_kick;

  // Grade: buildups saturate the running color; keep a dim-but-alive floor.
  vec3 grade = cloth(0.3 + u_centroid * 0.2);
  field = mix(field, field * (0.5 + grade * 1.3), 0.2);
  field *= 0.8 + 0.4 * max(u_drop, 0.4 * (u_low + u_mid + u_high)) + 0.1 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.85) {
    field *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 4;
const SECTION_BARS = 16;

/** splitmix32-style scalar hash → stable [0,1). Same trackId ⇒ same weave. */
function splitmix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) / 4294967296;
}

function genomeOf(seed: number): [number, number, number, number] {
  let s = Math.floor(seed) | 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x6d2b79f5) | 0;
    out.push(splitmix(s + i * 0x2545f491));
  }
  return [out[0], out[1], out[2], out[3]];
}

const candidate: VisualizerPreset = {
  id: 'g06-loom',
  name: 'g06 loom',
  hiRes: true,
  params: [
    { id: 'weave', label: 'weave density', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'thread', label: 'thread brightness', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'skew', label: 'warp skew', min: -0.6, max: 0.6, step: 0.02, default: 0.25 },
    { id: 'fold', label: 'drop fold', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let shearAge = 999;
    let shearAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let foldPhase = 0;
    let fold = 0;
    let section = 0;
    let topology = 0;
    let lastSectionIndex = -1;
    // Song motif genome (stable per trackId) + re-thread transition.
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let seeded = false;
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);

        // Dominant audible deck (for the motif seed).
        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        let dom: (typeof frame.decks)[number] | null =
          frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        if (dom === null) {
          for (const d of frame.decks) {
            if (d.playing && (dom === null || d.level > dom.level)) dom = d;
          }
        }

        // Bass-weighted, smoothed drop signal (trend has no drop field).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);

        // Persistent fold rides max(drop, energy) — sustained, not a transition.
        const foldTarget = Math.min(1, Math.max(smoothDrop, 0.6 * energy));
        fold += (foldTarget - fold) * (1 - Math.exp(-dt / 0.5));
        foldPhase += dt * (0.2 + 0.5 * fold);

        // Phrase / section tiers via the ladder-correct ordinal.
        let phrase = 0;
        let sectionIndex = lastSectionIndex;
        if (frame.beat) {
          const barOrdinal = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const barInPhrase = ((barOrdinal % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          sectionIndex = Math.floor(barOrdinal / SECTION_BARS);
        } else {
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.1);
        }

        // Section boundary: change weave topology + fire the re-thread bloom.
        if (sectionIndex !== lastSectionIndex && lastSectionIndex >= 0) {
          section = 1;
          topology = (topology + 1) % 4;
        }
        lastSectionIndex = sectionIndex;
        section = Math.max(0, section - dt / 1.2);

        // Motif genome: dominant trackId (or a frozen spectral pseudo-seed).
        const trackId = dom?.trackId ?? null;
        const seedKey =
          trackId !== null
            ? trackId
            : Math.floor((frame.centroid * 331 + frame.spread * 271 + frame.flatness * 197) * 101);
        if (!seeded || seedKey !== currentSeed) {
          currentSeed = seedKey;
          genome = genomeOf(seedKey);
          seeded = true;
        }

        // Fill the 24-band spectrum buffer (EXACTLY length 24; clamp source).
        const src = frame.spectrum;
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const v = i < src.length ? src[i] : 0;
          spectrum[i] = Math.min(1, Math.max(0, v));
        }

        // Kick YANK: solid loom-frame shear + traveling kink. Gated on
        // impulse.low so it never becomes "kick powder".
        shearAge += dt;
        if (frame.impulse.low > 0.35 && shearAge > 0.1) {
          shearAge = 0;
          shearAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        // Weave denser toward the phrase boundary; motif nudges base density.
        const weave = (frame.params.weave ?? 1) * (0.6 + 0.6 * genome[0]) * (0.7 + 0.5 * phrase);
        // Warp skew: slider offset + motif lean.
        const skew = (frame.params.skew ?? 0.25) + (genome[1] - 0.5) * 0.3;

        // Decay: dim-but-alive; slower persistence in buildups.
        const baseDecay = 0.965 - 0.01 * energy - 0.006 * smoothBuildup;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_centroid: frame.centroid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_phrase: Math.min(1, phrase),
          u_section: Math.max(0, Math.min(1, section)),
          u_topology: topology,
          u_decay: Math.min(0.99, 1 - (1 - baseDecay) / persistence),
          u_seed: genome[3] * 100,
          u_shearAge: shearAge,
          u_shearAmp: shearAmp,
          u_fold: fold * (frame.params.fold ?? 1),
          u_foldPhase: foldPhase,
          u_weave: weave,
          u_threadGain: frame.params.thread ?? 1,
          u_skew: skew,
          u_palPhase: genome[2] * 6.28318,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default candidate;
