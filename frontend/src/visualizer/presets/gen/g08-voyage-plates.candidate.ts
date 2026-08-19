/**
 * "g08 voyage-plates" (gen-8, MEDIUM REPLACEMENT of voyage's dust wash).
 *
 * The screenshot proved voyage/odyssey descendants all inherit the same
 * advected fine-dust feedback and read as one blue wash. This candidate
 * REPLACES the mass technique: instead of dust, the medium is a field of
 * DRIFTING RIGID PLATES — voronoi-cut glass/crystal slabs arranged in
 * concentric orbital SHELLS. Each plate has a normal that tilts as it
 * drifts, and it FLASHES specular when its facing aligns with the light,
 * so the medium reads as solid, individually-legible bodies (not gas).
 *
 * Rigid-body glass-pane language raided from g05-tunnel-shatter (the
 * voronoi pane lattice, the crack pulse, the shard glint). The feedback
 * buffer is kept only as a faint reflection sheen behind the plates — it
 * is NOT the medium; the plates are drawn fresh, opaque, every frame.
 *
 * Band mapping (law: LOWS = mass, MIDS = color, HIGHS = edge detail):
 *   LOWS  → plate size / count balance. Heavy bass = massive slabs
 *           (coarse cells, few big plates); bass kill = small sparse chips.
 *   MIDS  → plate tint travel (committed emerald/magenta identity; the
 *           palette param swaps among 3 committed duos).
 *   HIGHS → edge glint sharpness + micro-fracture detail on each slab.
 *
 * Transients / structure:
 *   kick     → a ripple TILTS the plates in its wake: a wave of specular
 *              flashes travels outward (solid, readable — not powder).
 *   snare    → one plate cracks locally (a bright fracture seam).
 *   beat     → each shell advances its rotation one QUANTIZED notch
 *              (beat.ladderBarIndex ?? beat.barIndex + beat phase).
 *   drop     → plates ALIGN into a single reflective plane (one blinding
 *              coplanar flash) then EXPLODE into tumble, riding
 *              max(drop, energy).
 *   buildup  → plates go edge-on: dark, knife-like tension (never still —
 *              they still jitter).
 *   section  → shell topology change (shell count cycles).
 *
 * Palette duos (committed, param swaps among the three):
 *   0 emerald / magenta   (identity)
 *   1 gold / cobalt
 *   2 cyan / crimson
 *
 * Hard rules honoured: GLSL ES 1.0, no backticks in GLSL, shell arrays are
 * flat u_-arrays read with a constant-index loop; chroma-preserving soft
 * knee; photosafe (localized specular pulses, whole-field flash rate
 * limited); bright saturated colors.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { UniformValue } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

/** Number of orbital shells (max; active count is driven by section). */
const SHELL_N = 5;

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
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_cellScale;   // LOWS: plate size (small = big slabs)
uniform float u_edge;        // HIGHS: edge glint sharpness + micro-fracture
uniform float u_rippleAge;   // seconds since last strong kick
uniform float u_rippleAmp;
uniform float u_align;        // 0 tumble .. 1 coplanar (drop pre-explosion)
uniform float u_explode;      // drop explosion tumble energy
uniform float u_beatPump;
uniform float u_shellCount;   // active shells (section topology)
uniform float u_crackAng;     // snare crack angle
uniform float u_crackAge;     // snare crack age
uniform vec3 u_duoA;          // MIDS: committed duo, first tint
uniform vec3 u_duoB;          // committed duo, second tint
uniform float u_shellRot[5];  // per-shell quantized rotation (flat array)

const float PI = 3.141592653589793;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Voronoi pane lattice (raided from g05-tunnel-shatter). Returns:
//   .x  = distance to the second-nearest site minus the nearest (the seam
//         / mortar width — 0 exactly on a plate edge),
//   .yz = the nearest plate's integer cell id.
vec3 panes(vec2 p) {
  vec2 g = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 nearest = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 pt = o + hash2(g + o) * 0.85 + 0.075;
      float d = length(pt - f);
      if (d < d1) { d2 = d1; d1 = d; nearest = g + o; }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(d2 - d1, nearest);
}

