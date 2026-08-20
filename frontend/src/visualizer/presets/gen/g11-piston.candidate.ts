/**
 * "g11 piston" (genetic arena g11, novel — bass as WEIGHT).
 *
 * The falsifiable win condition: bass must read as PHYSICAL MASS pressing on
 * the scene, not as glow, rings or a pump. The whole composition lives under
 * a massive flat PRESS — a horizontal slab that descends from the top of the
 * frame. Everything below it is squeezed between the press face and the floor.
 *
 * The representation, built from Disney's squash-and-stretch (the animation
 * principle that sells weight): a body under load compresses vertically AND
 * bulges horizontally, conserving apparent volume. So here:
 *
 *  - BASS LEVEL (bandsSlow.low) = the press's resting DEPTH. Heavy bass = the
 *    press sits low, the whole scene is short and wide (squashed under load).
 *    Bass dropout = the press lifts, the scene springs TALL and narrow (airy).
 *    This rides the slow bands so the height glides — no per-frame jerk.
 *  - KICK (impulse.low, instantaneous) = the press STAMPS. A one-shot elastic
 *    envelope (fast downstroke ~40ms, damped-spring recovery ~200ms) drives an
 *    extra downward punch. On the punch the scene squashes hard and bulges
 *    wide; the spring overshoot makes it stretch tall past rest before settling
 *    — authoritative WEIGHT, an impact, never a flash. The envelope is JS-side
 *    (a critically-ish-damped spring) so it reads as one heavy stamp.
 *  - MIDS (bands.mid) = the resisting STRUTS: vertical pillars between floor and
 *    press face that carry the palette color. They FLEX and BUCKLE (a lateral
 *    S-bow that grows with compression and mid content) and re-form — the load
 *    path made visible. trackId genome sets how many struts and their spacing
 *    rhythm, so each song has its own architecture.
 *  - HIGHS (impulse.high) = pressure GLINTS: crisp discrete sparks that escape
 *    ONLY at the contact seam (where the press face meets the strut tops) and
 *    at the floor line — a hard bright dash at the seam, gated to the seam band
 *    so it never becomes broadcast dust.
 *  - DROP (smoothed, bass-weighted) = the press grinds down to MINIMUM height;
 *    the scene burns bright in the crush (luminance rides max(drop, energy)).
 *  - BUILDUP = the press TREMBLES as it rises (a dread jitter on the press face
 *    height), tense-but-alive, distinct from the drop's committed crush.
 *
 * Rendering: a single crisp SDF fragment shader (no feedback, no glow) — flat
 * matte fills, hard edges, committed 3-color banks selected by the genome.
 * FLAT-appetite compliant (gen-10 human ask). Non-centered: the press and
 * floor are horizontal, the struts march across, the seam glints are local.
 *
 * Assigned tech: band envelopes (low as slow weight, mid as struts), per-band
 * impulses (kick = stamp, hat = seam glints), trend drop/buildup split, deck
 * trackId genome (g02-julia pattern), phrase/section via ladderBarIndex.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

// --- GLSL --------------------------------------------------------------
// No backticks inside this string. Pure SDF composition; crisp antialiased
// edges via fwidth-free analytic smoothstep against a pixel-scale.
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_pressY;     // press face height, 0 (floor) .. 1 (top) — WEIGHT
uniform float u_squash;     // squash-and-stretch factor: >1 wide/short, <1 tall/narrow
uniform float u_stamp;      // 0..1 kick stamp envelope (elastic), brightness+punch
uniform float u_mid;        // strut flex/buckle amount
uniform float u_seam;       // 0..1 hat glint envelope at the contact seam
uniform float u_low;        // instantaneous bass for face brightness under load
uniform float u_drop;       // bass-weighted smoothed drop: crush + burn
uniform float u_buildup;    // buildup tremble amount (press rising, dread)
uniform float u_energy;     // sustained loudness floor for luminance
uniform float u_struts;     // strut count (genome), continuous
uniform float u_spacing;    // strut spacing phase (genome)
uniform float u_seed;       // scalar seed for architecture jitter
uniform vec3  u_cFloor;     // palette: floor / base slab
uniform vec3  u_cStrut;     // palette: struts (the color that travels)
uniform vec3  u_cPress;     // palette: the press slab (heavy, authoritative)

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453123); }

// Antialiased fill: 1 inside, 0 outside, over ~1px of the signed distance d
// (d in normalized-y units; px is one pixel in those units).
float aa(float d, float px) {
  return clamp(0.5 - d / px, 0.0, 1.0);
}

void main() {
  // Work in a coordinate where y=0 is the floor, y=1 is the top of frame.
  vec2 uv = gl_FragCoord.xy / u_res;
  float px = 1.0 / u_res.y;              // one pixel in y units
  float aspect = u_res.x / u_res.y;

  // Squash-and-stretch: the scene's horizontal scale is the inverse of its
  // vertical compression so apparent VOLUME is conserved (the weight tell).
  // We warp the horizontal sample coordinate around center by u_squash.
  float xc = (uv.x - 0.5) * aspect;
  xc /= max(0.35, u_squash);             // squashed (u_squash>1) => wider content
  float x = xc / aspect + 0.5;           // back to 0..1-ish across the frame

  float y = uv.y;

  // ---- The press face height. Rest height set by bass WEIGHT (low = low
  // press), stamped down by the kick envelope, trembling on buildups.
  float tremble = u_buildup * 0.018 * sin(u_time * 41.0 + u_seed * 30.0);
  float faceY = u_pressY - 0.16 * u_stamp + tremble;
  faceY = clamp(faceY, 0.06, 0.98);

  // ---- Base slab / floor: a solid matte band across the bottom, its top
  // edge crisp. Height is small and steady (the anvil the press works against).
  float floorTop = 0.10;
  vec3 col = vec3(0.02);                  // near-black backdrop (flat, not glowy)
  float inFloor = aa(y - floorTop, px);
  col = mix(col, u_cFloor, inFloor);

  // ---- The press slab: everything ABOVE faceY is the press body (a heavy
  // solid fill). Crisp bottom edge = the press face.
  float inPress = aa(faceY - y, px);
  // The press darkens as it descends (heavier = denser); brightens in the
  // crush (drop) so the crush BURNS.
  float pressLum = 0.55 + 0.5 * u_drop + 0.25 * u_stamp - 0.25 * (0.6 - faceY);
  col = mix(col, u_cPress * clamp(pressLum, 0.15, 1.4), inPress);

  // A hard contact-shadow line just under the press face sells the mass
  // bearing down (a crisp darker seam band, 3px).
  float shadow = aa(abs(y - (faceY - 0.012)) - 0.006, px);
  col = mix(col, col * 0.45, shadow * (1.0 - inPress) * (0.5 + 0.5 * u_low));

  // ---- Struts: vertical pillars from floorTop up to the press face, carrying
  // the traveling palette color. They FLEX (lateral S-bow) with compression +
  // mids. Count/spacing from the genome. Crisp rectangular columns.
  float n = max(2.0, u_struts);
  // Compression makes the gap between press and floor shorter; struts of a
  // fixed rest-length must BUCKLE — model buckling as a lateral bow whose
  // amplitude grows as (restGap - gap) and with mid content.
  float gap = faceY - floorTop;
  float restGap = 0.72;
  float buckle = clamp((restGap - gap) / restGap, 0.0, 1.0);
  float bowAmp = (0.02 + 0.09 * buckle + 0.05 * u_mid);
  float strutMask = 0.0;
  float seamTop = 0.0;
  // March struts across x; each is a column with its own phase.
  for (int i = 0; i < 24; i++) {
    if (float(i) >= n) break;
    float fi = float(i);
    float cellW = 1.0 / n;
    // Genome jitter on center + width so architecture differs per song.
    float jitter = (hash(fi * 1.7 + u_spacing * 9.0 + u_seed * 3.0) - 0.5) * cellW * 0.5;
    float cx = (fi + 0.5) * cellW + jitter;
    // Lateral buckle bow: an S-curve along the strut's height, sign alternates
    // per strut so they buckle in opposition (a woven load path).
    float sgn = (mod(fi, 2.0) < 1.0) ? 1.0 : -1.0;
    float t = clamp((y - floorTop) / max(0.02, gap), 0.0, 1.0);
    float bow = sgn * bowAmp * sin(t * 3.14159) * (0.6 + 0.4 * sin(u_time * 2.0 + fi));
    float halfW = cellW * (0.16 + 0.05 * u_mid) / max(0.35, u_squash);
    float dx = abs(x - (cx + bow)) - halfW;
    // Strut lives only between floor and press face.
    float inCol = aa(dx, px * aspect);
    float within = aa(y - floorTop, px) * aa(faceY - y, px) * inCol;
    strutMask = max(strutMask, within);
    // Is this pixel right at the strut top touching the press face?
    // (the load-concentration point where a pressure glint escapes).
    float atSeam = within * aa(abs(y - (faceY - 0.008)) - 0.010, px);
    seamTop = max(seamTop, atSeam);
  }
  // Strut color travels; flexed struts brighten (stress glow, but matte).
  vec3 strutCol = u_cStrut * (0.7 + 0.6 * u_mid + 0.4 * buckle + 0.5 * u_energy);
  col = mix(col, strutCol, strutMask);

  // ---- Pressure GLINTS: crisp discrete sparks at the contact seam only,
  // gated by the hat envelope. A short bright dash at strut tops where the
  // load concentrates — never broadcast across the field.
  float glint = seamTop * u_seam;
  // Add a sparse temporal flicker so glints pop discretely, not smear.
  float flick = step(0.5, hash(floor(x * 60.0) + floor(u_time * 24.0)));
  col += vec3(1.0, 0.96, 0.85) * glint * (0.6 + 0.8 * flick);

  // Seam glints at the floor line too when the press crushes hard.
  float floorSeam = aa(abs(y - floorTop) - 0.006, px) * u_seam * u_drop;
  col += vec3(0.9, 0.95, 1.0) * floorSeam * flick * 0.8;

  // ---- Stamp flash localized to the press face band (a bright impact ridge
  // right at the face on the downstroke), rate-limited by the envelope shape.
  float faceRidge = aa(abs(y - faceY) - 0.008, px);
  col += u_cPress * faceRidge * u_stamp * (0.5 + 0.7 * u_low);

  // ---- Whole-scene luminance rides max(drop, energy); buildups stay alive.
  float lum = 0.7 + 0.5 * max(u_drop, u_energy) + 0.12 * u_buildup;
  col *= lum;

  // Chroma-preserving soft knee (never per-channel clamp) — hold hues.
  float mx = max(col.r, max(col.g, col.b));
  if (mx > 0.9) {
    col *= (0.9 + 0.1 * (1.0 - exp(-(mx - 0.9) * 3.0))) / mx;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'weightDepth', label: 'bass weight depth', min: 0.3, max: 1.5, step: 0.05, default: 1 },
  { id: 'stampPunch', label: 'kick stamp punch', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'strutFlex', label: 'strut flex', min: 0.3, max: 2, step: 0.05, default: 1 },
  { id: 'strutCount', label: 'strut count', min: 3, max: 16, step: 1, default: 8 },
  { id: 'crushBurn', label: 'crush brightness', min: 0.5, max: 2, step: 0.05, default: 1 },
];

// --- Song genome (JS-side, g02-julia pattern) --------------------------

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
  strutCount: number; // discrete architecture
  spacing: number;
  seed: number;
  bank: number; // palette bank 0..2
}

function hashGenome(key: number): Genome {
  const next = splitmix(Math.round(key));
  const a = next();
  const b = next();
  const c = next();
  const d = next();
  return {
    strutCount: 4 + Math.floor(a * 9), // 4..12 struts
    spacing: b,
    seed: c,
    bank: Math.floor(d * 3),
  };
}

/** Committed, luminance-parity 3-color banks (bright, saturated — no pastel).
 * Each bank: [floor, strut(traveling color), press]. */
