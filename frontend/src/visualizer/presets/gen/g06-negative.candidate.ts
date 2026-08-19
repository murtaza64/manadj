/**
 * g06-negative — "Cathedral of Negative Space" (gen-6 NOVEL; sol concept).
 *
 * Concept lineage: the monolith / cathedral fossils. g02-monolith was "needs
 * work but interesting"; g03-monolith-lux died on "the smoke is really bad";
 * g03-analyzer-cathedral is dead. The falsifiable question (brief): does
 * building architecture from DARKNESS — cutting the structure OUT of a
 * saturated volumetric color field, so the structure is the ABSENCE of light —
 * fix the legibility / smoke failures that killed the bright-column attempts?
 *
 * What the fossils did wrong and what this DISCARDS:
 *   - g03-monolith-lux lit bright columns and used volumetric fog + fbm
 *     "snare powder in the fog" → the human's "smoke is really bad". Here
 *     there is NO participating-media march, NO powder, NO dust, NO fog term
 *     that accumulates like smoke. The volume is a CLEAN emission field the
 *     architecture OCCLUDES; density never smears.
 *   - The dead cathedral used bright columns. Here the columns/piers are
 *     DARK — they are literally where light is absent. Bright is the volume
 *     BEHIND/BETWEEN the stone, never the stone itself.
 *   - No tunnel feedback warp (anti-resemblance).
 *
 * The scene: a one-point-perspective nave whose vanishing point is OFF-CENTRE
 * (asymmetric nave — the layout invariant). We march a saturated FBM emission
 * VOLUME (iq-style layered value noise, colored by an iq cosine palette) and
 * SUBTRACT the architecture: massive bays (lows), arches (mids), and fine
 * window tracery (highs) are carved as OCCLUDERS that block the volume's
 * emission. Where the stone is, the frame goes dark; where the windows and
 * the nave void are, the saturated volume blazes through. Strict contrast
 * hierarchy: dark structure, luminous volume.
 *
 * Signals → architecture (assigned tech, 24-band spectrum PRIMARY):
 *   - The 24-band spectrum is folded JS-side into a low/mid/high profile and
 *     a coarse tracery detail measure; the shader reads u_bandLow/Mid/High
 *     plus a per-bay spectral silhouette so the plan literally answers the
 *     spectrum. Lows → bay mass & spacing; mids → arch spring height; highs →
 *     window tracery fineness.
 *   - bpm + beat phase → the nave advances (perspective creeps forward) at a
 *     BOUNDED rate; the camera velocity is CAPPED (the lattice/monolith
 *     nausea note). No roll, no fast dolly — a slow, steady processional.
 *   - phrase/section via `beat.ladderBarIndex ?? beat.barIndex`: the phrase
 *     advance keys on the ladder bar; a section boundary changes the PLAN
 *     TOPOLOGY (basilica → radial vault → bridge → impossible stair) via a
 *     SLOW OCCLUSION cross-fade, never a flash.
 *   - trend → a bass-weighted smoothed drop (derived JS-side; the frame has
 *     no `drop` field). Buildup raises colored light behind the windows and
 *     closes the nave toward the vanishing point; the drop opens the roof and
 *     expands into a persistent wide hall on max(drop, energy).
 *
 * Kick = a SOLID foundation compression: floor and vault flex TOGETHER (the
 * nave briefly compresses vertically) — no smoke, no kick particles. Snare
 * catches brief GLINTS only in localized window light (a bounded specular
 * twinkle on the tracery, not a field flash).
 *
 * Safety: photosensitivity floor — there is no full-field flash envelope at
 * all; every transition is a SLOW occlusion (topology morph, roof open,
 * buildup close), smoothed JS-side over ~0.5–1.5 s. Kick compression is a
 * bounded geometric flex; window glints are spatially localized. Camera
 * velocity is hard-capped so the processional never induces nausea.
 *
 * Raymarch budget: fixed 48-step sphere trace of an SDF (nave void minus
 * stone occluders), a cheap 4-octave value-noise emission integrated in a
 * SHORT fixed segment behind the first hit (no long participating march → no
 * smoke). GLSL ES 1.0, no backticks, constant loops.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type {
  PresetParam,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const BAND_GROUPS = 8; // u_bands array length (folded from the 24-band spectrum)

// --- GLSL ---------------------------------------------------------------
// GLSL ES 1.0, no backticks. u_bands is declared EXACTLY [8] to match the JS
// array length (glPreset warns on size mismatch).
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_bands[8];    // folded 24-band spectrum, 8 groups, 0..1
uniform float u_bandLow;
uniform float u_bandMid;
uniform float u_bandHigh;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;        // impulse.low: foundation compression
uniform float u_glint;       // impulse.high: window glints
uniform float u_drop;        // bass-weighted smoothed drop
uniform float u_buildup;     // smoothed excitement WITHOUT bass
uniform float u_drama;       // max(drop, energy) smoothed
uniform float u_centroid;
uniform float u_flatness;
uniform float u_advance;     // bpm-locked processional distance (BOUNDED)
uniform float u_beatPhase;   // 0..1 beat phase (breathing)
uniform float u_topoA;       // current plan topology 0..3
uniform float u_topoB;       // incoming plan topology 0..3
uniform float u_topoMix;     // 0..1 slow cross-fade between plans
uniform float u_roof;        // 0..1 roof open (drop)
uniform float u_close;       // 0..1 nave closing toward vanishing point (buildup)
uniform float u_vpx;         // vanishing point x offset (OFF-CENTRE)
uniform float u_vpy;         // vanishing point y offset
uniform float u_palette;     // volume palette family 0..3
uniform float u_hue;         // slow hue travel
uniform float u_compress;    // kick vertical compression 0..1

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash31(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.02 + vec3(11.3, 7.1, 5.7);
    a *= 0.5;
  }
  return v;
}

// bright, saturated volume palettes (repo dislikes pastels). These color the
// EMISSION volume; the architecture is the dark absence of it.
vec3 pal0(float t) { return vec3(0.5, 0.15, 0.45) + vec3(0.5, 0.4, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 1.0) * t + vec3(0.0, 0.15, 0.4))); }
vec3 pal1(float t) { return vec3(0.1, 0.4, 0.5) + vec3(0.4, 0.5, 0.5) * cos(6.28318 * (vec3(0.9, 1.0, 0.9) * t + vec3(0.1, 0.35, 0.55))); }
vec3 pal2(float t) { return vec3(0.55, 0.35, 0.1) + vec3(0.5, 0.45, 0.35) * cos(6.28318 * (vec3(1.0, 0.9, 0.55) * t + vec3(0.0, 0.12, 0.25))); }
vec3 pal3(float t) { return vec3(0.2, 0.5, 0.25) + vec3(0.45, 0.5, 0.45) * cos(6.28318 * (vec3(0.85, 1.0, 0.8) * t + vec3(0.3, 0.1, 0.5))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  c += vec3(0.12, 0.02, -0.07) * (u_centroid - 0.5) * 1.3;
  return c;
}

// sample the folded spectrum for a bay index (which band owns this bay).
float bandFor(float idx) {
  float fi = clamp(idx, 0.0, 7.0);
  // nearest-ish read; arrays must be indexed with constants in ES 1.0, so we
  // select via a small unrolled chain.
  float v = u_bands[0];
  v = (fi >= 0.5) ? u_bands[1] : v;
  v = (fi >= 1.5) ? u_bands[2] : v;
  v = (fi >= 2.5) ? u_bands[3] : v;
  v = (fi >= 3.5) ? u_bands[4] : v;
  v = (fi >= 4.5) ? u_bands[5] : v;
  v = (fi >= 5.5) ? u_bands[6] : v;
  v = (fi >= 6.5) ? u_bands[7] : v;
  return v;
}

float sdBox(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// The nave void as a signed distance. POSITIVE inside stone, NEGATIVE inside
// the open void — we build the CAVITY and treat the surrounding block as the
// dark structure. p is in nave space: z runs down the nave toward the
// vanishing point, x is lateral, y is height.
//
// topology parameter picks the plan; we morph between two plans (topoMix).
float navePlan(vec3 p, float topo) {
  // asymmetric nave: the central void is offset toward the vanishing point.
  float halfW = 1.15 - 0.4 * u_close;   // buildup closes the nave inward
  float floorY = -0.9 + 0.5 * u_compress; // kick lifts the floor (flex up)
  float roofY = 1.0 + 0.6 * u_roof - 0.25 * u_compress; // drop opens the roof, kick drops the vault

  // base void = a tall rectangular hall carved out (interior negative).
  vec3 q = p;
  // per-bay carving along z: repeat bays; each bay's height/width answers a
  // spectrum band so the plan reflects the sound.
  float bayPitch = 0.9 + 0.5 * u_bandLow;
  float bz = floor((p.z + 100.0) / bayPitch);
  float bandV = bandFor(mod(bz, 8.0));
  float bayLift = 0.15 * bandV * (0.5 + u_bandMid);

  // basilica (topo 0): straight side aisles, high clerestory windows.
  // radial vault (topo 1): the side walls fan outward with height.
  // bridge (topo 2): the floor becomes a spanning deck with open sides.
  // impossible stair (topo 3): the floor steps along z.
  float wallFlare = mix(0.0, 0.35, clamp(topo - 0.5, 0.0, 1.0) * (1.0 - clamp(topo - 1.5, 0.0, 1.0)));
  float bridgeCut = clamp(topo - 1.5, 0.0, 1.0) * (1.0 - clamp(topo - 2.5, 0.0, 1.0));
  float stair = clamp(topo - 2.5, 0.0, 1.0);

  float w = halfW + wallFlare * (p.y - floorY);
  float fy = floorY + stair * (0.18 * floor(mod(p.z, 6.0)));

  // interior box (negative = inside the hall): distance to the hall cavity.
  float insideX = w - abs(q.x - u_vpx * 0.2);
  float insideY = min(p.y - fy, roofY + bayLift - p.y);
  float cavity = min(insideX, insideY);

  // bridge topology: open the lower side walls (light floods from the sides).
  if (bridgeCut > 0.5) {
    float sideOpen = max(0.0, (p.y - fy) - 0.5);
    cavity = max(cavity, -(abs(q.x) - (w - 0.2)) - sideOpen * 2.0);
  }

  // PIERS: dark massive bays — vertical stone occluders between the void and
  // the outside volume. They are the ABSENCE of light. Placed at bay pitch.
  vec3 pq = p;
  float pierZ = mod(p.z + bayPitch * 0.5, bayPitch) - bayPitch * 0.5;
  float pierW = 0.12 + 0.16 * bandV; // lows → thicker piers
  float pierMass = w + 0.02;
  // a pier is a thin box just outside the hall wall on each side.
  float pierL = sdBox(vec3(abs(pq.x) - pierMass, p.y - (floorY + 0.6), pierZ),
                      vec3(pierW, 1.4, pierW * 0.7));
  // ARCHES (mids): carve arched openings through the piers at spring height.
  float springY = floorY + 0.7 + 0.5 * u_bandMid;
  float archR = 0.32 + 0.2 * u_bandMid;
  vec2 ap = vec2(pierZ, p.y - springY);
  float arch = length(ap * vec2(1.0, 1.1)) - archR;
  pierL = max(pierL, -arch); // subtract the arch void from the pier

  // final scene distance: we want a surface where stone meets void. The
  // renderable "stone" is min(pier, outer shell). The cavity is the hall.
  float shell = -cavity; // positive outside the hall, negative inside
  // outer bound so rays terminate: a big enclosing box behind the piers.
  float outer = sdBox(p - vec3(0.0, 0.0, 0.0), vec3(w + 0.9, 2.6, 60.0));
  float stone = max(shell, -outer); // stone shell within the outer bound
  stone = min(stone, pierL);
  return stone;
}

float mapScene(vec3 p) {
  float a = navePlan(p, u_topoA);
  float b = navePlan(p, u_topoB);
  return mix(a, b, u_topoMix);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0025, 0.0);
  return normalize(vec3(
    mapScene(p + e.xyy) - mapScene(p - e.xyy),
    mapScene(p + e.yxy) - mapScene(p - e.yxy),
    mapScene(p + e.yyx) - mapScene(p - e.yyx)
  ));
}

// Window tracery mask on a stone face: fine cut pattern (highs). Where the
// tracery is "open", light leaks through the stone (a window). Fixed to the
// face (stable), gated on the high band so tracery fineness answers highs.
float traceryOpen(vec3 p, vec3 n) {
  // face-local coordinates: use the two axes least aligned with the normal.
  vec2 fc = abs(n.x) > 0.5 ? p.zy : p.xy;
  float fineness = 8.0 + 26.0 * u_bandHigh; // highs → finer tracery
  vec2 cell = fc * fineness;
  vec2 g = abs(fract(cell) - 0.5);
  // a lattice of pointed-arch style openings.
  float lat = smoothstep(0.28, 0.42, min(g.x, g.y));
  // only on the upper part of the wall (clerestory windows), and sparse.
  float band = smoothstep(0.2, 0.8, p.y);
  float sparse = step(0.35, hash11(floor(fc.x * fineness) + floor(fc.y * fineness) * 3.1));
  return lat * band * sparse;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 sc = (uv - 0.5) * vec2(aspect, 1.0);

  // ---- Camera: slow BOUNDED processional down the nave. OFF-CENTRE
  // vanishing point via the view target offset. No roll, capped velocity.
  vec3 ro = vec3(u_vpx * 0.15, 0.05 + 0.05 * u_beatPhase, -3.2 + u_advance);
  vec3 ta = vec3(u_vpx, u_vpy, ro.z + 6.0); // look down the nave, VP off-centre
  vec3 fwd = normalize(ta - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  float fov = 1.35 - 0.15 * u_close + 0.1 * u_roof;
  vec3 rd = normalize(fwd * fov + right * sc.x + up * sc.y);

  // ---- March the SDF: find the first stone surface (or the open far void).
  float tcur = 0.02;
  float hit = 0.0;
  vec3 hitP = ro;
  for (int i = 0; i < 48; i++) {
    vec3 p = ro + rd * tcur;
    float d = mapScene(p);
    if (d < 0.002 * tcur + 0.0015) {
      hit = 1.0;
      hitP = p;
      break;
    }
    tcur += max(0.01, d * 0.9);
    if (tcur > 55.0) break;
  }

  // ---- The EMISSION VOLUME behind/through the architecture. This is the
  // saturated light the structure occludes. It is sampled as a CLEAN field
  // (a short fixed integration, NOT a long participating march) so it never
  // reads as smoke. The volume brightens toward the vanishing point (the
  // altar light) and blooms on the drop.
  vec3 volCol = vec3(0.0);
  {
    // integrate a few taps along the ray in the void toward the VP; each tap
    // is a colored emission sample, weighted toward the far distance.
    float tv = hit > 0.5 ? tcur : 6.0; // if stone hit, the volume sits behind
    for (int j = 0; j < 5; j++) {
      float tt = tv + float(j) * 1.4;
      vec3 sp = ro + rd * tt;
      float dens = fbm3(sp * 0.6 + vec3(0.0, 0.0, u_advance * 0.2) + u_hue * 2.0);
      // altar glow: brighter deep down the nave, toward the VP.
      float depthGlow = smoothstep(2.0, 14.0, tt);
      float t = u_hue + dens * 0.6 + depthGlow * 0.3 + u_buildup * 0.4;
      vec3 c = palette(t);
      float w = (0.4 + 0.6 * dens) * (0.3 + 0.9 * depthGlow);
      volCol += c * w;
    }
    volCol *= (0.18 + 0.5 * u_drama + 0.5 * u_buildup + 0.6 * u_roof);
    // buildup raises colored light behind the windows specifically.
    volCol *= 0.7 + 0.6 * u_buildup;
  }

  vec3 col;
  if (hit > 0.5) {
    vec3 n = calcNormal(hitP);
    // ---- The stone is DARK: it is the ABSENCE of light. Near-black, faintly
    // shaded so massing reads (steeper key = legibility, no ambient mush).
    float depthFade = exp(-tcur * 0.06);
    vec3 lightDir = normalize(vec3(0.3, 0.8, 0.2));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    // very low key: stone tops out dark; a subtle cool ambient so silhouettes
    // separate from the luminous volume by CONTRAST, not by being bright.
    vec3 stone = vec3(0.02, 0.02, 0.03) + vec3(0.03, 0.03, 0.04) * diff;
    stone *= 0.4 + 0.6 * depthFade;

    // ---- WINDOW TRACERY: highs cut openings; the volume light leaks through.
    float win = traceryOpen(hitP, n);
    vec3 winLight = palette(u_hue + 0.35 + hitP.y * 0.1) * (0.6 + 1.4 * u_bandHigh);
    winLight *= (0.4 + 1.0 * u_drama + 0.8 * u_buildup);
    // snare GLINT: localized specular twinkle on the tracery only.
    vec3 halfv = normalize(lightDir - rd);
    float spec = pow(clamp(dot(n, halfv), 0.0, 1.0), 40.0);
    float glintCell = step(0.7, hash11(floor(hitP.x * 20.0) + floor(hitP.y * 20.0) * 2.3));
    winLight += vec3(1.0) * spec * glintCell * win * u_glint * 2.0;

    col = mix(stone, winLight, win);
    // a thin rim where stone edges catch the volume (reinforces legibility).
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
    col += palette(u_hue + 0.2) * rim * (0.15 + 0.4 * u_drama) * (0.5 + 0.5 * depthFade);

    // the far end of the nave (the altar void) glows through even on hits
    // that are thin: add a fraction of the volume, occluded by the stone.
    col += volCol * (0.06 + 0.1 * win);
  } else {
    // open void: the saturated emission volume fills the aperture (the nave
    // opening onto the altar light / the opened roof).
    col = volCol;
  }

  // ---- flatness → material: a noisy sound roughens the stone slightly (a
  // faint value-noise texture on the near stone). Bounded; not particles.
  if (hit > 0.5) {
    float rough = (fbm3(hitP * (6.0 + 20.0 * u_flatness)) - 0.5) * u_flatness;
    col += col * rough * 0.3;
  }

  // subtle static vignette toward the frame edges (keeps focus on the nave).
  float vig = smoothstep(1.3, 0.3, length(sc));
  col *= 0.6 + 0.4 * vig;

  // ---- Chroma-preserving soft knee (never per-channel clamp) ----------
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.9) {
    col *= (0.9 + 0.1 * (1.0 - exp(-(m - 0.9) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

// --- Song genome / spectrum folding (JS-side) --------------------------

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
  palette: number; // 0..3 volume palette
  vpx: number; // OFF-CENTRE vanishing point x (never 0)
  vpy: number; // vanishing point y
  drift: number; // hue drift start
}

function hashGenome(key: number): Genome {
  const next = splitmix(Math.round(key));
  const side = next() > 0.5 ? 1 : -1;
  return {
    palette: next() * 3,
    // asymmetric nave: force the VP off-centre by at least 0.25.
    vpx: side * (0.25 + 0.45 * next()),
    vpy: -0.1 + 0.35 * next(),
    drift: next(),
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

/** Fold the 24-band spectrum into BAND_GROUPS averaged groups (0..1). */
function foldSpectrum(spectrum: number[], out: Float32Array): void {
  const n = spectrum.length;
  if (n === 0) {
    out.fill(0);
    return;
  }
  for (let g = 0; g < BAND_GROUPS; g++) {
    const lo = Math.floor((g * n) / BAND_GROUPS);
    const hi = Math.max(lo + 1, Math.floor(((g + 1) * n) / BAND_GROUPS));
    let sum = 0;
    let cnt = 0;
    for (let i = lo; i < hi && i < n; i++) {
      sum += spectrum[i];
      cnt++;
    }
    out[g] = cnt > 0 ? sum / cnt : 0;
  }
}