// Constant-index lookup into the flat per-shell rotation array (GLSL ES
// 1.0 forbids dynamic indexing of a uniform array).
float shellRotAt(int idx) {
  float v = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k == idx) v = u_shellRot[k];
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Faint feedback sheen ONLY: a soft mirror of the last frame so the
  // plates leave a specular smear, decayed hard so it never becomes a wash.
  vec2 sheenSrc = uv - dirW * (0.004 + 0.02 * u_kick) / vec2(aspect, 1.0);
  vec3 sheen = texture2D(u_prev, sheenSrc).rgb * u_decay * 0.55;
  // Kill any low-level haze so the field reads as black space with solids.
  sheen *= smoothstep(0.02, 0.14, max(sheen.r, max(sheen.g, sheen.b)));

  // ---- The traveling kick ripple: a radial wavefront that TILTS the
  // plates it passes (drives a specular flash outward). Solid, readable.
  float waveFront = 0.12 + u_rippleAge * 0.95;
  float rippleWave = exp(-pow((r - waveFront) * 8.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;

  // Light direction sweeps slowly so plates catch it as they drift.
  vec2 lightDir = normalize(vec2(cos(t * 0.25), sin(t * 0.19)));

  vec3 plates = vec3(0.0);
  float coverBright = 0.0; // accumulates coplanar-flash luminance for knee

  // ---- Orbital shells: concentric rings, each a rigid lattice of plates
  // that rotates as ONE body at its own quantized notch. Nearer shells are
  // finer; bass thickens the cells (fewer, bigger slabs).
  for (int s = 0; s < 5; s++) {
    float sf = float(s);
    if (sf > u_shellCount - 0.5) continue;

    // This shell's radial band (an orbital ring).
    float shellR = 0.16 + sf * 0.165;
    float band = exp(-pow((r - shellR) * (3.6 + 0.5 * u_edge), 2.0));
    if (band < 0.002) continue;

    // Rotate this shell rigidly by its quantized notch + a slow drift.
    float rot = shellRotAt(s) + t * (0.05 + 0.03 * sf) * (sf * 2.0 - 4.0 >= 0.0 ? 1.0 : -1.0);
    float a2 = ang + rot;

    // Lattice space: angle around the shell, radius across it. Bass coarsens
    // the cells (u_cellScale small = big plates); highs add micro-fracture.
    float cells = u_cellScale * (5.0 + sf * 2.0);
    vec2 latUv = vec2(a2 / PI * cells, (r - shellR) * (cells * 0.6) + sf * 3.7);
    vec3 pane = panes(latUv);
    float plateId = hash(pane.yz + sf * 5.3 + 1.7);

    // Per-plate NORMAL: each slab tilts on two axes. Its tilt drifts, the
    // kick ripple pushes it, the drop aligns it flat, the explosion
    // scatters it. This normal vs the light gives the specular flash — the
    // whole reason the medium reads as solid bodies.
    vec2 nrnd = hash2(pane.yz + sf * 2.1) * 2.0 - 1.0;
    float tumble = (0.6 + 0.4 * u_explode) * (1.0 - u_align);
    float nx = nrnd.x * tumble + 0.5 * sin(t * (0.7 + plateId) + plateId * 30.0) * tumble;
    float ny = nrnd.y * tumble + 0.5 * cos(t * (0.6 + plateId) + plateId * 21.0) * tumble;
    // Kick ripple tilts plates in its wake toward the light.
    nx += rippleWave * 1.6 * sign(lightDir.x);
    ny += rippleWave * 1.6 * sign(lightDir.y);
    // Buildup drives plates edge-on (normal perpendicular to view): knife.
    float edgeOn = u_buildup;
    vec3 normal = normalize(vec3(nx, ny, 1.4 - 1.3 * edgeOn + 2.0 * u_align));

    // Specular: blinn-style, sharpened by highs. Aligns all plates on drop.
    float ndl = max(0.0, dot(normal, vec3(lightDir, 0.85)));
    float spec = pow(ndl, 8.0 + 40.0 * u_edge + 60.0 * u_align);
    // Coplanar flash: on full align every plate faces front -> one plane.
    float coplanar = pow(max(0.0, normal.z), 6.0) * u_align;
    float facing = spec + coplanar;

    // Plate interior fill: a dim solid facet so the body reads even unlit.
    float interior = smoothstep(0.02, 0.09 + 0.05 * u_edge, pane.x);
    float bodyFill = interior * (0.10 + 0.35 * plateId);

    // Edge glint (HIGHS): the seam between plates lights up, sharpness by
    // u_edge; micro-fracture = a second finer voronoi on the edge only.
    float seam = 1.0 - smoothstep(0.0, 0.02 + 0.05 / (1.0 + u_edge * 3.0), pane.x);
    float micro = 0.0;
    if (seam > 0.01) {
      vec3 mp = panes(latUv * (4.0 + 6.0 * u_edge) + 13.0);
      micro = (1.0 - smoothstep(0.0, 0.05, mp.x)) * u_edge;
    }
    float glint = (seam + 0.6 * micro) * (0.3 + 1.4 * u_high + 1.2 * u_kick);

    // Tint travels across the committed duo (MIDS): plate id + drift picks
    // where on the emerald<->magenta axis this slab sits; mid energy widens
    // the spread so a busy midrange spans the whole duo.
    float tintMix = 0.5 + 0.5 * sin(plateId * 6.28 + t * 0.4 * (0.3 + u_mid)
      + u_centroid * 2.0 + sf * 0.9);
    vec3 tint = mix(u_duoA, u_duoB, tintMix);

    // Compose this shell's contribution: solid body + bright facing flash +
    // hot edge glint. Facing flash pushes toward white-hot for the specular.
    vec3 plateCol = tint * bodyFill
      + mix(tint, vec3(1.0), 0.65) * facing * (0.6 + 1.1 * u_mid + 0.8 * u_sustain)
      + mix(tint, vec3(1.0), 0.5) * glint;

    plates += plateCol * band;
    coverBright += coplanar * band;

    // Snare crack on ONE plate (localized fracture seam near crackAng).
    float dA = abs(atan(sin(a2 - u_crackAng), cos(a2 - u_crackAng)));
    float crackHere = exp(-dA * 6.0) * exp(-u_crackAge * 6.0) * band;
    plates += mix(u_duoB, vec3(1.0), 0.6) * seam * crackHere * 2.2;
  }

  // ---- Central hard core: a bright bass-driven slab hub so lows land solid
  // (kick = solid response, never powder). Sharp-edged, not a glow cloud.
  float coreEdge = smoothstep(0.11 + 0.03 * u_low, 0.09, r);
  vec3 core = mix(u_duoA, vec3(1.0, 0.95, 0.9), 0.4 * u_kick)
    * coreEdge * (0.3 + 1.6 * u_low + 2.2 * u_kick);
  plates += core;

  // Kick shock: a solid ring (bass = solid) that lights the plates it hits.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 32.0, 2.0));
    plates += mix(u_duoA, vec3(1.0), 0.5) * shock * u_kick * (1.0 + 0.8 * u_drop);
  }

  vec3 col = sheen + plates;

  // Drop explosion: a brief additive bloom along the ripple front so the
  // "align then explode" reads as a burst, RATE-LIMITED (photosafe) by
  // riding the localized wavefront, not a full-field strobe.
  col += mix(u_duoA, u_duoB, 0.5) * rippleWave * u_explode * 0.9;

  // Whole-frame coplanar flash is the ONE full-field event; clamp it hard
  // so the drop align never becomes a >3Hz luminance strobe (WCAG 2.3.1).
  col += vec3(1.0) * min(0.35, coverBright * 0.25) * u_align;

  col *= 1.0 + 0.06 * u_beatPump;

  // Overall dynamics: drops bloom, buildups darken (edge-on tension), and
  // the plateau rides max(drop, sustain) so it stays alive.
  col *= 0.7 + 0.5 * max(u_drop, u_sustain) - 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp): compress luma,
  // keep hue — the specular flashes read as bright metal, not white-out.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