const BANKS: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [
  // Furnace: dark iron floor, molten-orange struts, deep-red press.
  [[0.10, 0.06, 0.05], [1.0, 0.42, 0.05], [0.55, 0.09, 0.10]],
  // Cryo: slate floor, electric-cyan struts, indigo press.
  [[0.06, 0.09, 0.12], [0.10, 0.85, 1.0], [0.16, 0.12, 0.55]],
  // Acid: charcoal floor, lime struts, magenta press.
  [[0.08, 0.08, 0.06], [0.65, 1.0, 0.10], [0.85, 0.08, 0.55]],
];

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

const g11PistonPreset: VisualizerPreset = {
  id: 'g11-piston',
  name: 'g11 piston',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    // Genome / identity.
    let seededKey: number | null = null;
    let genome: Genome = hashGenome(1);
    let lastTrackId: number | null = null;
    // Regime smoothing.
    let smoothDrop = 0;
    let smoothBuildup = 0;
    // Kick stamp: a damped spring so the stamp reads as ONE heavy impact with
    // elastic recovery (position + velocity integrated JS-side).
    let stampPos = 0; // 0 rest .. 1 fully stamped down
    let stampVel = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: false,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const bandsSlow = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);

        // --- Identity: dominant trackId seeds strut architecture + palette.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((energy * 4096 + frame.centroid * 811 + frame.spread * 173) * 131);
        if (seededKey == null) {
          seededKey = key;
          genome = hashGenome(key);
          lastTrackId = trackId;
        } else if (trackId != null && trackId !== lastTrackId) {
          seededKey = key;
          genome = hashGenome(key);
          lastTrackId = trackId;
        }

        // --- Regime split (smoothed ~0.35 s; bass-weighted drop).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const rAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * rAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * rAlpha;
        const sustained = Math.min(1, energy * 1.4);

        // --- Phrase/section from ladder-correct bars.
        const barIndex = frame.beat?.ladderBarIndex ?? frame.beat?.barIndex ?? 0;
        const section = Math.floor(barIndex / 16);
        // Section rotates the palette bank so boundaries are theatre.
        const bank = (genome.bank + section) % 3;

        // --- Kick STAMP: a damped spring driven by impulse.low. The kick
        // injects downward velocity; the spring pulls back to rest with an
        // overshoot (stretch past rest) that sells the elastic recovery.
        const stampPunch = frame.params.stampPunch ?? 1;
        // Instantaneous kick kicks the spring (a broadband kick is gated by
        // impulse.low already — solid response, not powder).
        if (frame.impulse.low > 0.12) {
          stampVel += frame.impulse.low * 9.0 * stampPunch;
        }
        // Spring: k pulls toward 0 (rest), c damps. ~200ms recovery.
        const k = 240;
        const c = 14;
        stampVel += (-k * stampPos - c * stampVel) * dt;
        stampPos += stampVel * dt;
        // stampPos can overshoot negative (stretch tall past rest) — clamp the
        // shader-facing value to [−0.35, 1] and let negative read as stretch.
        const stampDown = Math.max(0, Math.min(1, stampPos));
        const stretch = Math.max(0, -stampPos); // overshoot amount

        // --- Bass WEIGHT: press rest height. Heavy bass => low press. Drop
        // grinds it to minimum. Rides the SLOW bands (glide, no jerk).
        const weightDepth = frame.params.weightDepth ?? 1;
        // pressY high (~0.9) when airy, low (~0.35) under heavy bass, floored
        // to minimum in the crush.
        const restY =
          0.92 -
          0.5 * weightDepth * bandsSlow.low -
          0.25 * smoothDrop +
          0.12 * stretch; // spring overshoot lifts the face (stretch tall)
        const pressY = Math.max(0.16, Math.min(0.96, restY));

        // --- Squash-and-stretch: compression (low pressY) => wider content;
        // stretch overshoot => narrower. Volume-conserving inverse mapping.
        const compression = 1 - (pressY - 0.16) / 0.8; // 0 airy .. 1 crushed
        const squash =
          1 + 0.55 * compression + 0.6 * stampDown - 0.4 * stretch;

        // --- Struts: genome count (slider can override upward for taste).
        const strutParam = frame.params.strutCount ?? 8;
        const struts = Math.max(3, Math.round((genome.strutCount + strutParam) / 2));

        // --- Strut flex from mids.
        const strutFlex = frame.params.strutFlex ?? 1;
        const midFlex = Math.min(1.2, frame.bands.mid * strutFlex);

        // --- Seam glints from hats (discrete, seam-gated in shader).
        const seam = Math.min(1, frame.impulse.high * 1.2);

        // --- Crush burn scaling.
        const crushBurn = frame.params.crushBurn ?? 1;

        const [cFloor, cStrut, cPress] = BANKS[bank];

        return {
          u_time: frame.time,
          u_pressY: pressY,
          u_squash: Math.max(0.4, squash),
          u_stamp: stampDown,
          u_mid: midFlex,
          u_seam: seam,
          u_low: frame.bands.low,
          u_drop: smoothDrop * crushBurn,
          u_buildup: smoothBuildup,
          u_energy: sustained,
          u_struts: struts,
          u_spacing: genome.spacing,
          u_seed: genome.seed,
          u_cFloor: cFloor,
          u_cStrut: cStrut,
          u_cPress: cPress,
        };
      },
    });
  },
};

export default g11PistonPreset;
