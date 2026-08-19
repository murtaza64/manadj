/**
 * "g06 orrery" (genetic arena g06, novel — sol-review concept "Neon Orrery").
 *
 * A mechanical solar system rendered as neon SDF linework. The premise:
 * make bpm and phrase STRUCTURE legible through a MECHANICAL metaphor —
 * nested gear trains, eccentric flywheels, articulated arms and springs —
 * rather than free-floating particles. Everything is CONNECTED machinery.
 * The falsifiable question the brief poses: does a gears/springs/clutches
 * metaphor make musical structure readable where particle fields haven't?
 *
 * The board is a trackId GENOME (shared g0x-hash pattern): a splitmix
 * avalanche of the dominant audible deck's trackId picks the mechanism
 * VOCABULARY — how many nested orbital stages, the rational bar-length
 * ratio each stage locks to, the symmetry-fold family of the fine gear
 * teeth, the palette family, and the OFF-CENTER hub placement (a
 * rule-of-thirds point, never a centered mandala). Same song => same
 * mechanism, every play. No trackId => the slow spectral stats freeze into
 * a pseudo-seed.
 *
 * MECHANICS (the invariants):
 *  - PERIOD-LOCKED to bpm: each orbital stage's angular rate is bpm scaled
 *    by a RATIONAL bar-length ratio (1, 1/2, 1/4, 2/3 ...). The whole train
 *    advances on a beat clock, so a 174 mix and a 122 mix visibly turn on
 *    different clocks. Nothing runs on wall-time except a faint idle drift.
 *  - KICK = CLUTCH ENGAGEMENT: impulse.low physically ADVANCES the gear
 *    train — a stepped angular kick fed into the beat clock (a decisive
 *    lurch), never a flash. The clutch glows at the mesh point as it bites.
 *  - PHRASE = VISIBLE SPRING TENSION: the phrase phase (from
 *    ladderBarIndex ?? barIndex) winds a mainspring spiral tighter toward
 *    the phrase end; the wound angle is drawn as a compressing coil.
 *  - SECTION BOUNDARY = RELEASE + REBUILD: a %16 section change releases the
 *    stored spring angle into the train (a fast advance) and re-seeds the
 *    symmetry family, so the mechanism rebuilds into a new symmetry.
 *  - SNARE = GEAR-MESH GLINTS: impulse.mid (gated up by impulse.high)
 *    lights small white-hot metal GLINTS at the tooth-contact points — light
 *    catching teeth, restricted to tiny mesh regions (photosensitivity
 *    floor). NOT filings, NOT dust, NOT particles.
 *  - BUILDUP: winds springs tighter, saturated edge-color travels faster,
 *    orbital spacing NARROWS (tension), without prematurely releasing.
 *  - DROP: releases stored angle into a decisive topology change + sustained
 *    fast operation, riding max(drop, energy) so it survives the plateau.
 *
 * The 24-band spectrum drives per-stage mechanism ACTIVITY: lows animate the
 * solid eccentric hubs/flywheels, mids the articulated arms, highs the fine
 * gear teeth. Rendering is additive neon SDF: rings, gear-tooth rings,
 * spokes, connecting rods and the spring spiral, all as glowing lines.
 *
 * GLSL discipline: ES 1.0 only, no backticks in the source; the stage loop
 * is a CONSTANT loop (MAX_STAGES fixed) masked by u_stageCount; u_-array
 * uniforms are sized exactly as declared and always fully populated JS-side.
 *
 * Assigned tech: beat phase + bpm (primary period lock), bar/phrase/section
 * via beat.ladderBarIndex ?? beat.barIndex, 24-band spectrum for per-stage
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
float neon(float d, float w) {
  float core = exp(-d * d / (w * w));
  float halo = exp(-d * d / (w * w * 26.0)) * 0.35;
  return core + halo;
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
  vec3 trail = max(vec3(0.0), fed * 1.28 - blur * 0.28) * u_decay;

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
  vec3 outc = trail + acc * (1.0 - u_decay) * 2.6;

  // Chroma-preserving soft knee (never per-channel clamp).
  float mx = max(outc.r, max(outc.g, outc.b));
  if (mx > 0.85) {
    outc *= (0.85 + 0.15 * (1.0 - exp(-(mx - 0.85) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(outc, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'trainSpeed', label: 'gear-train speed', min: 0.3, max: 2.5, step: 0.05, default: 1 },
  { id: 'complexity', label: 'mechanism complexity', min: 0.3, max: 1.6, step: 0.05, default: 1 },
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
 * train reads as a real gear ratio, not free drift. */
const RATIOS = [1, 0.5, 0.25, 2 / 3, 1.5, 0.125, 3];

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
 * point; nested stages with rational ratios and seeded teeth/phase. */
function buildMechanism(key: number): Mechanism {
  const next = splitmix(Math.round(key));
  const stageCount = 3 + Math.floor(next() * (MAX_STAGES - 2)); // 3..MAX_STAGES
  const ratio = new Float32Array(MAX_STAGES);
  const radius = new Float32Array(MAX_STAGES);
  const teeth = new Float32Array(MAX_STAGES);
  const phase0 = new Float32Array(MAX_STAGES);
  let rad = 0.34 + next() * 0.08;
  for (let i = 0; i < MAX_STAGES; i++) {
    ratio[i] = RATIOS[Math.floor(next() * RATIOS.length)] * (i % 2 === 0 ? 1 : -1);
    radius[i] = rad;
    rad *= 0.5 + next() * 0.18; // nested inward
    teeth[i] = 8 + Math.floor(next() * 16); // 8..23 teeth
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

const g06OrreryPreset: VisualizerPreset = {
  id: 'g06-orrery',
  name: 'g06 orrery',
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
        release = Math.max(0, release - dt / 0.6);

        // --- Gear-train clock: bpm-locked (period-locked). Advance per BEAT,
        // not per second, so different tempos turn on different clocks.
        const trainSpeed = frame.params.trainSpeed ?? 1;
        const beatRate = emaBpm > 0 ? emaBpm / 60 : 2;
        // KICK = CLUTCH: inject a decaying angular advance (a lurch), never a
        // flash. clutch param scales the bite.
        const clutchGain = frame.params.clutch ?? 1;
        clutchVel += frame.impulse.low * clutchGain * 1.4;
        clutchVel *= Math.exp(-dt / 0.18); // fast decay -> a lurch, then settle
        train +=
          dt * beatRate * 0.55 * trainSpeed * (1 + 0.9 * smoothDrop) +
          clutchVel * dt +
          // section release dumps the stored spring angle into the train
          release * dt * 6.0;

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

        // --- Edge-color travel accelerates on buildups.
        const edgeTravel = 1 + 2.2 * smoothBuildup + 0.8 * smoothDrop;

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

export default g06OrreryPreset;
