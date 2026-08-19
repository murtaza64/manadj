/**
 * "g08 orrery-tick" (gen-8 RADICAL tweak of g07-orrery-calm + g06-orrery).
 *
 * Human verdict, verbatim: "a little too fast to see anything" then "even
 * this seems way too fast most of the time to see whats going on".
 * Diagnosis (brief): continuous rotation at ANY speed reads as spinning.
 * Fix: STOP SPINNING. This candidate KILLS continuous rotation entirely and
 * rebuilds the mechanism as an ESCAPEMENT CLOCK — gears are STATIC between
 * events and TICK in discrete steps you can read the meter off:
 *
 *   BEAT gear    advances ONE tooth per BEAT      (second-hand snap + settle)
 *   BAR gear     advances ONE tooth per BAR
 *   PHRASE gear  advances ONE tooth per PHRASE (4 bars)
 *   SECTION wheel advances ONE tooth per SECTION (16 bars)
 *
 * The metric hierarchy IS the clockwork: inner stage ticks fastest (beat),
 * outer stages tick slower (bar/phrase/section), so the mechanism is a
 * readable meter. Each tick is a SNAP to the next tooth angle with a tiny
 * overshoot-and-settle (critically-damped spring), like a mechanical second
 * hand catching — never a continuous sweep.
 *
 * DROP is the ONLY continuous motion: when max(drop, energy) is high the
 * escapement UNLOCKS and the clock RUNS FREE (continuous fast rotation of the
 * whole train); as it subsides the train CATCHES on the nearest tooth and
 * returns to ticking. The contrast between locked ticking and free running IS
 * the drama. If a gear ever visibly spins OUTSIDE a drop, this candidate has
 * failed its brief — so the base per-second rotation term is exactly ZERO.
 *
 * Kick = the escapement STRIKE: the pendulum/hammer hits and the beat gear's
 * tick is DRIVEN by it visually (the tooth snap is armed on the beat cut and
 * the kick impulse lights the strike). Buildup = the pendulum swings WIDER and
 * ticks HARDER (bigger overshoot, brighter strike). Mids = warm glow flowing
 * through the gear train (color). Highs = jewel glints on the teeth (localized,
 * photosensitivity-safe).
 *
 * Inherited from g07-orrery-calm (kept, per brief): the LARGER gear sizes,
 * fewer/larger nested mechanisms, deep background + bright edge-light contrast,
 * the trackId genome, off-center hub, mainspring coil, section-release burst.
 *
 * GLSL discipline (unchanged): ES 1.0, no backticks, constant stage loop
 * masked by u_stageCount, u_-arrays sized exactly MAX_STAGES and fully
 * populated. Per-stage angles are now passed EXPLICITLY (u_ang[]) — discrete
 * tick positions computed JS-side — instead of a shared continuous u_train.
 *
 * Assigned tech: beat phase + bpm + full ladder tiers (beat.ladderBarIndex ??
 * beat.barIndex → beat/bar/phrase/section ticks), impulses (kick strike, snare
 * glints), 24-band spectrum (per-stage activity), trend (drop free-run),
 * trackId genome. Hard steps land exactly on grid via the ladder + beat phase;
 * the integer tooth counts NEVER interpolate (only the settle spring animates).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

const MAX_STAGES = 5;
const PHRASE_BARS = 4;
const SECTION_BARS = 16;

// --- GLSL --------------------------------------------------------------
// No backticks inside this string. The stage loop is a constant loop masked
// by u_stageCount; arrays are sized exactly MAX_STAGES and fully populated.
// The stage ANGLE is now an explicit per-stage uniform (u_ang[]) — a discrete
// tick position computed JS-side — so the shader NEVER integrates a rotation.
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low -> escapement strike glow
uniform float u_snare;       // impulse.mid -> gear-mesh jewel glints (gated by high)
uniform float u_hat;         // impulse.high -> glint gate
uniform float u_drop;        // smoothed excitement WITH bass (free-run driver)
uniform float u_buildup;     // smoothed excitement WITHOUT bass
uniform float u_sustain;     // bass-weighted sustained loudness (body)
uniform float u_free;        // 0..1 escapement UNLOCK (clock runs free on drop)
uniform float u_strike;      // 0..1 beat escapement strike (armed on beat, lit by kick)
uniform float u_pend;        // -1..1 pendulum position (swings wider on buildup)
uniform float u_spring;      // wound spring angle (phrase tension), radians
uniform float u_release;     // 0..1 section-boundary release flash of stored angle
uniform float u_spacing;     // orbital spacing
uniform float u_hub;         // 0..1 hub off-center placement bias (already in u_center)
uniform vec2  u_center;      // OFF-CENTER hub location, aspect-space
uniform float u_stageCount;  // active nested stages (masked in the constant loop)
uniform float u_ang[5];      // per-stage DISCRETE tick angle (radians) — static between ticks
uniform float u_radius[5];   // per-stage orbital radius
uniform float u_teeth[5];    // per-stage fine gear-tooth count
uniform float u_act[5];      // per-stage mechanism activity (24-band grouped)
uniform float u_phase0[5];   // per-stage seeded phase offset
uniform float u_fold;        // symmetry family fold count (rebuilds on section)
uniform float u_palette;     // seed palette family 0..3 (continuous)
uniform float u_warm;        // avg centroid -> palette temperature
uniform float u_sat;         // saturation surge (buildups saturate)
uniform float u_edgeTravel;  // saturated edge-color travel speed
uniform float u_decay;       // feedback persistence
uniform float u_seed;        // scalar seed for tinting

// iq cosine palettes: four families the seed morphs between (bright/saturated).
vec3 pal0(float t) { return vec3(0.5, 0.28, 0.5)  + vec3(0.5, 0.45, 0.5)  * cos(6.28318 * (vec3(1.0, 0.9, 0.75) * t + vec3(0.0, 0.18, 0.42))); }
vec3 pal1(float t) { return vec3(0.16, 0.44, 0.5) + vec3(0.4, 0.5, 0.45)  * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.1, 0.32, 0.55))); }
vec3 pal2(float t) { return vec3(0.55, 0.42, 0.2) + vec3(0.5, 0.42, 0.35) * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.14, 0.28))); }
vec3 pal3(float t) { return vec3(0.5, 0.12, 0.32) + vec3(0.5, 0.4, 0.45)  * cos(6.28318 * (vec3(1.0, 0.85, 0.9) * t + vec3(0.2, 0.05, 0.55))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  c += vec3(0.14, 0.02, -0.08) * (u_warm - 0.5) * 1.3;
  c += vec3(0.16, 0.0, -0.06) * u_drop;
  return c;
}

vec3 saturate(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(vec3(l), c, amt);
}

// Neon line: distance -> additive glow with a hot core and a soft halo.
float neon(float d, float w) {
  float core = exp(-d * d / (w * w));
  float halo = exp(-d * d / (w * w * 26.0)) * 0.35;
  return (core + halo) * 1.35;
}

// SDF of a ring (annulus centre-line) at radius r0.
float ringSDF(vec2 p, float r0) {
  return abs(length(p) - r0);
}

// Safe atan: atan(0,0) is undefined in GLSL ES and returns NaN on some
// drivers. At a stage centre q is exactly (0,0); a single NaN angle here
// poisons the whole feedback loop. Nudge the input off the origin.
float safeAtan(vec2 v) {
  if (dot(v, v) < 1e-12) return 0.0;
  return atan(v.y, v.x);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // ---- Feedback: NO rotation of the sampling in the locked state (a spinning
  // feedback smear would itself read as continuous motion). The feedback only
  // shears while the clock RUNS FREE (u_free), and even then LOCALLY. This is
  // the one place motion continuity is allowed, and only during a drop.
  float fbRot = u_free * (0.06 + 0.10 * u_drop);
  float fcs = cos(fbRot);
  float fsn = sin(fbRot);
  vec2 fp = mat2(fcs, -fsn, fsn, fcs) * (p - u_center) * (1.0 - 0.004 * u_free) + u_center;
  // CLAMP the feedback UVs to [0,1]: reading outside the frame samples
  // CLAMP_TO_EDGE (the red left-edge band in the corrupt frame) and, on the
  // first frames, the never-cleared texImage2D(null) garbage. Keeping the tap
  // in-bounds stops edge-garbage from being advected inward and amplified.
  vec2 src = clamp(fp / vec2(aspect, 1.0) + 0.5, 0.0, 1.0);
  vec2 pix = 1.0 / u_res;
  // CLAMP each feedback sample to [0,4]: the feedback textures are created
  // uninitialized (glPreset ensureTargets uploads null, no clear), so before
  // the first full paint u_prev holds arbitrary GPU memory. Clamping to a
  // finite, bounded range (and dropping any NaN via max) before the >1 trail
  // gain guarantees the loop is contractive and can't accumulate soup.
  vec3 fed = clamp(max(texture2D(u_prev, src).rgb, vec3(0.0)), 0.0, 4.0);
  vec3 blur = (texture2D(u_prev, clamp(src + vec2(pix.x, 0.0), 0.0, 1.0)).rgb
    + texture2D(u_prev, clamp(src - vec2(pix.x, 0.0), 0.0, 1.0)).rgb
    + texture2D(u_prev, clamp(src + vec2(0.0, pix.y), 0.0, 1.0)).rgb
    + texture2D(u_prev, clamp(src - vec2(0.0, pix.y), 0.0, 1.0)).rgb) * 0.25;
  blur = clamp(max(blur, vec3(0.0)), 0.0, 4.0);
  // Deep background: pull the trail down hard so the field falls to black
  // between machinery (contrast with the brightened edge-light). Faster fall
  // when locked (short, crisp tick trails), longer smear when free. The base
  // gain is kept just under 1 (0.985) so the loop DECAYS even before u_decay:
  // a >1 raw gain turns any residual noise into a runaway smear.
  vec3 trail = max(vec3(0.0), fed * (0.985 + 0.06 * u_free) - blur * 0.30) * u_decay;

  // ---- Hub-relative coordinate (OFF-CENTER). Everything hangs off the hub.
  vec2 hp = p - u_center;

  vec3 acc = vec3(0.0);

  // The mainspring coil near the hub — wound angle = u_spring (phrase tension),
  // released on section boundaries (u_release). Static coil; no rotation.
  {
    float rr = length(hp);
    float pitch = (0.05 + 0.03 * u_hub) / (1.0 + 0.4 * u_buildup);
    float a0 = 0.02;
    float turns = 4.0 + 3.0 * clamp(u_spring / 6.28318, 0.0, 2.0);
    float coilR = mod(rr - a0, pitch);
    float dCoil = min(coilR, pitch - coilR);
    float wound = smoothstep(turns * pitch + a0, a0, rr);
    float spring = neon(dCoil, 0.006) * wound * (0.5 + 0.8 * u_buildup + 1.2 * u_release);
    vec3 springCol = palette(0.1 + 0.2 * u_buildup + u_time * 0.02 * u_edgeTravel);
    acc += springCol * spring * (0.6 + 0.5 * u_mid);
  }

  // ---- PENDULUM / escapement anchor: a bar swinging left-right by u_pend,
  // pivoted at the hub, that DRIVES the beat gear's tick. Swings wider on
  // buildup, strikes on the kick. This is the clock's ONLY overtly moving
  // part besides the settle, and its motion is a bounded swing, not a spin.
  {
    float swing = u_pend * (0.35 + 0.55 * u_buildup); // radians from vertical
    vec2 pv = vec2(sin(swing), -cos(swing));          // pendulum direction (downward)
    float rodLen = 0.30;
    vec2 a = vec2(0.0, 0.0);
    vec2 b = pv * rodLen;
    vec2 pa = hp - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(1e-4, dot(ba, ba)), 0.0, 1.0);
    float dRod = length(pa - ba * h);
    float rod = neon(dRod, 0.004);
    vec3 pendCol = palette(0.55 + 0.1 * u_buildup);
    acc += pendCol * rod * (0.4 + 0.6 * u_mid + 0.6 * u_buildup);
    // bob at the tip, lit by the strike (kick).
    float dBob = length(hp - b);
    float bob = exp(-dBob * dBob / (0.0016 + 0.0022 * u_strike));
    acc += mix(pendCol, vec3(1.0), 0.5 * u_strike) * bob * (0.7 + 1.6 * u_strike + 0.5 * u_low);
  }

  // ---- Nested gear stages. Constant loop masked by u_stageCount.
  // Each stage sits at a DISCRETE tick angle u_ang[i] (static between ticks).
  vec2 stageCentre = vec2(0.0);    // hub-relative
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float active = step(fi + 0.5, u_stageCount);

    float rad = u_radius[i] * u_spacing;
    float teeth = u_teeth[i];
    float act = u_act[i];
    float ph0 = u_phase0[i];

    // Stage angle: the DISCRETE tick position (static). No * u_time, no train.
    float ang = u_ang[i] + ph0;
    vec2 dir = vec2(cos(ang), sin(ang));
    float ecc = 0.6 + 0.4 * sin(ph0 * 2.0);
    vec2 nextCentre = stageCentre + dir * vec2(rad, rad * ecc);

    vec2 q = hp - stageCentre;

    // Flywheel ring (LOWS drive the solid eccentric hub/flywheel).
    float wheelR = rad * (0.42 + 0.18 * act);
    float dWheel = ringSDF(q, wheelR);
    float wheelGlow = neon(dWheel, 0.006 + 0.004 * u_low);
    vec3 wheelCol = palette(0.05 * fi + 0.12 * u_low + u_time * 0.015 * u_edgeTravel);
    acc += wheelCol * wheelGlow * active * (0.35 + 1.1 * u_low + 0.7 * act) * (0.6 + 0.6 * u_sustain);

    // Solid eccentric hub disc (LOW body).
    float dHub = length(q);
    float hubGlow = exp(-dHub * dHub / (0.0009 + 0.0016 * u_low));
    acc += wheelCol * hubGlow * active * (0.4 + 0.9 * u_low);

    // Spokes: MID articulated arms fanning from the hub, folded symmetry.
    // Spokes are ANCHORED to the tick angle (co-tick), NOT co-rotating.
    {
      float aa = safeAtan(q) + ang;
      float fold = max(2.0, u_fold);
      float sector = 6.28318 / fold;
      float ad = abs(mod(aa, sector) - sector * 0.5);
      float spoke = neon(ad * (wheelR + 0.001), 0.004);
      float within = smoothstep(wheelR + 0.01, 0.0, dHub);
      vec3 armCol = palette(0.4 + 0.1 * fi + u_time * 0.02 * u_edgeTravel);
      acc += armCol * spoke * within * active * (0.3 + 1.4 * u_mid + 0.6 * act);
    }

    // Fine gear teeth (HIGHS): serrated ring at the wheel rim. The teeth
    // are what let you COUNT the tick — the escapement's readable ratchet.
    {
      float aa = safeAtan(q) * teeth;
      float toothMod = abs(fract(aa) - 0.5) * 2.0;
      float dTeeth = abs(dWheel) + toothMod * 0.010;
      float teethGlow = neon(dTeeth, 0.0035) * (0.4 + 1.2 * u_high);
      vec3 teethCol = palette(0.7 + 0.05 * fi + u_time * 0.03 * u_edgeTravel);
      acc += teethCol * teethGlow * active * (0.25 + 0.9 * u_high + 0.5 * act);

      // JEWEL GLINTS (highs): white-hot points on the teeth at the mesh with
      // the next stage. Tiny + localized (photosensitivity floor). Gated by
      // snare*hat. Brighten on the tick strike (light caught as the tooth
      // catches).
      vec2 meshPt = normalize(nextCentre - stageCentre + 1e-4) * wheelR;
      float dMesh = length(q - meshPt);
      float glint = exp(-dMesh * dMesh / 0.00035);
      float glintGate = u_snare * (0.4 + 0.8 * u_hat) + 0.6 * u_strike * step(fi, 0.5);
      acc += mix(vec3(1.0), teethCol, 0.4) * glint * active * glintGate * 1.6;
    }

    // Connecting rod (arm) to the next stage: the CONNECTED train.
    {
      vec2 a = stageCentre;
      vec2 b = nextCentre;
      vec2 pa = hp - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / max(1e-4, dot(ba, ba)), 0.0, 1.0);
      float dRod = length(pa - ba * h);
      float rodGlow = neon(dRod, 0.005);
      float nextActive = step(fi + 1.5, u_stageCount);
      vec3 rodCol = palette(0.3 + 0.08 * fi);
      acc += rodCol * rodGlow * active * nextActive * (0.4 + 0.8 * u_mid) * (0.6 + 0.5 * u_sustain);
    }

    // ESCAPEMENT STRIKE at the beat gear's mesh: on the beat tick the kick
    // lights the tooth-catch (physical, localized). Only the innermost stage
    // (the beat gear) shows the beat strike; outer stages catch on their own
    // slower ticks via the same u_strike envelope but with lower weight.
    {
      vec2 meshPt = (stageCentre + nextCentre) * 0.5;
      float dClutch = length(hp - meshPt);
      float catchW = u_strike * (i == 0 ? 1.0 : 0.35);
      float catchGlow = exp(-dClutch * dClutch / 0.0016) * catchW;
      acc += palette(0.6 + u_time * 0.05) * catchGlow * active * (0.9 + 1.2 * u_low);
    }

    stageCentre = nextCentre;
  }

  // ---- Section-release burst: a fast expanding ring from the hub marking the
  // stored-angle release + rebuild (localized pulse, soft-kneed below).
  {
    float rr = length(hp);
    float radius = 0.04 + (1.0 - u_release) * 0.9;
    float shell = exp(-pow((rr - radius) * 6.0, 2.0));
    acc += palette(0.35 + u_time * 0.08) * shell * u_release * 1.8;
  }

  // Live body: max(drop, energy) sustained; buildups lift too (never dimmed).
  acc *= 0.55 + 1.0 * u_sustain + 0.7 * u_drop + 0.25 * u_buildup;

  // Saturation: buildups saturate; slider bias upstream.
  acc = saturate(acc, clamp(u_sat, 0.0, 2.0));

  // Blend into the trail (feedback continuity), fresh linework on top.
  vec3 outc = trail + acc * (1.0 - u_decay) * 2.9;

  // Chroma-preserving soft knee (never per-channel clamp).
  float mx = max(outc.r, max(outc.g, outc.b));
  if (mx > 0.85) {
    outc *= (0.85 + 0.15 * (1.0 - exp(-(mx - 0.85) * 3.0))) / mx;
  }
  // Final NaN firewall: max(NaN, 0.0) returns NaN on most GL ES drivers, so a
  // bare max() would still write a poisoned pixel back into the feedback
  // texture and the smear would never clear. The self-equality test x == x is
  // false only for NaN; replace any NaN/Inf channel with 0 so the loop can
  // SELF-HEAL after a bad frame instead of accumulating soup forever.
  vec3 safeOut = clamp(outc, 0.0, 1.0);
  if (!(outc.r == outc.r)) safeOut.r = 0.0;
  if (!(outc.g == outc.g)) safeOut.g = 0.0;
  if (!(outc.b == outc.b)) safeOut.b = 0.0;
  gl_FragColor = vec4(safeOut, 1.0);
}
`;

const params: PresetParam[] = [
  // How far the settle overshoots on each tick (the "catch" snap). 0 = dead
  // stop, higher = livelier second-hand recoil. NOT a rotation speed.
  { id: 'tickSnap', label: 'tick snap', min: 0.2, max: 2, step: 0.05, default: 1 },
  { id: 'complexity', label: 'mechanism complexity', min: 0.3, max: 1.6, step: 0.05, default: 0.85 },
  { id: 'persistence', label: 'feedback persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'strike', label: 'kick strike bite', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  { id: 'saturation', label: 'color saturation', min: 0.5, max: 2, step: 0.05, default: 1 },
];

// --- Song genome (JS-side) --------------------------------------------

/** splitmix64-style avalanche of a key into a [0,1) stream. */
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

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

