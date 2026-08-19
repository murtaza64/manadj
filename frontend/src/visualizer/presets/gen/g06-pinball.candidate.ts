/**
 * "g06 pinball" (genetic arena g06, novel — sol-review concept "Shadow
 * Pinball").
 *
 * An explicitly PLAYFUL causal machine rendered as neon SDF linework on a
 * tilted table: a heavy low-frequency ball, spectrum-shaped bumpers, gates,
 * flippers and rails. The falsifiable question the brief poses: does legible
 * causality itself earn approval where abstract fields plateau — i.e. can
 * you SEE the ball cause the bumper to respond?
 *
 * The board is a trackId GENOME (shared g0x-hash pattern): a splitmix
 * avalanche of the dominant audible deck's trackId lays out the bumpers
 * (positions seeded, radii shaped by the 24-band spectrum), the flipper
 * placement, the rail routes, the palette family and the tilt. Same song =>
 * same board, every play. No trackId => the slow spectral stats freeze into
 * a pseudo-seed. Section boundaries rebuild the board by physical FOLDING of
 * the playfield (a fold sweep across the table), not a cut.
 *
 * CAUSAL MECHANICS (the invariants):
 *  - BALL = the solid LOW-FREQUENCY actor. Its motion is BALLISTIC and beat-
 *    phase timed: launches are scheduled so the ball ARRIVES at a bumper ON
 *    the beat (the JS driver plans a parabolic hop between anchor points, its
 *    duration a whole number of beats). The ball is a bright solid disc; its
 *    only afterimage is a short local trail (afterimages local to balls).
 *  - KICK = LAUNCH / FLIPPER SLAM: impulse.low fires the next scheduled hop
 *    (or slams a flipper). A physical state advance, never a flash.
 *  - BALL VISIBLY CAUSES BUMPER RESPONSE: when the ball is near a bumper the
 *    bumper LIGHTS and recoils — causality you can read frame to frame.
 *  - MIDS STEER RAILS: the rail routes brighten and the active route bends
 *    with the mids (mids choose which lane the next hop takes).
 *  - HIGHS = SCORE LAMPS: impulse.high (gated up by mid) lights small
 *    peripheral score LAMPS at the board edges — brief localized lamp
 *    flashes, NOT sparks, NOT dust. Low impulse suppresses all high effects.
 *    Never full-field luminance (photosensitivity floor).
 *  - BAR / PHRASE TIERS unlock lanes and multiball: %4 bars open extra lanes,
 *    %16 sections unlock multiball choreography.
 *  - BUILDUP illuminates routes in vivid traveling colors and accelerates
 *    mechanisms WITHOUT launching early (tension held).
 *  - DROP opens the central gate into sustained MULTIBALL on max(drop,
 *    energy), so it survives the plateau.
 *
 * Layout: TILTED TABLE perspective, drain at the bottom — a vertical
 * asymmetric composition, nothing radial, no centered mandala.
 *
 * GLSL discipline: ES 1.0 only, no backticks; the ball/bumper/lamp loops are
 * CONSTANT loops masked by count uniforms; u_-array uniforms sized exactly as
 * declared and always fully populated JS-side.
 *
 * Assigned tech: beat phase (primary — ballistic timing), bar/phrase via
 * beat.ladderBarIndex ?? beat.barIndex, 24-band spectrum (bumper shaping),
 * impulses (launch, lamps), trackId genome.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

const MAX_BUMPERS = 8;
const MAX_BALLS = 4;
const MAX_LAMPS = 6;

// --- GLSL --------------------------------------------------------------
// No backticks inside this string. Loops are constant, masked by counts;
// arrays are sized exactly and fully populated JS-side.
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;         // impulse.low -> launch / flipper slam glow
uniform float u_snare;        // impulse.mid -> rail steer
uniform float u_hat;          // impulse.high (unused directly; kept for parity)
uniform float u_drop;         // smoothed excitement WITH bass -> multiball
uniform float u_buildup;      // smoothed excitement WITHOUT bass -> route glow
uniform float u_sustain;      // max(drop, energy) body
uniform float u_tilt;         // table tilt (perspective foreshorten strength)
uniform float u_fold;         // 0..1 section-boundary playfield FOLD sweep
uniform float u_lanes;        // 0..1 extra-lane unlock (phrase tier)
uniform float u_ballCount;    // active balls (multiball) masked in the loop
uniform float u_ball[8];      // ball positions (x,y pairs), table space
uniform float u_ballHot[4];   // per-ball brightness (recent bumper hit)
uniform float u_bumpCount;    // active bumpers
uniform float u_bump[16];     // bumper positions (x,y pairs), table space
uniform float u_bumpR[8];     // bumper radii (24-band shaped)
uniform float u_bumpHit[8];   // per-bumper recoil/glow (ball proximity)
uniform float u_lampCount;    // active score lamps
uniform float u_lamp[12];     // peripheral lamp positions (x,y pairs), edges
uniform float u_lampLit[6];   // per-lamp flash (highs, gated by low impulse)
uniform float u_railBend;     // mid-driven active rail bend
uniform float u_gate;         // central gate openness (drop opens)
uniform float u_palette;      // seed palette family 0..3
uniform float u_warm;         // avg centroid -> palette temperature
uniform float u_sat;          // saturation surge
uniform float u_edgeTravel;   // route color travel speed (buildup accel)
uniform float u_decay;        // feedback persistence
uniform float u_seed;         // scalar seed

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

float neon(float d, float w) {
  float core = exp(-d * d / (w * w));
  float halo = exp(-d * d / (w * w * 24.0)) * 0.32;
  return core + halo;
}

float ringSDF(vec2 p, float r0) {
  return abs(length(p) - r0);
}

// Line segment SDF (for rails / flippers).
float segSDF(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(1e-4, dot(ba, ba)), 0.0, 1.0);
  return length(pa - ba * h);
}

// Map a fragment (aspect-space, centred) to TABLE space with a tilted
// perspective: y runs 0 (top/far) .. 1 (bottom/near, the drain). Nearer rows
// spread wider (foreshorten). Returns table coords; sets valid<0 outside.
vec2 toTable(vec2 p, out float valid) {
  // p: aspect-space, roughly x in [-a/2, a/2], y in [-0.5, 0.5].
  float ty = clamp(0.5 - p.y, 0.0, 1.0);       // top -> 0, bottom -> 1
  float widen = mix(0.55, 1.0, mix(ty, ty * ty, u_tilt)); // near rows wider
  float tx = p.x / max(0.2, widen);
  valid = (abs(tx) < 1.05 && ty > -0.02 && ty < 1.02) ? 1.0 : -1.0;
  return vec2(tx, ty);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // ---- Feedback: a slight downward drift (toward the drain) gives balls a
  // short local trail and the table a sense of gravity; LOCAL to drawn
  // elements, not a full-field wash.
  vec2 pix = 1.0 / u_res;
  vec2 src = uv + vec2(0.0, -pix.y * (0.6 + 1.4 * u_sustain));
  vec3 fed = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(pix.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, pix.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, pix.y)).rgb) * 0.25;
  vec3 trail = max(vec3(0.0), fed * 1.24 - blur * 0.24) * u_decay;

  float valid;
  vec2 tp = toTable(p, valid);

  vec3 acc = vec3(0.0);

  if (valid > 0.0) {
    // ---- Playfield border (the table outline): a neon frame, drain gap at
    // the bottom. Vertical asymmetric composition.
    {
      float left = neon(abs(tp.x + 1.0), 0.01);
      float right = neon(abs(tp.x - 1.0), 0.01);
      float top = neon(abs(tp.y), 0.01);
      // drain gap: bottom edge only outside the central drain slot.
      float bottomEdge = neon(abs(tp.y - 1.0), 0.01) * step(0.28, abs(tp.x));
      vec3 frameCol = palette(0.08 + u_time * 0.01 * u_edgeTravel);
      acc += frameCol * (left + right + top + bottomEdge) * (0.35 + 0.5 * u_sustain);
    }

    // ---- Central gate: a horizontal bar mid-table that OPENS on the drop
    // (u_gate) to release multiball. Drawn as a segment that shortens as it
    // opens.
    {
      float half = 0.42 * (1.0 - u_gate);
      float dGate = segSDF(tp, vec2(-half, 0.5), vec2(half, 0.5));
      float gate = neon(dGate, 0.012) * (1.0 - 0.6 * u_gate);
      acc += palette(0.55 + u_time * 0.04) * gate * (0.4 + 0.8 * u_mid);
    }

    // ---- Rails: curved routes down the table, the active one bending with
    // the mids (u_railBend). Two side rails + a phrase-unlocked centre lane.
    {
      // left rail
      float bendL = u_railBend * 0.25;
      float railX = -0.7 + bendL * sin(tp.y * 3.14159);
      float dL = abs(tp.x - railX);
      // right rail
      float railXr = 0.7 - bendL * sin(tp.y * 3.14159);
      float dR = abs(tp.x - railXr);
      // centre lane, unlocked by the phrase tier (u_lanes)
      float dC = abs(tp.x) ;
      vec3 railCol = palette(0.3 + u_time * 0.03 * u_edgeTravel);
      float glow = neon(dL, 0.008) + neon(dR, 0.008);
      glow += neon(dC, 0.008) * u_lanes;
      // routes illuminate in traveling colors on buildups.
      acc += railCol * glow * (0.3 + 0.7 * u_mid + 0.9 * u_buildup);
    }

    // ---- Bumpers: spectrum-shaped discs. Ball proximity LIGHTS + recoils
    // them (u_bumpHit) — legible causality. Constant loop masked by count.
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float active = step(fi + 0.5, u_bumpCount);
      vec2 c = vec2(u_bump[i * 2], u_bump[i * 2 + 1]);
      float r = u_bumpR[i];
      float hit = u_bumpHit[i];
      vec2 q = tp - c;
      // recoil: the ring pushes outward briefly when struck.
      float rr = r * (1.0 + 0.25 * hit);
      float dRing = ringSDF(q, rr);
      float ring = neon(dRing, 0.006 + 0.004 * hit);
      // core fill lights up on a hit (localized, not full-field).
      float core = exp(-dot(q, q) / (rr * rr * 0.5)) * hit;
      vec3 bumpCol = palette(0.15 + 0.08 * fi + u_time * 0.02 * u_edgeTravel);
      acc += bumpCol * ring * active * (0.35 + 0.5 * u_mid + 1.3 * hit);
      acc += mix(bumpCol, vec3(1.0), 0.3) * core * active * 1.2;
    }

    // ---- Flippers: two segments near the drain, slammed on the kick.
    {
      float slam = u_kick;
      // left flipper pivots up on a slam
      vec2 la = vec2(-0.55, 0.92);
      vec2 lb = vec2(-0.15, 0.86 - 0.12 * slam);
      float dLf = segSDF(tp, la, lb);
      vec2 ra = vec2(0.55, 0.92);
      vec2 rb = vec2(0.15, 0.86 - 0.12 * slam);
      float dRf = segSDF(tp, ra, rb);
      vec3 flipCol = palette(0.62 + 0.1 * slam);
      acc += flipCol * (neon(dLf, 0.010) + neon(dRf, 0.010)) * (0.5 + 1.4 * slam + 0.4 * u_low);
    }

    // ---- Balls: solid LOW-frequency actors. Bright discs; per-ball hot from
    // a recent bumper hit. Constant loop masked by count (multiball).
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float active = step(fi + 0.5, u_ballCount);
      vec2 c = vec2(u_ball[i * 2], u_ball[i * 2 + 1]);
      float hot = u_ballHot[i];
      vec2 q = tp - c;
      float d = length(q);
      float bodyR = 0.035 + 0.02 * u_low;
      float body = exp(-d * d / (bodyR * bodyR));
      float halo = exp(-d * d / (bodyR * bodyR * 9.0)) * 0.5;
      vec3 ballCol = mix(vec3(1.0), palette(0.9 + 0.05 * fi), 0.35);
      acc += ballCol * (body * (0.9 + 0.6 * u_low) + halo) * active * (1.0 + 0.6 * hot);
    }

    // ---- Section FOLD sweep: on a section boundary the playfield folds — a
    // bright crease line sweeps down the table (u_fold 1->0 over the rebuild).
    {
      float y = 1.0 - u_fold; // crease sweeps top(0)->bottom(1) as fold 1->0
      float dCrease = abs(tp.y - y);
      float crease = neon(dCrease, 0.02) * step(0.001, u_fold);
      acc += palette(0.4 + u_time * 0.06) * crease * 1.6;
      // fold darkens the far side momentarily (physical fold, not a cut).
      acc *= 1.0 - 0.4 * u_fold * step(y, tp.y);
    }
  }

  // ---- Score lamps: peripheral, drawn in SCREEN space at the board edges so
  // they sit outside the tilted field. Small, localized flashes (highs, gated
  // by low impulse). NOT sparks/dust; never full-field. Constant loop masked.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float active = step(fi + 0.5, u_lampCount);
    vec2 c = vec2(u_lamp[i * 2], u_lamp[i * 2 + 1]); // screen aspect-space
    float lit = u_lampLit[i];
    float d = length(p - c);
    float lamp = exp(-d * d / 0.0006) * lit;   // tiny + localized
    vec3 lampCol = mix(vec3(1.0), palette(0.75 + 0.1 * fi), 0.4);
    acc += lampCol * lamp * active * 1.3;
  }

  // Live body rides max(drop, energy); buildups lift (never dimmed).
  acc *= 0.55 + 1.0 * u_sustain + 0.6 * u_drop + 0.25 * u_buildup;

  acc = saturate(acc, clamp(u_sat, 0.0, 2.0));

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
  { id: 'ballSpeed', label: 'ball hop cadence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'tilt', label: 'table tilt', min: 0, max: 1, step: 0.05, default: 0.6 },
  { id: 'persistence', label: 'feedback persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'multiball', label: 'drop multiball reach', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'saturation', label: 'color saturation', min: 0.5, max: 2, step: 0.05, default: 1 },
];

// --- Song genome (JS-side) --------------------------------------------

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

interface Board {
  bumpCount: number;
  bump: Float32Array; // xy pairs, MAX_BUMPERS*2, table space
  bumpBandBase: Int32Array; // which spectrum band shapes each bumper
  lampCount: number;
  lamp: Float32Array; // xy pairs, MAX_LAMPS*2, screen aspect-space edges
  palette: number;
  tilt: number;
  seed: number;
}

/** Build a board from a seed key. Bumpers scattered on the upper table (the
 * drain is at the bottom), lamps at the board edges. */
