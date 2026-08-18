/**
 * "g07 orrery-calm" (gen-7 TWEAK of g06-orrery, note-driven legibility pass).
 *
 * Human note in play (verbatim): "cool idea, needs parameter tuning, a little
 * too fast right now to see anything". This candidate changes NOTHING
 * structural — the mechanical-solar-system metaphor, the trackId genome, the
 * period-lock, clutch/spring/release grammar, the additive neon SDF rendering
 * are all the parent's. It ONLY retunes for legibility, per the brief:
 *
 *  1. BASE ROTATION 3-4x SLOWER. The gear-train advance constant drops
 *     0.55 -> 0.15 (~3.7x). Ratios stay bpm-rational (unchanged RATIOS),
 *     so the train still turns on the music's clock — just slow enough to
 *     read. The idle drift fallback slows to match.
 *  2. FEWER, LARGER MECHANISMS. stageCount 2..3 (was 3..5); the nested
 *     inward shrink is gentler and the base radius larger, so gear structure
 *     reads at a glance instead of collapsing into a busy knot.
 *  3. CLUTCH PUNCHY, RECOIL SLOWER. The kick still injects a decisive
 *     angular lurch (same bite gain) but the recoil settles over ~0.5 s
 *     (was 0.18 s): visible cause, readable effect.
 *  4. MAINSPRING + SECTION REBUILD SLOWER. The section-release envelope
 *     decays over ~1.2 s (was 0.6 s) and dumps stored angle into the train
 *     more gradually — same concept, slower execution.
 *  5. PARAM DEFAULTS RETUNED. trainSpeed default (1) now maps to the CALM
 *     baseline; the slider's top still reaches lively.
 *  6. DRAMA KEPT. The drop releases stored angle into the FASTEST state —
 *     but "fast" now means the calm baseline's ~4x, which equals the old
 *     normal (drop multiplier 0.9 -> 3.6).
 *  7. CONTRAST. Deeper background (darker trail wash), brighter gear
 *     edge-light so the mechanism pops.
 *
 * GLSL discipline unchanged: ES 1.0, no backticks, constant stage loop masked
 * by u_stageCount, u_-arrays sized exactly MAX_STAGES and fully populated.
 *
 * Assigned tech: as parent — beat phase + bpm (period lock), bar/phrase/
 * section via beat.ladderBarIndex ?? beat.barIndex, 24-band spectrum per-stage
 * activity, impulses (kick clutch, snare glints), trackId genome.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

const MAX_STAGES = 5;

// --- GLSL --------------------------------------------------------------
// No backticks inside this string. The stage loop is a constant loop masked
// by u_stageCount; arrays are sized exactly MAX_STAGES and fully populated.
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low -> clutch bite glow
uniform float u_snare;       // impulse.mid -> gear-mesh glints (gated by high)
uniform float u_hat;         // impulse.high -> glint gate
uniform float u_drop;        // smoothed excitement WITH bass
uniform float u_buildup;     // smoothed excitement WITHOUT bass
uniform float u_sustain;     // bass-weighted sustained loudness (max(drop,energy) body)
uniform float u_train;       // master gear-train angle (bpm + clutch advance)
uniform float u_spring;      // wound spring angle (phrase tension), radians
uniform float u_release;     // 0..1 section-boundary release flash of stored angle
uniform float u_spacing;     // orbital spacing (buildup narrows it)
uniform float u_hub;         // 0..1 hub off-center placement bias (already in u_center)
uniform vec2  u_center;      // OFF-CENTER hub location, aspect-space
uniform float u_stageCount;  // active nested stages (masked in the constant loop)
uniform float u_ratio[5];    // per-stage rational bar-length ratio (rate multiplier)
uniform float u_radius[5];   // per-stage orbital radius
uniform float u_teeth[5];    // per-stage fine gear-tooth count
uniform float u_act[5];      // per-stage mechanism activity (24-band grouped)
uniform float u_phase0[5];   // per-stage seeded phase offset
uniform float u_fold;        // symmetry family fold count (rebuilds on section)
uniform float u_palette;     // seed palette family 0..3 (continuous)
uniform float u_warm;        // avg centroid -> palette temperature
uniform float u_sat;         // saturation surge (buildups saturate)
uniform float u_edgeTravel;  // saturated edge-color travel speed (buildup accel)
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
// Edge-light brightened for contrast against the deepened background.
float neon(float d, float w) {
  float core = exp(-d * d / (w * w));
  float halo = exp(-d * d / (w * w * 26.0)) * 0.35;
  return (core + halo) * 1.35;
}

// SDF of a ring (annulus centre-line) at radius r0.
float ringSDF(vec2 p, float r0) {
  return abs(length(p) - r0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // ---- Feedback: gentle inward advection so linework leaves short trails
  // that shear with the train rotation (mechanism motion continuity). Trails
  // are LOCAL to the drawn machinery, not a full-field wash.
  float fbRot = (u_train * 0.02) * (1.0 + u_drop);
  float fcs = cos(fbRot);
  float fsn = sin(fbRot);
  vec2 fp = mat2(fcs, -fsn, fsn, fcs) * (p - u_center) * (1.0 - 0.004 * (1.0 + u_drop)) + u_center;
  vec2 src = fp / vec2(aspect, 1.0) + 0.5;
  vec2 pix = 1.0 / u_res;
  vec3 fed = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, pix.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, pix.y)).rgb) * 0.25;
  // Deeper background: pull the trail down harder so the field falls to black
  // between machinery (contrast with the brightened edge-light).
  vec3 trail = max(vec3(0.0), fed * 1.24 - blur * 0.30) * u_decay;

  // ---- Hub-relative coordinate (OFF-CENTER). Everything hangs off the hub.
  vec2 hp = p - u_center;

  vec3 acc = vec3(0.0);

  // The mainspring: an Archimedean spiral coil whose wound angle = u_spring
  // (phrase tension). Drawn as a glowing coil near the hub; tightens toward
  // the phrase end, releases on section boundaries (u_release).
  {
    float ang = atan(hp.y, hp.x);
    float rr = length(hp);
    float turns = 4.0 + 3.0 * clamp(u_spring / 6.28318, 0.0, 2.0);
    // spiral radius for this angle (wrapped): r = a * (angle + k*2pi)
    float a0 = 0.02;
    float pitch = (0.05 + 0.03 * u_hub) / (1.0 + 0.4 * u_buildup); // buildup tightens
    // nearest coil distance via modular angle wrap
    float coilR = mod(rr - a0, pitch);
    float dCoil = min(coilR, pitch - coilR);
    float wound = smoothstep(turns * pitch + a0, a0, rr); // more coil visible when wound
    float spring = neon(dCoil, 0.006) * wound * (0.5 + 0.8 * u_buildup + 1.2 * u_release);
    vec3 springCol = palette(0.1 + 0.2 * u_buildup + u_time * 0.02 * u_edgeTravel);
    acc += springCol * spring * (0.6 + 0.5 * u_mid);
  }

  // ---- Nested orbital stages. Constant loop masked by u_stageCount.
  // Each stage: an eccentric hub + flywheel ring at u_radius[i], turning at
  // the bpm train scaled by its rational ratio; a connecting rod (arm) to the
  // next stage; a fine gear-tooth ring (highs). Kick advance rides in u_train.
  vec2 prevCentre = u_center;      // world-space stage centre (aspect coords are hub-rel here)
  vec2 stageCentre = vec2(0.0);    // hub-relative
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float active = step(fi + 0.5, u_stageCount);

    float ratio = u_ratio[i];
    float rad = u_radius[i] * u_spacing;      // buildup narrows spacing
    float teeth = u_teeth[i];
    float act = u_act[i];
    float ph0 = u_phase0[i];

    // Stage angle: master train * this stage's rational ratio. Period-locked.
    float ang = u_train * ratio + ph0;
    vec2 dir = vec2(cos(ang), sin(ang));
    // Eccentricity so hubs are NOT concentric circles (asymmetry + parallax).
    float ecc = 0.6 + 0.4 * sin(ph0 * 2.0);
    vec2 nextCentre = stageCentre + dir * vec2(rad, rad * ecc);

    // Position relative to THIS stage's centre.
    vec2 q = hp - stageCentre;

    // Flywheel ring (LOWS drive the solid eccentric hub/flywheel).
    float wheelR = rad * (0.42 + 0.18 * act);
    float dWheel = ringSDF(q, wheelR);
    float wheelGlow = neon(dWheel, 0.006 + 0.004 * u_low);
    vec3 wheelCol = palette(0.05 * fi + 0.12 * u_low + u_time * 0.015 * u_edgeTravel);
    acc += wheelCol * wheelGlow * active * (0.35 + 1.1 * u_low + 0.7 * act) * (0.6 + 0.6 * u_sustain);

    // Solid eccentric hub: a small filled disc at the stage centre (LOW body).
    float dHub = length(q);
    float hubGlow = exp(-dHub * dHub / (0.0009 + 0.0016 * u_low)) ;
    acc += wheelCol * hubGlow * active * (0.4 + 0.9 * u_low);

    // Spokes: MID articulated arms fanning from the hub to the wheel rim.
    // Folded angular symmetry (the seed's symmetry family, rebuilt on section).
    {
      float aa = atan(q.y, q.x) + ang;              // spokes co-rotate with the stage
      float fold = max(2.0, u_fold);
      float sector = 6.28318 / fold;
      float ad = abs(mod(aa, sector) - sector * 0.5);
      float spoke = neon(ad * (wheelR + 0.001), 0.004);
      float within = smoothstep(wheelR + 0.01, 0.0, dHub); // only inside the wheel
      vec3 armCol = palette(0.4 + 0.1 * fi + u_time * 0.02 * u_edgeTravel);
      acc += armCol * spoke * within * active * (0.3 + 1.4 * u_mid + 0.6 * act);
    }

    // Fine gear teeth (HIGHS): a serrated ring at the wheel rim.
    {
      float aa = atan(q.y, q.x) * teeth;
      float toothMod = abs(fract(aa) - 0.5) * 2.0;   // 0..1 saw
      float dTeeth = abs(dWheel) + toothMod * 0.010;
      float teethGlow = neon(dTeeth, 0.0035) * (0.4 + 1.2 * u_high);
      vec3 teethCol = palette(0.7 + 0.05 * fi + u_time * 0.03 * u_edgeTravel);
      acc += teethCol * teethGlow * active * (0.25 + 0.9 * u_high + 0.5 * act);

      // SNARE GEAR-MESH GLINTS: white-hot metal catching light at the mesh
      // point where this wheel meets the arm to the next stage. Tiny +
      // localized (photosensitivity floor). Gated by snare*hat.
      vec2 meshPt = normalize(nextCentre - stageCentre + 1e-4) * wheelR;
      float dMesh = length(q - meshPt);
      float glint = exp(-dMesh * dMesh / 0.00035);
      float glintGate = u_snare * (0.4 + 0.8 * u_hat);
      acc += mix(vec3(1.0), teethCol, 0.4) * glint * active * glintGate * 1.6;
    }

    // Connecting rod (arm) from this stage centre to the next stage centre:
    // the CONNECTED machinery — no free-floating orbits. Line segment SDF.
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

    // CLUTCH BITE: on a kick, the mesh point between this stage and the next
    // glows as the clutch engages and advances the train (physical, not a
    // flash). Localized to the mesh region.
    {
      vec2 meshPt = (stageCentre + nextCentre) * 0.5;
      float dClutch = length(hp - meshPt);
      float clutch = exp(-dClutch * dClutch / 0.0016) * u_kick;
      acc += palette(0.6 + u_time * 0.05) * clutch * active * (0.9 + 1.2 * u_low);
    }

    stageCentre = nextCentre;
    prevCentre = nextCentre;
  }
  // keep prevCentre referenced (asymmetric silhouette anchor); no-op consumer.
  acc += vec3(0.0) * dot(prevCentre, prevCentre);

  // ---- Section-release burst: a fast expanding ring from the hub marking
  // the stored-angle release + rebuild (localized pulse, exempt from the
  // flash cap; still soft-kneed below).
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
  // Brighter fresh linework (2.9 vs 2.6) so the mechanism pops on the deeper bg.
  vec3 outc = trail + acc * (1.0 - u_decay) * 2.9;

  // Chroma-preserving soft knee (never per-channel clamp).
  float mx = max(outc.r, max(outc.g, outc.b));
  if (mx > 0.85) {
    outc *= (0.85 + 0.15 * (1.0 - exp(-(mx - 0.85) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(outc, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  // trainSpeed default (1) now maps to the CALM baseline; the range still
  // reaches lively at the top.
  { id: 'trainSpeed', label: 'gear-train speed', min: 0.3, max: 2.5, step: 0.05, default: 1 },
  // Fewer, larger mechanisms read at a glance; default trimmed.
  { id: 'complexity', label: 'mechanism complexity', min: 0.3, max: 1.6, step: 0.05, default: 0.85 },
  { id: 'persistence', label: 'feedback persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'clutch', label: 'kick clutch bite', min: 0.2, max: 2.5, step: 0.05, default: 1 },
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

/** Rational bar-length ratios the stages lock to — small integers so the
 * train reads as a real gear ratio, not free drift. Calm favours the LONGER
 * bar multiples (slower stages) so gear structure reads: the fast ratios (3,
 * 1.5) are dropped, the slow ones (1/8, 1/4, 1/2, 2/3, 1) kept and weighted
 * toward the low end. */