interface Mechanism {
  stageCount: number;
  /** teeth per gear per stage (the tick advances ONE tooth = 2π/teeth). */
  teeth: Float32Array;
  radius: Float32Array;
  phase0: Float32Array;
  /** tick direction per stage (±1) so adjacent gears counter-turn. */
  dir: Float32Array;
  foldBase: number;
  palette: number;
  center: [number, number];
  seed: number;
}

/** Build a mechanism from a seed key. Fewer, LARGER stages (kept from calm)
 * so the gear structure reads. Teeth counts are small so the discrete tooth
 * step is a VISIBLE fraction of a turn (a big, readable tick). */
function buildMechanism(key: number): Mechanism {
  const next = splitmix(Math.round(key));
  const stageCount = 2 + Math.floor(next() * 2); // 2..3
  const teeth = new Float32Array(MAX_STAGES);
  const radius = new Float32Array(MAX_STAGES);
  const phase0 = new Float32Array(MAX_STAGES);
  const dir = new Float32Array(MAX_STAGES);
  let rad = 0.42 + next() * 0.08;
  for (let i = 0; i < MAX_STAGES; i++) {
    // Small tooth counts (6..13) so one tooth = a chunky, readable step.
    teeth[i] = 6 + Math.floor(next() * 8);
    radius[i] = rad;
    rad *= 0.62 + next() * 0.14;
    phase0[i] = next() * Math.PI * 2;
    dir[i] = i % 2 === 0 ? 1 : -1;
  }
  const foldBase = 3 + Math.floor(next() * 5); // 3..7 symmetry family
  const palette = next() * 3;
  const thirdsX = next() < 0.5 ? -1 / 3 : 1 / 3;
  const thirdsY = next() < 0.5 ? -1 / 3 : 1 / 3;
  const jx = (next() - 0.5) * 0.12;
  const jy = (next() - 0.5) * 0.12;
  const center: [number, number] = [thirdsX + jx, thirdsY + jy];
  const seed = next();
  return { stageCount, teeth, radius, phase0, dir, foldBase, palette, center, seed };
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

/** Group the 24-band spectrum into per-stage activity (inner=lows). */
function stageActivity(spectrum: number[], stageCount: number, out: Float32Array): void {
  const n = spectrum.length || 1;
  for (let i = 0; i < MAX_STAGES; i++) {
    if (i >= stageCount) {
      out[i] = 0;
      continue;
    }
    const lo = Math.floor((i / stageCount) * n);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) / stageCount) * n));
    let sum = 0;
    for (let b = lo; b < hi && b < n; b++) sum += spectrum[b] ?? 0;
    out[i] = Math.min(1, sum / Math.max(1, hi - lo));
  }
}