function buildBoard(key: number, tiltParam: number): Board {
  const next = splitmix(Math.round(key));
  const bumpCount = 5 + Math.floor(next() * (MAX_BUMPERS - 4)); // 5..MAX_BUMPERS
  const bump = new Float32Array(MAX_BUMPERS * 2);
  const bumpBandBase = new Int32Array(MAX_BUMPERS);
  for (let i = 0; i < MAX_BUMPERS; i++) {
    // Scatter across the upper 2/3 of the table (leave room near the drain).
    const x = (next() * 2 - 1) * 0.78;
    const y = 0.12 + next() * 0.55;
    bump[i * 2] = x;
    bump[i * 2 + 1] = y;
    bumpBandBase[i] = Math.floor(next() * 24);
  }
  const lampCount = 4 + Math.floor(next() * (MAX_LAMPS - 3)); // 4..MAX_LAMPS
  const lamp = new Float32Array(MAX_LAMPS * 2);
  for (let i = 0; i < MAX_LAMPS; i++) {
    // Peripheral: along the left/right screen edges, jittered vertically.
    const side = i % 2 === 0 ? -1 : 1;
    const ex = side * (0.62 + next() * 0.06);
    const ey = -0.42 + next() * 0.84;
    lamp[i * 2] = ex;
    lamp[i * 2 + 1] = ey;
  }
  const palette = next() * 3;
  const tilt = tiltParam; // driven by param; kept per-board for parity
  const seed = next();
  return { bumpCount, bump, bumpBandBase, lampCount, lamp, palette, tilt, seed };
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

/** A ball: hops between anchor points on beat-quantized parabolas. */
interface Ball {
  active: boolean;
  from: [number, number];
  to: [number, number];
  t0: number; // start time
  dur: number; // hop duration (whole beats)
  hot: number; // brightness after a bumper hit
  targetBump: number; // which bumper this hop lands on
}

const g06PinballPreset: VisualizerPreset = {
  id: 'g06-pinball',
  name: 'g06 pinball',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    let emaCentroid = 0.5;
    let emaBpm = 0;

    let seededKey: number | null = null;
    let board: Board = buildBoard(1, 0.6);
    let lastTrackId: number | null = null;
    let lastSection = -1;
    let lastBarForLaunch = -999;

    let smoothDrop = 0;
    let smoothBuildup = 0;

    // Balls (multiball). Ball 0 always active.
    const balls: Ball[] = [];
    for (let i = 0; i < MAX_BALLS; i++) {
      balls.push({
        active: i === 0,
        from: [0, 0.9],
        to: [0, 0.4],
        t0: 0,
        dur: 1,
        hot: 0,
        targetBump: 0,
      });
    }

    // Per-bumper recoil/glow decays.
    const bumpHit = new Float32Array(MAX_BUMPERS);
    // Per-lamp lit decays.
    const lampLit = new Float32Array(MAX_LAMPS);
    // Per-bumper radius (24-band shaped), fed to shader.
    const bumpR = new Float32Array(MAX_BUMPERS);
    // Ball position + hot arrays for the shader.
    const ballPos = new Float32Array(MAX_BALLS * 2);
    const ballHot = new Float32Array(MAX_BALLS);

    // Section fold sweep envelope.
    let fold = 0;
    // Central gate openness.
    let gate = 0;
    // Rail bend (mid-driven, smoothed).
    let railBend = 0;

    /** Pick a new hop for a ball toward a seeded bumper, duration a whole
     * number of beats so it lands ON a beat. */
    function scheduleHop(ball: Ball, time: number, beatSec: number, rng: () => number): void {
      const bIdx = Math.floor(rng() * board.bumpCount);
      ball.from = [ball.to[0], ball.to[1]];
      ball.to = [board.bump[bIdx * 2], board.bump[bIdx * 2 + 1]];
      ball.targetBump = bIdx;
      // 1 or 2 beats per hop (whole beats -> lands on the beat).
      const beats = rng() < 0.6 ? 1 : 2;
      ball.dur = Math.max(0.15, beats * beatSec);
      ball.t0 = time;
    }

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const time = frame.time;

        const energy = energyOf(frame.bands);
        const bpm = frame.beat?.bpm ?? 0;
        const slowAlpha = 1 - Math.exp(-dt / 15);
        emaCentroid += (frame.centroid - emaCentroid) * slowAlpha;
        if (bpm && bpm > 0) emaBpm += (bpm - emaBpm) * slowAlpha;
        const beatSec = emaBpm > 0 ? 60 / emaBpm : 0.5;

        const tiltParam = frame.params.tilt ?? 0.6;

        // --- Identity: trackId seeds the board; a change rebuilds it.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((emaCentroid * 4096 + emaBpm * 7 + energy * 97) * 131) || 1;
        if (seededKey == null) {
          seededKey = key;
          board = buildBoard(key, tiltParam);
          lastTrackId = trackId;
        } else if (trackId != null && trackId !== lastTrackId) {
          seededKey = key;
          board = buildBoard(key, tiltParam);
          lastTrackId = trackId;
          fold = 1; // rebuild via fold sweep
        }

        // --- Regime split (smoothed ~0.35 s). No trend.drop field: derive a
        // bass-weighted drop from excitement × low presence.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, Math.max(smoothDrop, energy) * 1.35);

        // --- Bar/phrase/section tiers (ladder-correct).
        const beat = frame.beat;
        const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        const phraseBars = tierBar !== null ? (((tierBar % 4) + 4) % 4) : 0;
        // %4 bars open extra lanes.
        const lanes = Math.min(1, phraseBars / 3);
        const section = tierBar !== null ? Math.floor(tierBar / 16) : -1;
        if (section !== lastSection && lastSection !== -1) {
          fold = 1; // section boundary: physical fold rebuild
          board = buildBoard(seededKey! + section * 1013, tiltParam);
        }
        lastSection = section;
        fold = Math.max(0, fold - dt / 0.8);

        // --- Multiball: %16 section + drop opens the central gate; number of
        // active balls rides max(drop, energy) and the multiball param.
        const multiParam = frame.params.multiball ?? 1;
        const wantGate = smoothDrop;
        gate += (wantGate - gate) * (1 - Math.exp(-dt / 0.4));
        const multiReach = Math.max(smoothDrop, energy) * multiParam;
        const wantBalls = 1 + Math.floor(multiReach * (MAX_BALLS - 1) + 0.001);
        for (let i = 0; i < MAX_BALLS; i++) {
          if (i < wantBalls && !balls[i].active) {
            balls[i].active = true;
            balls[i].to = [0, 0.5];
            balls[i].from = [0, 0.9];
            balls[i].t0 = time;
            balls[i].dur = beatSec;
          } else if (i >= wantBalls && i > 0) {
            balls[i].active = false;
          }
        }

        // --- KICK = LAUNCH / FLIPPER SLAM: on a kick, advance each active
        // ball's hop. Ballistic + beat-phase timed: schedule new hops when the
        // current one completes OR when a kick fires (physical state advance).
        const ballSpeed = frame.params.ballSpeed ?? 1;
        const kick = frame.impulse.low;
        // Fire launches on a downbeat-ish kick, but never "early" during a
        // held buildup: gate scheduling by real low impulse.
        const barIndexNow = tierBar ?? -1;
        const kickLaunch = kick > 0.12 && barIndexNow !== lastBarForLaunch;
        for (let i = 0; i < MAX_BALLS; i++) {
          const ball = balls[i];
          if (!ball.active) {
            ballPos[i * 2] = 0;
            ballPos[i * 2 + 1] = 1.2; // parked below the drain (off-field)
            ballHot[i] = 0;
            continue;
          }
          const localRng = splitmix(seededKey! + i * 131 + Math.floor(time * 2.0));
          const prog = ball.dur > 0 ? (time - ball.t0) / ball.dur : 1;
          if (prog >= 1 || (kickLaunch && prog > 0.4)) {
            // Landed (or slammed): register a bumper hit, then schedule next.
            const hitB = ball.targetBump;
            if (hitB >= 0 && hitB < board.bumpCount) bumpHit[hitB] = 1;
            ball.hot = 1;
            scheduleHop(ball, time, beatSec / ballSpeed, localRng);
          }
          // Parabolic hop (arc): interpolate from->to, add a vertical arc.
          const t = Math.min(1, Math.max(0, ball.dur > 0 ? (time - ball.t0) / ball.dur : 1));
          const ease = t;
          const x = ball.from[0] + (ball.to[0] - ball.from[0]) * ease;
          const yLin = ball.from[1] + (ball.to[1] - ball.from[1]) * ease;
          const arc = -Math.sin(t * Math.PI) * 0.12; // hop upward (toward top)
          const y = yLin + arc;
          ballPos[i * 2] = x;
          ballPos[i * 2 + 1] = y;
          ball.hot = Math.max(0, ball.hot - dt / 0.25);
          ballHot[i] = ball.hot;
        }
        if (kickLaunch) lastBarForLaunch = barIndexNow;

        // --- Bumper recoil decays; radius shaped by the 24-band spectrum.
        for (let i = 0; i < MAX_BUMPERS; i++) {
          bumpHit[i] = Math.max(0, bumpHit[i] - dt / 0.3);
          if (i < board.bumpCount) {
            const band = board.bumpBandBase[i] % (frame.spectrum.length || 1);
            const bandLvl = frame.spectrum[band] ?? 0;
            bumpR[i] = 0.05 + 0.08 * bandLvl;
          } else {
            bumpR[i] = 0;
          }
        }

        // --- Score lamps: HIGHS light them, gated up by mid and suppressed by
        // LOW impulse absence (low impulse suppresses high-frequency effects).
        const highFire = frame.impulse.high * (0.4 + 0.8 * frame.impulse.mid);
        const lowGate = Math.min(1, frame.bands.low * 2.0 + frame.impulse.low);
        for (let i = 0; i < MAX_LAMPS; i++) {
          lampLit[i] = Math.max(0, lampLit[i] - dt / 0.2);
          if (i < board.lampCount && highFire > 0.1 && Math.random() < highFire * lowGate * 0.6) {
            lampLit[i] = Math.min(1, highFire * lowGate);
          }
        }

        // --- MIDS STEER RAILS.
        railBend += (frame.bands.mid + frame.impulse.mid - railBend) * (1 - Math.exp(-dt / 0.25));

        // --- Edge-color travel accelerates on buildups.
        const edgeTravel = 1 + 2.2 * smoothBuildup + 0.8 * smoothDrop;

        const persistence = frame.params.persistence ?? 1;
        const baseDecay = 0.982 - 0.01 * smoothBuildup;
        const decay = Math.min(0.994, 1 - (1 - baseDecay) / persistence);

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
          u_tilt: tiltParam,
          u_fold: fold,
          u_lanes: lanes,
          u_ballCount: Math.max(1, wantBalls),
          u_ball: ballPos,
          u_ballHot: ballHot,
          u_bumpCount: board.bumpCount,
          u_bump: board.bump,
          u_bumpR: bumpR,
          u_bumpHit: bumpHit,
          u_lampCount: board.lampCount,
          u_lamp: board.lamp,
          u_lampLit: lampLit,
          u_railBend: railBend,
          u_gate: gate,
          u_palette: board.palette,
          u_warm: emaCentroid,
          u_sat: sat,
          u_edgeTravel: edgeTravel,
          u_decay: decay,
          u_seed: board.seed,
        };
      },
    });
  },
};

export default g06PinballPreset;