type Rgb = [number, number, number];

/** Three committed palette duos [A, B]. Bright, fully saturated. */
const DUOS: [Rgb, Rgb][] = [
  [[0.05, 0.95, 0.55], [1.0, 0.12, 0.7]], // 0 emerald / magenta (identity)
  [[1.0, 0.78, 0.1], [0.15, 0.4, 1.0]], // 1 gold / cobalt
  [[0.1, 0.9, 1.0], [1.0, 0.15, 0.25]], // 2 cyan / crimson
];

/** Shell-count topology cycle (section boundaries walk this). */
const SHELL_CYCLE = [3, 4, 5, 4];

export const g08VoyagePlatesPreset: VisualizerPreset = {
  id: 'g08-voyage-plates',
  name: 'g08 voyage-plates',
  hiRes: true,
  params: [
    { id: 'plateSize', label: 'plate size (bass slabs)', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette duo (0 emerald/mag, 1 gold/cobalt, 2 cyan/crimson)', min: 0, max: 2, step: 1, default: 0 },
    { id: 'persistence', label: 'sheen persistence', min: 0.5, max: 1.5, step: 0.05, default: 1 },
    { id: 'glint', label: 'edge glint', min: 0.3, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;

    // Per-shell quantized rotation: advances one notch each new beat.
    const shellRot = new Float32Array(SHELL_N);
    let prevBeatCount: number | null = null;

    // Section topology (shell count), eased.
    let shellIndex = 0;
    let shellCount = SHELL_CYCLE[0];
    let prevSectionTier: number | null = null;

    // Drop genome: align-then-explode.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let prevDrop = 0;
    let lastDropAt = -99;
    let align = 0; // eased toward alignTarget
    let alignTarget = 0;
    let explode = 0;
    let alignPhaseUntil = -99;

    // Kick ripple.
    let rippleAge = 999;
    let rippleAmp = 0;

    // Snare crack.
    let crackAng = 0;
    let crackAge = 99;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData): Record<string, UniformValue> => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const beat = frame.beat;

        const plateSize = frame.params.plateSize ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const glint = frame.params.glint ?? 1;
        const duoIdx = Math.max(0, Math.min(2, Math.round(frame.params.palette ?? 0)));
        const [duoA, duoB] = DUOS[duoIdx];

        // ---- Drop / buildup split (voyage pattern): excitement gated by
        // bass, smoothed ~0.35 s so regimes don't flip harshly.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(smoothDrop, 0.7 * sustained);

        // ---- Ladder-correct tiers (respect Reset marks); fall back to raw.
        const tierBar = beat ? beat.ladderBarIndex ?? beat.barIndex : null;
        const sectionTier = tierBar !== null ? Math.floor((((tierBar % 16) + 16) % 16 === 0 ? tierBar : tierBar) / 16) : null;

        // ---- Beat-quantized shell rotation: on each new whole beat, advance
        // every shell one notch (alternating direction by shell parity).
        const beatCount = beat
          ? (tierBar ?? 0) * beat.beatsPerBar + beat.beatInBar
          : null;
        if (beatCount !== null && beatCount !== prevBeatCount) {
          for (let s = 0; s < SHELL_N; s++) {
            const dir = s % 2 === 0 ? 1 : -1;
            shellRot[s] += dir * (Math.PI / 8);
          }
          prevBeatCount = beatCount;
        } else if (beatCount === null) {
          // Gridless: creep the notch continuously so it never freezes.
          for (let s = 0; s < SHELL_N; s++) {
            shellRot[s] += (s % 2 === 0 ? 1 : -1) * dt * 0.25;
          }
        }

        // ---- Section topology change: shell count cycles on section lines.
        if (sectionTier !== null && sectionTier !== prevSectionTier) {
          if (prevSectionTier !== null) {
            shellIndex = (shellIndex + 1) % SHELL_CYCLE.length;
          }
          prevSectionTier = sectionTier;
        }
        const targetShells = SHELL_CYCLE[shellIndex];
        shellCount += (targetShells - shellCount) * (1 - Math.exp(-dt / 0.8));

        // ---- Drop genome: on a fresh drop, ALIGN the plates into one plane
        // for ~0.5 s, then EXPLODE into tumble (explode decays over ~1.5 s).
        if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastDropAt > 6) {
          lastDropAt = frame.time;
          alignTarget = 1;
          alignPhaseUntil = frame.time + 0.5;
        }
        prevDrop = smoothDrop;
        if (frame.time > alignPhaseUntil && alignTarget > 0.5) {
          // End of the align hold: release into explosion.
          alignTarget = 0;
          explode = 1;
        }
        // Ease align in fast (snap flat), out into the explosion.
        align += (alignTarget - align) * (1 - Math.exp(-dt / 0.12));
        explode = Math.max(0, explode - dt / 1.5);
        // The tumble body always rides max(drop, energy) so the plateau
        // keeps moving even after excitement fades.
        explode = Math.max(explode, 0.4 * lift);

        // ---- Kick ripple: retrigger on strong kicks (gated by impulse.low
        // so it's a SOLID bass response, not broadband powder).
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // ---- Snare crack: a mid transient cracks one plate at a new angle.
        crackAge += dt;
        if (frame.impulse.mid > 0.3 && crackAge > 0.2) {
          crackAge = 0;
          crackAng = Math.random() * Math.PI * 2 - Math.PI;
        }

        // LOWS drive plate size: heavy bass -> coarse cells (big slabs);
        // bass kill -> fine cells (small chips). cellScale small = big.
        const cellScale = (1.1 - 0.55 * Math.min(1, frame.bands.low * 1.3)) / plateSize;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: sustained,
          u_centroid: frame.centroid,
          u_decay: Math.min(0.9, (0.72 + 0.12 * persistence) - 0.05 * energy),
          u_seed: Math.floor(frame.time * 20),
          u_cellScale: cellScale,
          u_edge: Math.min(2, (0.3 + 1.2 * frame.bands.high) * glint),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_align: align,
          u_explode: explode,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_shellCount: shellCount,
          u_crackAng: crackAng,
          u_crackAge: crackAge,
          u_duoA: [duoA[0], duoA[1], duoA[2]],
          u_duoB: [duoB[0], duoB[1], duoB[2]],
          u_shellRot: shellRot,
        };
      },
    });
  },
};

export default g08VoyagePlatesPreset;
