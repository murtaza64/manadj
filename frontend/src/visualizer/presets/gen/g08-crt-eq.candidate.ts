/**
 * "g08 crt-eq" (genetic arena g08, tweak of g07-crt — spectrum->parameter
 * mapping study; human ask: "more EQ responsiveness").
 *
 * Copies g07-crt WHOLESALE (four programs, channel changes, the whole tube
 * pipeline: scanlines/phosphor-triad/barrel/vignette/glow/jitter). Adds ONE
 * new thing: a STRICT EQ->property split so each of the three isolator bands
 * drives a DIFFERENT, independently-legible axis of the picture. An EQ sweep
 * on any one knob must be readable on its own:
 *
 *   LOWS  = FRAME STABILITY + BEAM FLOOR (structure/energy).
 *     Bass kill => the picture stabilizes eerily clean: vertical hold locks,
 *     jitter vanishes, hum bar gone, and the raster settles to a calm floor.
 *     Heavy bass => the frame SAGS (vertical-hold roll) and a bright HUM BAR
 *     crawls slowly UP the tube (mains-hum beat, sub-3Hz drift, localized).
 *     Lows also set the beam's brightness FLOOR (loud lows = a hotter tube).
 *   MIDS  = PROGRAM CONTENT COLOR (palette hue).
 *     The program's palette hue tracks mid spectral content: an EQ mid sweep
 *     REPAINTS the show. Mids also keep the content moving (parent behavior).
 *   HIGHS = PHOSPHOR / SCANLINE DETAIL (crispness).
 *     High highs => crisp aperture grille, sharp deep scanlines, edge
 *     ringing (unsharp on content). High kill => a soft, blurry tube: the
 *     grille washes out, scanlines shallow, edges melt. Highs are DETAIL,
 *     never a color or a brightness pump (keeps the three axes orthogonal).
 *
 * REACTIVITY (parent, kept):
 *  - KICK = beam SLAM (sub-3Hz smoothed envelope, release ~0.3 s).
 *  - SNARE = a one-line horizontal TEAR that heals (localized, exempt).
 *  - BUILDUP = VHS tracking stress + noise band creep.
 *  - DROP / SECTION = CHANNEL CHANGE (one-shot ~0.35 s static swell).
 *  - PHRASE advances the current program's internal evolution.
 * NEW small beat effect: a raster BRIGHTNESS COMB that steps DOWN one
 * scanline block per beat (a hard integer step on the grid, localized ->
 * photosafety-exempt; the comb is a spatial brightness gradient, not a
 * full-field flash).
 *
 * IDENTITY: same trackId genome as g07 (splitmix of the dominant audible
 * deck's trackId) picks the channel lineup + starting palette family.
 *
 * PHOTOSAFETY (parent envelopes kept verbatim): the only near-full-field
 * brightenings are the kick beam-slam (smoothed, ~0.3 s release => a single
 * kick can't drive >3 full-field cycles/sec) and the channel-change static
 * (one-shot ~0.35 s swell, desaturated toward white). The hum bar and beat
 * comb are localized spatial gradients (not full-field), the EQ mappings are
 * continuous/smoothed. No saturated-red strobing.
 *
 * Assigned tech: bands (isolator EQ split — the STAR), impulses, ladder
 * tiers (channel schedule + per-beat comb), beat phase/beatInBar (grid-quant
 * comb), trend split, trackId genome.
 *
 * REFINEMENT (human note "motion a bit erratic" x2, in place): the
 * program-content MOTION rates (plasma flow, bar roll, starburst spoke/ring
 * spin) rode the 8ms-attack instantaneous mid and jerked every transient. They
 * now ride bandsSlow.mid (u_midMotion, motion smoothness law); content COLOR
 * and warp-amplitude terms keep instantaneous mid. The hum-bar strength and
 * the baseline jitter/stability driver are smoothed with a >=300ms low
 * (motion-smoothness). The beam slam and snare tears keep their punchy
 * instantaneous envelopes.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks in this string. The EQ split feeds three distinct uniforms:
//   u_stability (from lows), u_hue (from mids), u_detail (from highs).
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midMotion;   // bandsSlow.mid — program-content MOTION rates only
uniform float u_high;
uniform float u_kick;        // impulse.low
uniform float u_slam;        // SMOOTHED beam-slam envelope (sub-3Hz)
uniform float u_snare;       // impulse.mid: tear trigger
uniform float u_tearY;       // tear scanline position (0..1), healing
uniform float u_tearAmt;     // tear displacement, decays as it heals
uniform float u_vhold;       // vertical-hold sag offset (bass tension)
uniform float u_tracking;    // buildup VHS tracking stress 0..1
uniform float u_noiseBand;   // buildup noise band height creeping from bottom
uniform float u_static;      // SMOOTHED channel-change static burst (one-shot)
uniform float u_retrace;     // retrace line position during a channel change
uniform float u_drop;        // max(drop, energy)
uniform float u_sustain;     // bass-weighted sustained loudness
uniform float u_program;     // 0..3 current program index (integer-valued)
uniform float u_progA;       // program cross-fade previous index
uniform float u_progMix;     // 0..1 fade between progA and program
uniform float u_palette;     // 0..3 palette family (continuous)
uniform float u_warm;        // centroid tint bias
uniform float u_seed;        // genome seed scalar
uniform float u_barrel;      // barrel distortion amount (kick pumps it)
uniform float u_phrase;      // phrase evolution phase for program internals

// --- EQ SPLIT (the study). Each is a DIFFERENT independent axis. ---
uniform float u_stability;   // LOWS -> 1 = bass kill / eerily stable, 0 = heavy bass chaos
uniform float u_humPhase;    // LOWS -> hum bar position (crawls up, 0..1)
uniform float u_humAmt;      // LOWS -> hum bar strength (loud bass)
uniform float u_beamFloor;   // LOWS -> beam brightness floor
uniform float u_hue;         // MIDS -> program palette hue offset (0..1, repaints)
uniform float u_detail;      // HIGHS -> phosphor/scanline crispness 0..1
uniform float u_ring;        // HIGHS -> edge-ringing (unsharp) amount
uniform float u_comb;        // BEAT -> comb block index (integer), steps per beat
uniform float u_combBlocks;  // BEAT -> number of comb blocks down the screen

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// iq cosine palettes: four saturated families the genome selects between,
// MORPHED not switched. No pure-red two-color pairs (photosafety); bright.
vec3 pal0(float t) { return vec3(0.5, 0.3, 0.55) + vec3(0.5, 0.45, 0.45) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal1(float t) { return vec3(0.2, 0.5, 0.5)  + vec3(0.4, 0.5, 0.5)  * cos(6.28318 * (vec3(0.9, 1.0, 0.9) * t + vec3(0.15, 0.35, 0.6))); }
vec3 pal2(float t) { return vec3(0.5, 0.5, 0.25) + vec3(0.5, 0.45, 0.4) * cos(6.28318 * (vec3(1.0, 0.95, 0.75) * t + vec3(0.05, 0.25, 0.5))); }
vec3 pal3(float t) { return vec3(0.35, 0.3, 0.55) + vec3(0.45, 0.4, 0.5) * cos(6.28318 * (vec3(0.95, 0.9, 1.0) * t + vec3(0.25, 0.1, 0.6))); }

vec3 palette(float t) {
  // MIDS repaint the show: the hue offset walks the palette phase.
  t += u_hue;
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  c += vec3(0.14, 0.02, -0.08) * (u_warm - 0.5) * 1.2;
  return c;
}

// --- The four programs: bold, saturated, high-contrast, always moving. ---

// 0: interference plasma — overlapping wave fronts, mids ripple them.
// FIX (human note "motion a bit erratic"): the flow RATE rides bandsSlow.mid
// (u_midMotion, motion smoothness law), not the 8ms-attack instantaneous mid.
vec3 progPlasma(vec2 uv) {
  float t = u_time * (0.6 + 1.2 * u_midMotion) + u_phrase;
  float a = sin((uv.x * 8.0 + t) + sin(uv.y * 6.0 - t * 0.7));
  float b = sin((uv.y * 9.0 - t * 0.9) + sin(uv.x * 7.0 + t * 0.5));
  float f = (a + b) * 0.5;
  float v = 0.5 + 0.5 * f;
  return palette(v * 0.7 + 0.15);
}

// 1: rolling color bars gone feral — SMPTE bars that warp and roll with
// mids/highs (rolls slowly so the vertical alternation stays well sub-3Hz).
vec3 progBars(vec2 uv) {
  // FIX (motion erratic): the roll RATE rides bandsSlow.mid; the warp
  // AMPLITUDE keeps instantaneous mid (a displacement pop, not a rate).
  float roll = u_time * (0.15 + 0.35 * u_midMotion) + u_phrase * 0.5;
  float warp = 0.12 * sin(uv.y * 5.0 + u_time * 1.3) * (0.5 + u_mid);
  float x = fract(uv.x + warp + 0.05 * sin(roll + uv.y * 3.0));
  float bar = floor(x * 7.0) / 7.0;
  return palette(bar + 0.1 * sin(roll));
}

// 2: tuned-static aurora — layered noise ridges drifting up.
vec3 progAurora(vec2 uv) {
  float t = u_time * 0.4 + u_phrase;
  float n = noise(vec2(uv.x * 4.0, uv.y * 3.0 - t)) * 0.6
          + noise(vec2(uv.x * 9.0 + t, uv.y * 6.0 - t * 1.4)) * 0.4;
  float ridge = smoothstep(0.35, 0.75, n + 0.2 * uv.y);
  return palette(0.2 + 0.6 * n) * (0.4 + ridge);
}

// 3: raster starburst — radial spokes from center, pulse with mids.
vec3 progStarburst(vec2 uv) {
  vec2 p = uv - 0.5;
  float ang = atan(p.y, p.x);
  float rad = length(p);
  // FIX (motion erratic): spoke + ring rotation RATES ride bandsSlow.mid.
  float spokes = 0.5 + 0.5 * sin(ang * 12.0 + u_time * (1.0 + 2.0 * u_midMotion) + u_phrase);
  float rings = 0.5 + 0.5 * sin(rad * 30.0 - u_time * 3.0 * (0.5 + u_midMotion));
  float v = spokes * (0.5 + 0.5 * rings) * exp(-rad * 1.2);
  return palette(0.15 + v) * (0.5 + 1.5 * v);
}

vec3 program(float idx, vec2 uv) {
  // Nearest-integer program (no uniform-loop): four bounded branches.
  if (idx < 0.5) return progPlasma(uv);
  if (idx < 1.5) return progBars(uv);
  if (idx < 2.5) return progAurora(uv);
  return progStarburst(uv);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;

  // ---- Barrel distortion (the tube curvature): pull uv toward center by a
  // radial power. The kick beam-slam pumps the barrel ~2% (u_barrel).
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  float barrel = 1.0 + (0.12 + u_barrel) * r2;
  vec2 tubeUv = 0.5 + cc * barrel;

  // ---- LOWS -> STABILITY: jitter amount scales with (1 - stability) so a
  // bass kill locks the tube eerily still; heavy bass shakes it. Buildup
  // tracking still adds jitter on top (a different, orthogonal axis).
  float lowShake = (1.0 - u_stability);
  float jitter = (noise(vec2(u_time * 30.0, 0.0)) - 0.5) * 0.004
    * (lowShake + 2.0 * u_tracking);
  // LOWS -> vertical hold sag (u_vhold already gated on stability host-side).
  vec2 cuv = tubeUv + vec2(jitter, u_vhold);

  // Off-tube region reads as the black bezel/darkness.
  float onTube = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
  cuv = clamp(cuv, 0.0, 1.0);

  // ---- Snare TEAR (parent): a one-line horizontal displacement that heals.
  float tearDist = abs(cuv.y - u_tearY);
  float tearK = exp(-tearDist * 220.0) * u_tearAmt;
  cuv.x = fract(cuv.x + tearK * 0.15 * sign(sin(u_time * 50.0)));

  // ---- VHS tracking stress (buildup): chroma bleed via per-channel uv shear.
  // HIGHS also add a tiny extra chroma split (edge ringing reads on chroma).
  float bleed = (0.002 + 0.010 * u_tracking) * (1.0 + u_drop) + 0.003 * u_ring;
  vec2 br = cuv + vec2(bleed, 0.0);
  vec2 bb = cuv - vec2(bleed, 0.0);

  vec3 content;
  {
    // Program cross-fade (channel change eases progA -> program).
    vec3 cr = mix(program(u_progA, vec2(br.x, br.y)), program(u_program, vec2(br.x, br.y)), u_progMix);
    vec3 cg = mix(program(u_progA, cuv), program(u_program, cuv), u_progMix);
    vec3 cb = mix(program(u_progA, vec2(bb.x, bb.y)), program(u_program, vec2(bb.x, bb.y)), u_progMix);
    content = vec3(cr.r, cg.g, cb.b);
  }

  // ---- HIGHS -> EDGE RINGING (crispness): sharpen the content against its
  // own neighbours (a cheap unsharp in uv). High highs = hard edges; kill =
  // untouched (blur applied later). Localized detail axis, not brightness.
  if (u_ring > 0.001) {
    vec2 rp = 3.0 / u_res;
    vec3 nAvg = (program(u_program, cuv + vec2(rp.x, 0.0))
      + program(u_program, cuv - vec2(rp.x, 0.0))
      + program(u_program, cuv + vec2(0.0, rp.y))
      + program(u_program, cuv - vec2(0.0, rp.y))) * 0.25;
    content += (content - nAvg) * u_ring * 0.9;
  }

  // ---- Buildup noise band creeping up from the bottom (vivid, not dim).
  float nb = step(cuv.y, u_noiseBand);
  float staticN = hash(vec2(cuv.x * 300.0 + fract(u_time) * 91.0, cuv.y * 300.0 - u_time * 53.0));
  content = mix(content, palette(0.5 + 0.3 * staticN) * (0.6 + 0.8 * staticN), nb * u_tracking * 0.7);

  // ---- LOWS -> HUM BAR: a soft bright band crawling slowly UP the tube
  // (mains-hum beat). Localized spatial gradient; drift is sub-3Hz. Only
  // present under heavy bass (u_humAmt), gone on a bass kill.
  float humBand = exp(-abs(fract(cuv.y - u_humPhase) - 0.5) * 6.0);
  content *= 1.0 + humBand * u_humAmt * 0.35;

  // ---- Content liveliness: mids/highs keep it moving, sustain lifts it.
  // LOWS set the beam floor (loud lows = a hotter tube minimum brightness).
  content *= 0.5 + 0.6 * u_beamFloor + 0.5 * u_sustain + 0.5 * u_drop;

  // ---- BEAT COMB (grid-quantized, localized): a brightness comb that steps
  // DOWN one scanline block per beat. The lit block is u_comb (integer);
  // blocks above are slightly dimmer, giving a hard per-beat step that reads
  // as a raster brightness gradient marching down the tube. Not full-field.
  float blockId = floor(cuv.y * u_combBlocks);
  float combLit = 1.0 - clamp(abs(blockId - u_comb), 0.0, 3.0) / 3.0;
  content *= 1.0 + combLit * 0.22;

  // ---- Beam SLAM (kick): one SOLID smoothed brightening of the whole raster
  // plus a one-frame scanline thickening. Rides u_slam (sub-3Hz envelope).
  float slamBias = 0.6 + 0.4 * (1.0 - r2 * 1.5);
  content *= 1.0 + u_slam * 0.7 * slamBias;

  // ---- CHANNEL-CHANGE static burst (parent): a smoothed one-shot full-field
  // static wipe desaturated toward white, plus a bright retrace line.
  if (u_static > 0.001) {
    float sN = hash(vec2(cuv.x * 640.0 + fract(u_time) * 311.0, cuv.y * 480.0 - u_time * 197.0));
    vec3 snow = mix(vec3(sN), palette(sN) * 1.2, 0.35);
    content = mix(content, snow, u_static);
    float rl = exp(-abs(cuv.y - u_retrace) * 90.0);
    content += vec3(0.9, 0.95, 1.0) * rl * u_static * 0.8;
  }

  // ---- HIGHS -> SCANLINE DETAIL: high highs cut sharp, deep scanlines; a
  // high kill shallows them (soft tube). Slam thickens the dark gaps.
  float lines = 340.0;
  float scan = 0.5 + 0.5 * sin(cuv.y * lines * 6.28318);
  float scanDepth = (0.12 + 0.30 * u_detail) + 0.25 * u_slam;
  content *= 1.0 - scanDepth * (1.0 - scan);

  // ---- HIGHS -> PHOSPHOR TRIAD detail: crisp aperture grille when highs are
  // hot, washed toward flat white when highs are killed (soft blurry tube).
  float col3 = mod(gl_FragCoord.x, 3.0);
  vec3 triad = vec3(step(col3, 0.5), step(0.5, col3) * step(col3, 1.5), step(1.5, col3));
  float grilleMask = mix(0.15, 0.75, u_detail); // detail deepens the grille
  triad = mix(vec3(1.0), triad * 1.6, grilleMask);
  content *= triad;

  // ---- Beam-glow bloom + feedback persistence (parent). HIGHS kill => the
  // blur is stronger (soft tube); high highs => a tight glow. The feedback
  // tap gives phosphor persistence a real CRT has.
  vec2 pix = 1.0 / u_res;
  vec3 prev = texture2D(u_prev, uv).rgb;
  vec3 blur = (texture2D(u_prev, uv + vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, uv - vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, uv + vec2(0.0, pix.y)).rgb
    + texture2D(u_prev, uv - vec2(0.0, pix.y)).rgb) * 0.25;
  // Low detail (high kill) => blend MORE blur back in (blurry tube).
  content = mix(blur, content, 0.6 + 0.4 * u_detail);
  float persist = 0.28 + 0.12 * u_tracking;
  vec3 glow = max(vec3(0.0), blur - 0.35) * (0.5 + 0.7 * u_low);
  content += glow * 0.6;
  content = content + prev * persist * 0.5;

  // ---- Corner vignette (localized, exempt): darken the tube corners.
  float vig = smoothstep(0.9, 0.35, length(cc) * 1.3);
  content *= 0.35 + 0.65 * vig;

  // Bezel/darkness outside the tube.
  content *= onTube;

  // Chroma-preserving soft knee (never per-channel clamp).
  float mx = max(content.r, max(content.g, content.b));
  if (mx > 0.92) {
    content *= (0.92 + 0.08 * (1.0 - exp(-(mx - 0.92) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(content, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'curvature', label: 'tube curvature', min: 0, max: 0.3, step: 0.01, default: 0.12 },
  { id: 'persistence', label: 'phosphor persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'eqDrive', label: 'EQ mapping drive', min: 0.5, max: 2.5, step: 0.05, default: 1.4 },
  { id: 'glitchiness', label: 'channel-change intensity', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'warmth', label: 'phosphor warmth', min: 0, max: 1, step: 0.05, default: 0.5 },
];

// --- trackId genome (channel lineup) — g02-julia's splitmix pattern -----

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

interface ChannelGenome {
  /** The program order for this song's channels (permutation of 0..3). */
  lineup: number[];
  /** Starting palette family 0..3. */
  palette0: number;
  /** Seed scalar for shader hash tinting. */
  seed: number;
}