const g08OrreryTickPreset: VisualizerPreset = {
  id: 'g08-orrery-tick',
  name: 'g08 orrery-tick',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    let emaCentroid = 0.5;
    let emaBpm = 0;
    let seededKey: number | null = null;
    let mech: Mechanism = buildMechanism(1);
    let lastTrackId: number | null = null;
    let lastSection = -1;

    // --- Discrete tick STATE. One integer tooth counter per tier. These
    // NEVER interpolate — they step by exactly one on the tier's boundary.
    // The rendered angle = (toothCount / teeth) * 2π, plus a settle spring.
    const toothCount = new Int32Array(MAX_STAGES); // per-stage integer teeth stepped
    // Previous grid ordinals so we detect a boundary crossing (a "tick").
    let prevBeatCell = Number.NEGATIVE_INFINITY;
    let prevBar = Number.NEGATIVE_INFINITY;
    let prevPhrase = Number.NEGATIVE_INFINITY;
    let prevSection = Number.NEGATIVE_INFINITY;
    // Gridless pseudo-clock (when there is no beat grid).
    let pseudoBeat = 0;

    // Settle spring per stage: displacement + velocity, critically-damped
    // toward 0. On a tick we kick the velocity so the gear OVERSHOOTS the new
    // tooth and settles back — the second-hand catch. This is the ONLY
    // per-frame angular animation in the locked state, and it decays to rest.
    const settleDisp = new Float32Array(MAX_STAGES);
    const settleVel = new Float32Array(MAX_STAGES);

    // Free-run: on a drop the escapement unlocks and the whole train spins
    // continuously; when it locks again the angle CATCHES on the nearest tooth.
    let freeAngle = 0; // extra continuous angle applied to ALL stages while free
    let free = 0; // smoothed 0..1 unlock

    // Regime smoothing + strike/pendulum envelopes.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let strike = 0; // beat escapement strike envelope
    let release = 0;
    const act = new Float32Array(MAX_STAGES);
    const angOut = new Float32Array(MAX_STAGES);

    /** Tick a stage: step its integer tooth counter and arm the settle. */
    const tickStage = (i: number, snap: number): void => {
      toothCount[i] += mech.dir[i];
      // Overshoot proportional to one tooth's angular size (bigger teeth =>
      // bigger visible catch), scaled by the snap param + buildup.
      const toothAng = (Math.PI * 2) / Math.max(1, mech.teeth[i]);
      settleVel[i] += mech.dir[i] * toothAng * 6 * snap;
    };

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        // Clamp dt HARD (min 1/20 s). A dt spike (tab backgrounded, arena pane
        // resize stall) fed into an explicit spring integrator EXPLODES the
        // settle velocity geometrically, poisoning the feedback loop with
        // Inf/NaN permanently. 1/20 keeps every integrator well inside its
        // stability bound, and the settle below is now analytic anyway.
        const dt = lastTime > 0 ? Math.min(1 / 20, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const bpm = frame.beat?.bpm ?? 0;
        const slowAlpha = 1 - Math.exp(-dt / 15);
        emaCentroid += (frame.centroid - emaCentroid) * slowAlpha;
        if (bpm && bpm > 0) emaBpm += (bpm - emaBpm) * slowAlpha;

        // --- Identity / genome.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((emaCentroid * 4096 + emaBpm * 7 + energy * 97) * 131) || 1;
        if (seededKey == null) {
          seededKey = key;
          mech = buildMechanism(key);
          lastTrackId = trackId;
        } else if (trackId != null && trackId !== lastTrackId) {
          seededKey = key;
          mech = buildMechanism(key);
          lastTrackId = trackId;
          release = 1;
        }

        // --- Regime split (smoothed ~0.35 s). Derive bass-weighted drop.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, Math.max(smoothDrop, energy) * 1.35);

        // --- ESCAPEMENT UNLOCK: the clock runs free only under max(drop,
        // energy). Smoothed so the lock/unlock transition itself reads.
        const drive = Math.max(smoothDrop, energy);
        const freeTarget = clamp01((drive - 0.55) / 0.35); // threshold above sustained level
        free += (freeTarget - free) * (1 - Math.exp(-dt / 0.25));

        // --- Metric tiers (ladder-correct).
        const beat = frame.beat;
        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        const hasGrid = beat !== null && tierBar !== null;
        const barPhase = beat ? beat.barPhase : 0;
        const beatsPerBar = beat?.beatsPerBar ?? 4;

        // Compute the current grid ordinals. A change in any = a tick on that
        // tier. Integer things NEVER interpolate — we only compare ordinals.
        let beatCell: number;
        let bar: number;
        let phrase: number;
        let section: number;
        if (hasGrid) {
          const bi = tierBar as number;
          const beatWithinBar = Math.floor(clamp01(barPhase) * beatsPerBar);
          beatCell = bi * beatsPerBar + beatWithinBar;
          bar = bi;
          phrase = Math.floor(bi / PHRASE_BARS);
          section = Math.floor(bi / SECTION_BARS);
        } else {
          // Gridless pseudo-meter: keep ticking on an energy-driven clock.
          pseudoBeat += dt * (0.6 + 2.0 * energy);
          beatCell = Math.floor(pseudoBeat);
          bar = Math.floor(beatCell / beatsPerBar);
          phrase = Math.floor(bar / PHRASE_BARS);
          section = Math.floor(bar / SECTION_BARS);
        }

        const snap = frame.params.tickSnap ?? 1;

        // --- TICK the gears on their tier boundaries. Stage 0 = beat gear,
        // stage 1 = bar gear, stage 2 = phrase gear, stage 3+ = section wheel.
        // Only step when the ordinal actually advances (guards init + rewind).
        if (Number.isFinite(prevBeatCell) && beatCell !== prevBeatCell) {
          if (mech.stageCount > 0) tickStage(0, snap);
          // The beat tick IS the escapement strike (armed here; the kick
          // impulse lights it in the shader). Bigger on buildup.
          strike = 1;
        }
        if (Number.isFinite(prevBar) && bar !== prevBar) {
          if (mech.stageCount > 1) tickStage(1, snap);
        }
        if (Number.isFinite(prevPhrase) && phrase !== prevPhrase) {
          if (mech.stageCount > 2) tickStage(2, snap);
        }
        if (Number.isFinite(prevSection) && section !== prevSection) {
          // Section wheel = the last remaining stage (whichever exists).
          const sw = Math.min(mech.stageCount - 1, 3);
          if (sw >= 3) tickStage(sw, snap);
          release = 1;
          mech = { ...mech, foldBase: 3 + Math.floor(splitmix(seededKey! + section * 1013)() * 5) };
        }
        if (section !== lastSection && lastSection !== -1) {
          // (release handled above; keep lastSection for parity with parent)
        }
        lastSection = section;
        prevBeatCell = beatCell;
        prevBar = bar;
        prevPhrase = phrase;
        prevSection = section;

        // --- Advance the settle springs (critically damped toward rest).
        // omega picked so the catch settles in ~0.35 s — a readable second-hand
        // recoil, not a wobble. This is the ONLY locked-state animation.
        //
        // ANALYTIC critically-damped step (NOT explicit Euler). The parent
        // (orrery-calm) used a stable exp() decay; the -tick rewrite replaced
        // it with an explicit spring integrator (x += v*dt; v += a*dt) which is
        // only conditionally stable: with omega=18 it needs dt < 2/omega ≈ 0.11,
        // and a single stalled frame (dt pinned at the old 0.1 cap during a
        // resize/background) drives the velocity update factor to |1-2·omega·dt|
        // ≈ 2.6, so the displacement diverges geometrically to Inf → cos/sin of
        // an Inf angle in the shader = NaN → NaN written into the feedback
        // texture, which then accumulates forever (the pixel-soup smear). The
        // closed form below is EXACT for any dt and can never diverge:
        //   x(t) = (x0 + (v0 + omega·x0)·t)·e^(-omega·t)
        //   v(t) = (v0 - (v0 + omega·x0)·omega·t)·e^(-omega·t)
        const omega = 18;
        const decayE = Math.exp(-omega * dt);
        for (let i = 0; i < MAX_STAGES; i++) {
          const x0 = settleDisp[i];
          const v0 = settleVel[i];
          const c = v0 + omega * x0;
          settleDisp[i] = (x0 + c * dt) * decayE;
          settleVel[i] = (v0 - c * (omega * dt)) * decayE;
          // Belt-and-braces: if a prior bad frame already left NaN/Inf in the
          // spring state (e.g. from a hot-reload over a poisoned instance),
          // snap it back to rest instead of propagating it into the angle.
          if (!Number.isFinite(settleDisp[i]) || !Number.isFinite(settleVel[i])) {
            settleDisp[i] = 0;
            settleVel[i] = 0;
          }
        }

        // --- Strike + release envelopes decay.
        strike = Math.max(0, strike - dt / 0.22);
        release = Math.max(0, release - dt / 1.2);

        // --- FREE-RUN continuous angle: only accumulates while unlocked; when
        // it re-locks the continuous part decays away and the gear CATCHES on
        // its nearest tooth (the discrete tooth angle keeps its integer read).
        freeAngle += dt * free * (2.4 + 5.0 * smoothDrop) * 6.28318 * 0.25;
        if (free < 0.02) freeAngle *= Math.exp(-dt / 0.4); // catch: bleed off residue
        // freeAngle only ever feeds cos/sin, so wrap it to keep it bounded and
        // finite (an unbounded accumulator + a stray non-finite regime input
        // must never reach the shader as an Inf/NaN angle).
        if (!Number.isFinite(freeAngle)) freeAngle = 0;
        freeAngle = freeAngle % (Math.PI * 2);

        // --- Pendulum position: a slow swing synced to the beat phase so it
        // reads as the escapement's driver. Between beats it eases across;
        // wider on buildup (handled in shader). This is a BOUNDED swing.
        const beatPhase = beat ? beat.phase : (pseudoBeat % 1);
        const pend = Math.sin(beatPhase * Math.PI * 2) * (0.5 + 0.5 * smoothBuildup);

        // --- Compose per-stage ANGLE: discrete tooth position + settle recoil
        // + (only when free) the continuous run. NO base per-second term.
        for (let i = 0; i < MAX_STAGES; i++) {
          const toothAng = (Math.PI * 2) / Math.max(1, mech.teeth[i]);
          const a = toothCount[i] * toothAng + settleDisp[i] + freeAngle * mech.dir[i];
          // Final firewall: the shader takes cos/sin/atan of u_ang; a non-finite
          // value here becomes NaN in the frame and poisons the feedback loop.
          angOut[i] = Number.isFinite(a) ? a : 0;
        }

        // --- Spring tension (phrase): winds toward the phrase end.
        const phrasePhase =
          hasGrid && tierBar !== null
            ? ((((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS) + barPhase) / PHRASE_BARS
            : (bar % PHRASE_BARS) / PHRASE_BARS;
        const springWound =
          phrasePhase * phrasePhase * (Math.PI * 2.2) * (1 + 0.8 * smoothBuildup) * (1 - release);

        // --- Spacing / activity / color.
        const complexity = frame.params.complexity ?? 1;
        const spacing = complexity * (1 - 0.28 * smoothBuildup + 0.12 * smoothDrop);
        stageActivity(frame.spectrum, mech.stageCount, act);
        const edgeTravel = 1 + 1.0 * smoothBuildup + 0.5 * smoothDrop;

        const persistence = frame.params.persistence ?? 1;
        const baseDecay = 0.985 - 0.01 * smoothBuildup;
        const decay = Math.min(0.995, 1 - (1 - baseDecay) / persistence);

        const saturation = frame.params.saturation ?? 1;
        const sat = saturation * (0.9 + 0.55 * smoothBuildup + 0.35 * smoothDrop);

        // --- Strike bite: the visual kick strike rides impulse.low * param,
        // gated by the armed beat-tick envelope (strikes land ON the beat).
        const strikeGain = frame.params.strike ?? 1;
        const strikeOut = Math.min(1.6, strike * (0.5 + frame.impulse.low * strikeGain * 1.6));

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
          u_free: free,
          u_strike: strikeOut,
          u_pend: pend,
          u_spring: springWound,
          u_release: release,
          u_spacing: Math.max(0.4, spacing),
          u_hub: 0.5 + 0.5 * mech.seed,
          u_center: mech.center,
          u_stageCount: mech.stageCount,
          u_ang: angOut,
          u_radius: mech.radius,
          u_teeth: mech.teeth,
          u_act: act,
          u_phase0: mech.phase0,
          u_fold: mech.foldBase,
          u_palette: mech.palette,
          u_warm: emaCentroid,
          u_sat: sat,
          u_edgeTravel: edgeTravel,
          u_decay: decay,
          u_seed: mech.seed,
        };
      },
    });
  },
};

export default g08OrreryTickPreset;