const params: PresetParam[] = [
  { id: 'depth', label: 'nave depth (advance rate)', min: 0.2, max: 2, step: 0.05, default: 1 },
  { id: 'volume', label: 'volume light intensity', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'tracery', label: 'window tracery detail', min: 0.2, max: 2, step: 0.05, default: 1 },
  { id: 'palette', label: 'volume palette (magenta→cyan→amber→emerald)', min: -1, max: 3, step: 0.05, default: -1 },
];

const g06NegativePreset: VisualizerPreset = {
  id: 'g06-negative',
  name: 'g06 negative',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    const bandsBuf = new Float32Array(BAND_GROUPS);
    // slow band profile (24-band → low/mid/high) EMAs.
    let bandLow = 0;
    let bandMid = 0;
    let bandHigh = 0;
    // identity / genome + topology cross-fade.
    let seededKey: number | null = null;
    let genome: Genome = hashGenome(1);
    let lastTrackId: number | null = null;
    let topoA = 0;
    let topoB = 0;
    let topoMix = 1; // 1 = settled on topoA-as-B; morph runs 0→1
    let lastSection = -1;
    // dynamics.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let drama = 0;
    let sCentroid = 0.5;
    let sFlatness = 0.5;
    // bounded processional + envelopes.
    let advance = 0; // capped-velocity forward creep
    let roof = 0;
    let closeVal = 0;
    let hueTravel = 0;
    let compress = 0; // kick vertical flex

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: false,
      uniforms: (frame) => {
        const dt =
          lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);

        // --- 24-band spectrum → folded groups + low/mid/high profile -------
        foldSpectrum(frame.spectrum, bandsBuf);
        const spec = frame.spectrum;
        let lo = 0;
        let mi = 0;
        let hi = 0;
        if (spec.length > 0) {
          const n = spec.length;
          for (let i = 0; i < n; i++) {
            const f = i / n;
            if (f < 0.25) lo += spec[i];
            else if (f < 0.6) mi += spec[i];
            else hi += spec[i];
          }
          const loN = Math.max(1, Math.floor(n * 0.25));
          const miN = Math.max(1, Math.floor(n * 0.35));
          const hiN = Math.max(1, n - loN - miN);
          lo /= loN;
          mi /= miN;
          hi /= hiN;
        }
        const bA = 1 - Math.exp(-dt / 0.15);
        bandLow += (lo - bandLow) * bA;
        bandMid += (mi - bandMid) * bA;
        bandHigh += (hi - bandHigh) * bA;

        // slow spectral stats.
        const slowA = 1 - Math.exp(-dt / 8);
        sCentroid += (frame.centroid - sCentroid) * slowA;
        sFlatness += (frame.flatness - sFlatness) * slowA;

        // --- Identity: dominant trackId → genome (g02 pattern) -------------
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round(sCentroid * 733 + bandLow * 971 + sFlatness * 613 + 1);
        if (seededKey == null) {
          seededKey = key;
          genome = hashGenome(key);
          lastTrackId = trackId;
        } else if (trackId != null && trackId !== lastTrackId) {
          // a new track re-rolls the genome AND starts a topology morph.
          genome = hashGenome(key);
          lastTrackId = trackId;
          seededKey = key;
          topoA = topoB;
          topoB = Math.floor(splitmix(key)() * 3.999);
          topoMix = 0;
        }

        // --- Regime split: bass-weighted smoothed drop (no `drop` field) ---
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rA = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rA;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rA;
        const demand = Math.max(energy, smoothDrop * 0.9 + energy * 0.4);
        drama += (Math.min(1, demand) - drama) * Math.min(1, dt * 3.0);

        // --- Phrase / section via the ladder -------------------------------
        const beat = frame.beat;
        const ladderBar = beat ? beat.ladderBarIndex ?? beat.barIndex : null;
        const hasGrid = beat != null && ladderBar != null;
        const bpm = beat?.bpm ?? 120;
        const beatRate = bpm > 0 ? bpm / 60 : 2;

        // BOUNDED processional: advance forward at a CAPPED velocity that
        // rides bpm and drama but is hard-clamped (nausea note). Wrap so the
        // nave repeats without a jump (bay pitch ~1.4).
        const depthP = frame.params.depth ?? 1;
        const advVel = Math.min(0.55, (0.12 + 0.18 * drama) * beatRate * 0.25 * depthP);
        advance = (advance + dt * advVel) % 1.4;

        // section boundary → topology morph (SLOW occlusion, never a flash).
        if (hasGrid) {
          const section = Math.floor(ladderBar / 16);
          if (lastSection >= 0 && section !== lastSection) {
            topoA = topoB;
            topoB = Math.floor(
              splitmix((seededKey ?? 1) + section * 1013)() * 3.999
            );
            topoMix = 0;
          }
          lastSection = section;
        }
        if (topoMix < 1) topoMix = Math.min(1, topoMix + dt / 1.5);

        // buildup closes the nave toward the VP; drop opens the roof.
        closeVal += (smoothBuildup - closeVal) * (1 - Math.exp(-dt / 0.6));
        const roofTarget = Math.max(smoothDrop, energy) * smoothDrop; // gate on bass-weighted drop
        roof += (roofTarget - roof) * (1 - Math.exp(-dt / 0.5));

        // kick foundation compression: floor+vault flex together, bounded.
        const kickTarget = Math.min(1, frame.impulse.low * 1.2);
        // fast attack, slow release so it reads as a compression, not a strobe.
        const cA = kickTarget > compress ? (1 - Math.exp(-dt / 0.04)) : (1 - Math.exp(-dt / 0.22));
        compress += (kickTarget - compress) * cA;

        // slow hue travel; buildup accelerates it.
        hueTravel += dt * (0.02 + 0.02 * frame.bands.high) + dt * 0.3 * smoothBuildup;
        const hueOut = genome.drift + hueTravel + sCentroid * 0.2;

        // beat phase (breathing).
        const beatPhase = beat?.phase ?? 0;

        // --- params -------------------------------------------------------
        const volumeP = frame.params.volume ?? 1;
        const traceryP = frame.params.tracery ?? 1;
        const paletteP = frame.params.palette ?? -1;
        const paletteOut = paletteP >= 0 ? paletteP : genome.palette;

        return {
          u_time: frame.time,
          u_bands: bandsBuf,
          u_bandLow: bandLow,
          u_bandMid: bandMid,
          u_bandHigh: Math.min(1, bandHigh * traceryP),
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_glint: frame.impulse.high,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_drama: drama * volumeP,
          u_centroid: sCentroid,
          u_flatness: sFlatness,
          u_advance: advance,
          u_beatPhase: beatPhase,
          u_topoA: topoA,
          u_topoB: topoB,
          u_topoMix: topoMix,
          u_roof: roof,
          u_close: closeVal,
          u_vpx: genome.vpx,
          u_vpy: genome.vpy,
          u_palette: paletteOut,
          u_hue: hueOut,
          u_compress: compress,
        };
      },
    });
  },
};

export default g06NegativePreset;