/** Hash a key into a channel lineup (shuffled program order) + palette. */
function hashGenome(key: number): ChannelGenome {
  const next = splitmix(Math.round(key));
  const lineup = [0, 1, 2, 3];
  for (let i = lineup.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = lineup[i];
    lineup[i] = lineup[j];
    lineup[j] = t;
  }
  return { lineup, palette0: next() * 3, seed: next() };
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

const g08CrtEqPreset: VisualizerPreset = {
  id: 'g08-crt-eq',
  name: 'g08 crt-eq',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // Slow stats (palette warmth from centroid EMA).
    let emaCentroid = 0.5;
    // Genome / identity.
    let seededKey: number | null = null;
    let genome: ChannelGenome = hashGenome(1);
    let lastTrackId: number | null = null;
    // Regime smoothing.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    // Channel state.
    let channelIdx = 0;
    let prevProgram = 0;
    let curProgram = 0;
    let progMix = 1;
    let lastSection = -1;
    let dropLatch = false;
    // Envelopes (all photosafe-smoothed).
    let slam = 0;
    let staticBurst = 0;
    let retrace = 0;
    // Tear (snare).
    let tearAmt = 0;
    let tearY = 0.5;
    // Vertical hold sag.
    let vhold = 0;
    let vholdVel = 0;
    // Barrel pump.
    let barrel = 0;
    // Phrase evolution phase.
    let phrasePhase = 0;
    // --- EQ SPLIT state ---
    // LOWS: smoothed low level, stability, hum bar crawl.
    let smoothLow = 0;
    let humPhase = 0;
    // FIX (human note "motion a bit erratic" x2): dedicated >=300ms-smoothed
    // low driver for the MOTION drivers (hum-bar strength + baseline jitter
    // amount) so those slow drifts don't jerk with 8ms-attack transients. Beam
    // slam / tears keep their own punchy (instantaneous) envelopes.
    let motionLow = 0;
    // MIDS: smoothed hue offset (EQ mid sweep repaints — eased so a sweep
    // reads as a continuous repaint, not a jump).
    let hueOffset = 0;
    // HIGHS: smoothed detail (crispness).
    let detail = 0.5;
    // BEAT: comb block index, stepped on the grid.
    const combBlocks = 12;
    let combIdx = 0;
    let lastBeatOrdinal = -1;

    /** Trigger a channel change: advance the lineup, start the static swell. */
    const changeChannel = () => {
      prevProgram = curProgram;
      channelIdx = (channelIdx + 1) % genome.lineup.length;
      curProgram = genome.lineup[channelIdx];
      progMix = 0;
      staticBurst = 1;
      retrace = 0;
    };

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const slowAlpha = 1 - Math.exp(-dt / 12);
        emaCentroid += (frame.centroid - emaCentroid) * slowAlpha;

        // --- Identity (parent): dominant trackId seeds the channel lineup.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((emaCentroid * 4096 + energy * 811) * 131);
        if (seededKey == null) {
          seededKey = key;
          genome = hashGenome(key);
          lastTrackId = trackId;
          curProgram = genome.lineup[0];
          prevProgram = curProgram;
        } else if (trackId != null && trackId !== lastTrackId) {
          seededKey = key;
          genome = hashGenome(key);
          lastTrackId = trackId;
          channelIdx = -1;
          changeChannel();
        }

        // --- Regime split (smoothed ~0.35 s).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, energy * 1.4);
        const dropRide = Math.max(smoothDrop, sustained);

        // --- Section / phrase tiers (ladder-correct with fallback).
        const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
        const section = Math.floor(barIndex / 16);
        const barPhase = frame.beat?.barPhase ?? 0;
        const beatRate = frame.beat?.bpm ? frame.beat.bpm / 60 : 2;
        phrasePhase += dt * beatRate * 0.05;

        // DROP = channel change (edge-triggered on the drop onset; priority).
        const dropNow = smoothDrop > 0.5;
        if (dropNow && !dropLatch) {
          changeChannel();
        }
        dropLatch = smoothDrop > 0.35;
        // SECTION boundary = channel change too (unless a drop just did one).
        if (section !== lastSection && lastSection >= 0 && !dropNow) {
          changeChannel();
        }
        lastSection = section;

        // --- Program cross-fade eases in ~0.4 s (a settling channel).
        progMix = Math.min(1, progMix + dt / 0.4);

        // --- Channel static swell + retrace (parent).
        staticBurst = Math.max(0, staticBurst - dt / 0.35);
        retrace = Math.min(1.2, retrace + dt / 0.35);

        // --- Beam slam envelope: fast attack, release ~0.3 s (parent).
        const kick = frame.impulse.low;
        if (kick > slam) slam = kick;
        slam = Math.max(0, slam - dt / 0.3);

        // --- Barrel pump ~2% on the slam (eased) (parent).
        const curvature = frame.params.curvature ?? 0.12;
        barrel += (slam * 0.02 - barrel) * (1 - Math.exp(-dt / 0.12));

        // --- Snare tear (parent).
        const snare = frame.impulse.mid;
        if (snare > 0.25 && tearAmt < 0.4) {
          tearAmt = Math.min(1, snare);
          tearY = 0.15 + 0.7 * Math.random();
        }
        tearAmt = Math.max(0, tearAmt - dt / 0.25);

        // === EQ SPLIT (the study) — three independent, legible axes. ===
        const eqDrive = frame.params.eqDrive ?? 1.4;

        // --- LOWS: FRAME STABILITY + BEAM FLOOR + HUM BAR + vertical hold.
        const lowAlpha = 1 - Math.exp(-dt / 0.25);
        smoothLow += (frame.bands.low - smoothLow) * lowAlpha;
        const lowDrive = Math.min(1, smoothLow * eqDrive);
        // >=300ms-smoothed low for the erratic MOTION drivers (hum-bar strength,
        // baseline jitter) — motion-smoothness law.
        const bandsSlowLow = (frame.bandsSlow ?? frame.bands).low;
        motionLow += (bandsSlowLow - motionLow) * (1 - Math.exp(-dt / 0.3));
        const motionLowDrive = Math.min(1, motionLow * eqDrive);
        // Bass kill => stability ~1 (eerily clean). Heavy bass => ~0 (chaos).
        const stability = 1 - lowDrive;
        // The jitter/stability MOTION axis rides the >=300ms low so the baseline
        // shake glides; the beam slam/tears stay punchy on their own envelopes.
        const motionStability = 1 - motionLowDrive;
        // Beam brightness floor rides lows (a hotter tube under heavy bass).
        const beamFloor = 0.4 + 0.6 * lowDrive;
        // Vertical-hold tension: heavy bass sags; springs back. Gated by lows
        // so a bass kill locks the hold dead still.
        const bassPull = -0.02 * frame.bands.low;
        const stiffness = 60;
        const damping = 9;
        vholdVel += (stiffness * (bassPull - vhold) - damping * vholdVel) * dt;
        vhold += vholdVel * dt;
        vhold *= 1 - stability * 0.15; // stability bleeds the sag toward 0
        // Hum bar crawls slowly UP (sub-3Hz), only visible under heavy bass.
        // FIX (motion erratic): strength rides the >=300ms low so the bar
        // fades in/out smoothly instead of flickering with transients.
        humPhase = (humPhase + dt * 0.18) % 1;
        const humAmt = motionLowDrive;

        // --- MIDS: PROGRAM CONTENT COLOR. Mid spectral content (level +
        // centroid within the mids) walks the palette hue; the mid EQ sweep
        // repaints the show. Eased so a sweep is a continuous repaint.
        const midTarget = Math.min(1, frame.bands.mid * eqDrive);
        const hueAlpha = 1 - Math.exp(-dt / 0.5);
        // Combine mid LEVEL and mid brightness (centroid) for a richer repaint.
        const hueDriveTarget = 0.35 * midTarget + 0.65 * frame.centroid;
        hueOffset += (hueDriveTarget - hueOffset) * hueAlpha;

        // --- HIGHS: PHOSPHOR / SCANLINE DETAIL. High highs => crisp; kill
        // => soft blurry tube. Smoothed so a sweep reads clean.
        const highTarget = Math.min(1, frame.bands.high * eqDrive);
        const detAlpha = 1 - Math.exp(-dt / 0.3);
        detail += (highTarget - detail) * detAlpha;
        const ring = detail; // edge-ringing amount tracks detail directly

        // --- BEAT COMB: step DOWN one scanline block per beat. Grid-quant on
        // beatInBar + bar (an integer beat ordinal); never interpolates.
        const beatInBar = frame.beat?.beatInBar ?? 0;
        const beatsPerBar = frame.beat?.beatsPerBar ?? 4;
        const beatOrdinal = barIndex * beatsPerBar + beatInBar;
        if (beatOrdinal !== lastBeatOrdinal) {
          // Steps down one block each beat, wrapping down the screen.
          combIdx = (combIdx + 1) % combBlocks;
          lastBeatOrdinal = beatOrdinal;
        }

        // --- Buildup tracking stress + noise band creep (parent).
        const tracking = Math.min(1, smoothBuildup * 1.2);
        const noiseBand = 0.18 * smoothBuildup;

        // --- Sliders.
        const persistence = frame.params.persistence ?? 1;
        void persistence;
        const glitchiness = frame.params.glitchiness ?? 1;
        const warmth = frame.params.warmth ?? 0.5;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: midTarget,
          u_midMotion: Math.min(1, (frame.bandsSlow ?? frame.bands).mid * eqDrive),
          u_high: highTarget,
          u_kick: kick,
          u_slam: slam,
          u_snare: snare,
          u_tearY: tearY,
          u_tearAmt: tearAmt,
          u_vhold: vhold,
          u_tracking: tracking,
          u_noiseBand: noiseBand,
          u_static: staticBurst * glitchiness,
          u_retrace: retrace,
          u_drop: dropRide,
          u_sustain: sustained,
          u_program: curProgram,
          u_progA: prevProgram,
          u_progMix: progMix,
          u_palette: genome.palette0,
          u_warm: 0.5 + (emaCentroid - 0.5) * 0.6 + (warmth - 0.5) * 0.8,
          u_seed: genome.seed,
          u_barrel: curvature - 0.12 + barrel,
          u_phrase: phrasePhase + barPhase * 0.2,
          // --- EQ split uniforms ---
          // Jitter (the erratic motion axis) rides the >=300ms-smoothed low;
          // the beam floor / vhold gating below keep the sharper 0.25s low.
          u_stability: motionStability,
          u_humPhase: humPhase,
          u_humAmt: humAmt,
          u_beamFloor: beamFloor,
          u_hue: hueOffset,
          u_detail: detail,
          u_ring: ring,
          u_comb: combIdx,
          u_combBlocks: combBlocks,
        };
      },
    });
  },
};

export default g08CrtEqPreset;