const RATIOS = [1, 0.5, 0.25, 2 / 3, 0.5, 0.125, 0.25];

interface Mechanism {
  stageCount: number;
  ratio: Float32Array;
  radius: Float32Array;
  teeth: Float32Array;
  phase0: Float32Array;
  foldBase: number;
  palette: number;
  center: [number, number];
  seed: number;
}

/** Build a mechanism from a seed key. Off-center hub at a rule-of-thirds
 * point; nested stages with rational ratios and seeded teeth/phase. Calm:
 * FEWER, LARGER stages so the gear structure reads at a glance. */
function buildMechanism(key: number): Mechanism {
  const next = splitmix(Math.round(key));
  // Fewer mechanisms: 2..3 (was 3..MAX_STAGES).
  const stageCount = 2 + Math.floor(next() * 2); // 2..3
  const ratio = new Float32Array(MAX_STAGES);
  const radius = new Float32Array(MAX_STAGES);
  const teeth = new Float32Array(MAX_STAGES);
  const phase0 = new Float32Array(MAX_STAGES);
  // Larger base radius so mechanisms fill the frame and read individually.
  let rad = 0.42 + next() * 0.08;
  for (let i = 0; i < MAX_STAGES; i++) {
    ratio[i] = RATIOS[Math.floor(next() * RATIOS.length)] * (i % 2 === 0 ? 1 : -1);
    radius[i] = rad;
    // Gentler inward shrink (0.62..0.76 vs 0.5..0.68) keeps children large.
    rad *= 0.62 + next() * 0.14; // nested inward, but stays large
    // Fewer teeth per gear so the toothing reads instead of shimmering.
    teeth[i] = 6 + Math.floor(next() * 8); // 6..13 teeth (was 8..23)
    phase0[i] = next() * Math.PI * 2;
  }
  const foldBase = 3 + Math.floor(next() * 5); // 3..7 symmetry family
  const palette = next() * 3;
  // OFF-CENTER hub: pick one of the four rule-of-thirds points, jittered.
  const thirdsX = next() < 0.5 ? -1 / 3 : 1 / 3;
  const thirdsY = next() < 0.5 ? -1 / 3 : 1 / 3;
  const jx = (next() - 0.5) * 0.12;
  const jy = (next() - 0.5) * 0.12;
  const center: [number, number] = [thirdsX + jx, thirdsY + jy];
  const seed = next();
  return { stageCount, ratio, radius, teeth, phase0, foldBase, palette, center, seed };
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

/** Group the 24-band spectrum into per-stage activity: inner stages read the
 * lows, outer stages the highs (mechanism activity scales inward-to-outward
 * with the spectrum). */
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

const g07OrreryCalmPreset: VisualizerPreset = {
  id: 'g07-orrery-calm',
  name: 'g07 orrery-calm',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // Slow stats (tau ~15 s) for the pseudo-seed + palette warmth.
    let emaCentroid = 0.5;
    let emaBpm = 0;
    // Genome / identity.
    let seededKey: number | null = null;
    let mech: Mechanism = buildMechanism(1);
    let lastTrackId: number | null = null;
    let lastSection = -1;
    // Beat train clock (the master gear-train angle, bpm + clutch advance).
    let train = 0;
    // Spring winding (phrase tension) and section-release envelope.
    let release = 0;
    // Regime smoothing.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    // Per-stage activity scratch.
    const act = new Float32Array(MAX_STAGES);
    // Kick clutch: a decaying angular advance injected into the train.
    let clutchVel = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        // --- Slow stats.
        const energy = energyOf(frame.bands);
        const bpm = frame.beat?.bpm ?? 0;
        const slowAlpha = 1 - Math.exp(-dt / 15);
        emaCentroid += (frame.centroid - emaCentroid) * slowAlpha;
        if (bpm && bpm > 0) emaBpm += (bpm - emaBpm) * slowAlpha;

        // --- Identity: dominant trackId seeds the mechanism; a change
        // rebuilds it. No trackId => freeze slow stats into a pseudo-seed.
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
          release = 1; // treat a track change as a section-style rebuild
        }

        // --- Regime split (smoothed ~0.35 s). trend has NO drop field:
        // derive a bass-weighted drop from excitement × low presence.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        // Sustained body rides max(drop, energy) so it survives the plateau.
        const sustained = Math.min(1, Math.max(smoothDrop, energy) * 1.35);

        // --- Bar/phrase/section tiers (ladder-correct).
        const beat = frame.beat;
        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        const barPhase = beat ? beat.barPhase : 0;
        // Phrase phase (%4 bars) — winds the mainspring toward the phrase end.
        const phrasePhase =
          beat && tierBar !== null ? ((((tierBar % 4) + 4) % 4) + barPhase) / 4 : 0;
        // Section index (%16 bars).
        const section = tierBar !== null ? Math.floor(tierBar / 16) : -1;
        if (section !== lastSection && lastSection !== -1) {
          // Section boundary: release stored spring angle, re-seed symmetry.
          release = 1;
          mech = { ...mech, foldBase: 3 + Math.floor(splitmix(seededKey! + section * 1013)() * 5) };
        }
        lastSection = section;
        // Section rebuild SLOWER: envelope decays over ~1.2 s (was 0.6 s).
        release = Math.max(0, release - dt / 1.2);

        // --- Gear-train clock: bpm-locked (period-locked). Advance per BEAT,
        // not per second, so different tempos turn on different clocks.
        const trainSpeed = frame.params.trainSpeed ?? 1;
        // Idle fallback beat rate slowed to match the calm baseline (was 2).
        const beatRate = emaBpm > 0 ? emaBpm / 60 : 1;
        // KICK = CLUTCH: inject a decaying angular advance (a lurch), never a
        // flash. clutch param scales the bite. Bite gain UNCHANGED (punchy);
        // the recoil settles SLOWER (~0.5 s vs 0.18 s) — visible cause.
        const clutchGain = frame.params.clutch ?? 1;
        clutchVel += frame.impulse.low * clutchGain * 1.4;
        clutchVel *= Math.exp(-dt / 0.5); // slower recoil -> readable lurch
        // BASE RATE 3-4x SLOWER: 0.55 -> 0.15 (~3.7x). DROP still releases
        // into the FASTEST state, but "fast" now equals the old normal
        // (drop multiplier 0.9 -> 3.6, so 0.15*(1+3.6) ~ old 0.55*(1+0.9)).
        train +=
          dt * beatRate * 0.15 * trainSpeed * (1 + 3.6 * smoothDrop) +
          clutchVel * dt +
          // section release dumps the stored spring angle into the train, more
          // gradually now (6.0 -> 3.0) so the rebuild reads.
          release * dt * 3.0;

        // --- Spring tension: wound angle grows with phrase phase + buildup;
        // released on section boundary (envelope handled in shader via
        // u_release, but the wound magnitude reads the phrase here).
        const springWound =
          (phrasePhase * phrasePhase) * (Math.PI * 2.2) * (1 + 0.8 * smoothBuildup) * (1 - release);

        // --- Orbital spacing: buildup NARROWS it (tension); drop restores.
        const complexity = frame.params.complexity ?? 1;
        const spacing = complexity * (1 - 0.28 * smoothBuildup + 0.12 * smoothDrop);

        // --- Per-stage activity from the 24-band spectrum.
        stageActivity(frame.spectrum, mech.stageCount, act);

        // --- Edge-color travel accelerates on buildups. Calm: gentler travel
        // so the color drift is legible (2.2 -> 1.0, 0.8 -> 0.5).
        const edgeTravel = 1 + 1.0 * smoothBuildup + 0.5 * smoothDrop;

        // --- Feedback persistence.
        const persistence = frame.params.persistence ?? 1;
        const baseDecay = 0.985 - 0.01 * smoothBuildup;
        const decay = Math.min(0.995, 1 - (1 - baseDecay) / persistence);

        // --- Saturation: buildups saturate, drops stay saturated.
        const saturation = frame.params.saturation ?? 1;
        const sat = saturation * (0.9 + 0.55 * smoothBuildup + 0.35 * smoothDrop);

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
          u_train: train,
          u_spring: springWound,
          u_release: release,
          u_spacing: Math.max(0.4, spacing),
          u_hub: 0.5 + 0.5 * mech.seed,
          u_center: mech.center,
          u_stageCount: mech.stageCount,
          u_ratio: mech.ratio,
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

export default g07OrreryCalmPreset;
