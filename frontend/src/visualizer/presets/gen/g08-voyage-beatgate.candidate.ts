/**
 * g08-voyage-beatgate (gen-8 TWEAK of g00-voyage / presets/voyage.ts, 1044).
 *
 * Human ask (verbatim, brief): "voyage variants with more beat-based effects
 * + alternative high/mid responses."
 *
 * Falsifiable question: does STRUCTURAL beat gating (structure that appears on
 * the grid — a lit lane sector advancing one-per-beat, a segmented ring whose
 * segments charge per beat and complete on the downbeat) read the meter more
 * legibly than the parent's continuous drift, WITHOUT tripping the
 * photosensitivity floor (all luminance envelopes stay smooth; the gate moves
 * WHICH sector is lit, not the whole-field brightness)?
 *
 * The engine is voyage's, copied verbatim into this self-contained file
 * (galaxy driven by the feedback buffer with differential rotation; the inner
 * field turns faster, shearing everything into spiral arms; kick ripple that
 * lights the dust; charged horizon ring; localized black-hole lens;
 * chroma-preserving soft knee). The tweak is a BEAT-GRID structural grammar
 * plus the two requested alternative band vocabularies:
 *
 *   BEAT GRAMMAR (structure appears on the grid, luminance smooth/photosafe):
 *     - LIT LANE SECTOR: the spiral disk is divided into `beatsPerBar` angular
 *       sectors. One sector is LIT per beat and the lit sector ADVANCES with
 *       the beat like runway lights (a smooth cosine window around the active
 *       sector's center — moving structure, not a flash). The sector index is
 *       the WHOLE beatInBar (integer — never interpolates); only the intra-beat
 *       glide of the window (for photosafe motion) uses beat phase.
 *     - SEGMENTED CHARGING RING: the horizon ring is split into `beatsPerBar`
 *       arc segments. Each beat one more segment charges; on the DOWNBEAT all
 *       segments are complete (the bar position is readable straight off the
 *       ring — count the lit arcs). Segments fill by whole beatInBar; a smooth
 *       envelope fades each in over its beat (photosafe).
 *
 *   ALTERNATIVE HIGH (no high nebula powder — dust fatigue): highs = crystalline
 *     GLINTS along the lit lane edges. Crisp specular points (tight gaussian
 *     spikes) seeded on the lane structure, density/brightness from the high
 *     band. No fbm powder wisps.
 *
 *   ALTERNATIVE MID (mids not dust AMOUNT): mids = lane WIDTH / breathing. The
 *     mid band opens/closes the angular width of the spiral lanes (the disk
 *     breathes with the mids) rather than adding more cloud.
 *
 *   KICK = parent ripple + the lit sector SLAMS bright (a solid, localized
 *     luminance lift on the currently-lit sector only — kicks are SOLID
 *     responses; this is not a fullscreen flash).
 *   DROP = every sector + every ring segment lit at once (the grid "fills")
 *     riding max(drop, energy), plus the parent's drop drama.
 *
 * Standing law (docs/visualizer-ga.md): kicks are SOLID (sector slam, ring,
 * ripple — no kick powder); sustained states ride max(drop, energy); no new
 * dust media (highs are glints, not powder); shape carries band identity,
 * color travels; photosensitivity floor — the beat gate is STRUCTURAL (moves
 * which sector is lit) with smooth luminance envelopes, no >3 Hz fullscreen
 * flash, no saturated-red strobe. Bright saturated colors (repo dislikes
 * pastels). Integer things (sector index, charged-segment count) NEVER
 * interpolate — gated by whole beatInBar off `ladderBarIndex ?? barIndex`.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

// No backticks inside this GLSL string (GLSL ES 1.0).
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
uniform float u_centroid;  // harmonic content: palette phase
uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;      // excitement WITH bass
uniform float u_buildup;   // excitement WITHOUT bass
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;  // seconds since the last strong kick
uniform float u_rippleAmp;  // that kick's captured strength
uniform float u_sustain;    // bass-weighted sustained loudness
uniform float u_armPhase;   // spiral-arm drift, BPM-locked when gridded
uniform float u_dust;       // disk cloud / fine-dust gain
uniform float u_palette;    // palette blend 0..3
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven star burst gain
// --- BEAT-GRID structural gating.
uniform float u_beatsPerBar;   // sectors / ring segments in the bar (>=1)
uniform float u_sectorPos;     // continuous lit-sector center, 0..beatsPerBar
uniform float u_charged;       // integer count of charged ring segments (0..bpb)
uniform float u_segFade;       // 0..1 smooth fade-in of the CURRENT charging seg
uniform float u_sectorSlam;    // 0..1 kick slam on the lit sector (decays)
uniform float u_gridFill;      // 0..1 drop: light every sector/segment at once
uniform float u_glint;         // high-band crystalline glint gain

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};
const float TAU = 6.2831853;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
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

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// iq cosine palette: deep-space blues/violets/pinks that TRAVEL.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the traveling palette at each star own hash phase.
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02);
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

// Angular distance (wrapped) between two angles in TURNS (0..1).
float angDistTurns(float a, float b) {
  float d = fract(a - b + 0.5) - 0.5;
  return abs(d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  float bpb = max(1.0, u_beatsPerBar);
  // Angle as a fraction of the full turn, 0..1 (for sector/segment math).
  float angTurn = fract(ang / TAU + 0.5);

  // ---- Warp: differential rotation + churn + traveling kick ripple.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  // Localized black-hole lens.
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  // Unsharp anti-mush tap.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a spectral-hue-biased warm palette slice.
  vec3 gravityColor = palette(0.05 + t * 0.015 + u_specHue * 0.5);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;

  // ---- THE SEGMENTED CHARGING RING. The horizon ring is split into bpb
  // arc segments; u_charged whole segments are complete and the current
  // segment fades in over its beat (u_segFade). On the downbeat all segments
  // are lit (bar position readable off the ring). Photosafe: each segment's
  // luminance envelope is a smooth fade, not a flash.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  // Which segment does this pixel's angle belong to (0..bpb-1)?
  float segIndexF = floor(angTurn * bpb);
  // A thin dark gap between segments so the arcs read as discrete.
  float segLocal = fract(angTurn * bpb);
  float segGap = smoothstep(0.02, 0.06, segLocal) * smoothstep(0.02, 0.06, 1.0 - segLocal);
  // Segment lit amount: fully lit if index < charged; the CURRENT segment
  // (index == charged) rides u_segFade; drop lights all (u_gridFill).
  float segLit = step(segIndexF + 0.5, u_charged);
  float curSeg = step(abs(segIndexF - u_charged) - 0.5, 0.0) * u_segFade;
  float ringSeg = max(max(segLit, curSeg), u_gridFill) * segGap;
  // Base ring (always faintly present so the horizon reads), + segment charge.
  float ringBase = 0.35;
  float ringAmt = ringBase + (1.0 - ringBase) * ringSeg;
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringAmt;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge) * ringAmt;

  // Coal heart (bass identity, always present).
  // Coal heart: a deep, low-luma slice of the traveling palette (spectral-hue
  // biased) instead of a fixed dark red — still whitens under a kick.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);

  // ---- THE LIT LANE SECTOR (runway lights). The disk is divided into bpb
  // angular sectors; one advances with the beat (u_sectorPos). A smooth cosine
  // window around the active sector center LIGHTS the lanes there; the rest of
  // the disk is dimmed to a base level. Structural gating — the WINDOW moves,
  // luminance stays smooth (photosafe).
  // Active sector center as a turn fraction: sectorPos/bpb.
  float sectorCenter = fract(u_sectorPos / bpb);
  // This pixel's sector distance from the active center, in sector-widths.
  float sectorDist = angDistTurns(angTurn, sectorCenter) * bpb;
  // Smooth cosine window ~1 sector wide (moving structure, not a hard edge).
  float sectorWin = pow(max(0.0, cos(clamp(sectorDist, 0.0, 1.0) * 1.5708)), 2.0);
  // The kick SLAM lifts only the lit sector; the drop fills every sector.
  float sectorGate = max(u_gridFill, 0.28 + 0.72 * sectorWin);
  float sectorSlam = sectorWin * u_sectorSlam;

  // ---- The disk: spiral lanes. MID = lane WIDTH/breathing (the disk opens
  // and closes its lanes with the mids) rather than dust amount. Lane
  // luminance is gated by the moving sector window.
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase);
  // Lane WIDTH breathes with the mids: a wider power = tighter lanes, so the
  // mid band OPENS them. narrow (high power) at low mid, wide at high mid.
  float lanePow = mix(4.2, 1.6, clamp(u_mid, 0.0, 1.0));
  float lanes = pow(0.5 + 0.5 * arm, lanePow) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8);
  float reverb = 1.0 + 2.6 * rippleWave;
  // Lanes now depend on the sector gate (structural beat gating), and their
  // amount rides a modest dust gain (no longer the mid — the mid is width).
  float laneAmt = (0.45 + 0.9 * u_mid + 1.4 * sectorSlam) * sectorGate;
  fresh += diskColor * lanes * laneAmt * (0.5 + cloud) * u_dust * centerDim * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * (0.25 + 0.5 * u_mid) * 0.45 * u_dust * centerDim * reverb * sectorGate;

  // ---- ALTERNATIVE HIGH: crystalline GLINTS along the lit lane edges (no
  // powder). Specular points seeded on the disk lattice, brightest where the
  // spiral lanes are strong AND the sector is lit; density/brightness from the
  // high band. Crisp gaussian spikes, not fbm dust.
  float laneEdge = pow(0.5 + 0.5 * arm, 8.0); // sharpen to the lane crest
  vec3 glint = starScatter(c * 1.7 + 31.7, 26.0, 1.2, 0.965, u_glint)
    * laneEdge * smoothstep(0.08, 0.5, r) * sectorGate * centerDim;
  // DISTINCT DUST HUE: the crystalline glints (alt-high) sample the palette at
  // +0.35 phase from the mid dust so the high band reads as a different kind.
  fresh += palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8) * glint * reverb;

  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    // Sector slam: a SOLID localized lift on the currently-lit sector only
    // (kicks are solid, localized — NOT a fullscreen flash; photosafe).
    float slamBand = smoothstep(0.08, 0.22, r) * exp(-r * 1.6);
    sky += diskColor * slamBand * sectorWin * u_sectorSlam * 1.6;
    sky *= 1.0 + 0.08 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // Film grain.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // Buildups cool/dim, drops bloom.
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'glints', label: 'glint density (highs)', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
  { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
];

export const g08VoyageBeatgatePreset: VisualizerPreset = {
  id: 'g08-voyage-beatgate',
  name: 'g08 voyage-beatgate',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;

    // --- Beat-grid state.
    // The lit sector glides toward the whole-beat target so runway motion is
    // photosafe (structural drift, not a flash); the integer beat drives WHICH
    // sector, the phase drives the glide toward it.
    let sectorPos = 0; // continuous, chases the integer beat target
    let sectorSlam = 0; // kick slam on the lit sector, decays
    let gridFill = 0; // drop: light every sector/segment, smoothed
    let lastBeatInBar = -1;
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase.
    let slowCentroid = 0.5;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;

        // Excitement split by bass presence (parent), temporally smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, 0.7 * sustained);

        // --- BEAT GRID. beatsPerBar sectors/segments; the WHOLE beatInBar is
        // the integer index (never interpolates), off the ladder tier. Beat
        // phase drives the intra-beat runway glide + segment fade only.
        const beatsPerBar = frame.beat ? Math.max(1, Math.round(frame.beat.beatsPerBar || 4)) : 4;
        // beatInBar is 0-based within the bar; align it to the ladder tier so
        // the downbeat lands on the ladder's boundary, not first-downbeat
        // modular arithmetic (ladderBarIndex ?? barIndex is the tier authority;
        // the intra-bar beat comes from beatInBar).
        const beatInBar = frame.beat
          ? ((Math.round(frame.beat.beatInBar) % beatsPerBar) + beatsPerBar) % beatsPerBar
          : 0;
        // barPhase: 0 downbeat .. 1 end of bar. Use it (and phase) only for
        // smooth intra-beat motion; the beat COUNT is integer.
        const barPhase = frame.beat ? frame.beat.barPhase : (frame.time * 0.4) % 1;

        // The lit sector TARGET is the integer beat; it chases with a short
        // time constant so it advances like runway lights (photosafe drift).
        if (frame.beat) {
          const target = beatInBar;
          // Fire a sector slam when the whole beat advances (a new light).
          if (beatInBar !== lastBeatInBar) {
            lastBeatInBar = beatInBar;
          }
          // Chase the target, unwrapping across the bar boundary so the light
          // always advances forward around the ring.
          let diff = target - (sectorPos % beatsPerBar);
          if (diff < -beatsPerBar / 2) diff += beatsPerBar;
          if (diff > beatsPerBar / 2) diff -= beatsPerBar;
          const chase = 1 - Math.exp(-dt / 0.06);
          sectorPos += diff * chase;
        } else {
          // Gridless: slow free advance so the runway still moves.
          sectorPos += dt * 1.2;
        }
        sectorPos = ((sectorPos % beatsPerBar) + beatsPerBar) % beatsPerBar;

        // Kick SLAM on the lit sector (solid, localized). Retrigger on kicks.
        sectorSlam = Math.max(sectorSlam * Math.exp(-dt / 0.16), Math.min(1, frame.impulse.low * 1.4));

        // Segmented ring charge: `charged` whole segments = beatInBar (all lit
        // on the downbeat when a full bar has passed). The CURRENT segment
        // fades in over its beat (barPhase within the beat) — photosafe.
        // charged = number of beats completed this bar = beatInBar, and on the
        // downbeat (beatInBar 0) all segments show (a completed bar).
        const beatFrac = frame.beat ? (barPhase * beatsPerBar) % 1 : (frame.time % 1);
        // On the downbeat we want the ring to read "full bar completed": show
        // all segments during the downbeat beat, then reset to fill again.
        const charged = beatInBar === 0 ? beatsPerBar : beatInBar;
        const segFade = 1 - Math.exp(-beatFrac / 0.35);

        // DROP grid-fill: light every sector/segment at once, riding
        // max(drop, energy), smoothed so it blooms (photosafe, structural).
        const fillTarget = Math.max(0, lift - 0.35) / 0.65;
        gridFill += (Math.min(1, fillTarget) - gridFill) * (1 - Math.exp(-dt / 0.25));

        // Arm drift (parent).
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        // Ring charge accumulator (parent — heats the ring color).
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        // Traveling ripple (parent).
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          u_rotStep: (0.05 + 0.5 * frame.bands.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          // Highs are GLINTS, not powder: gate on the high band + snare hats.
          u_glint:
            Math.min(1.6, (0.6 * frame.bands.high + 1.4 * frame.impulse.high)) *
            (frame.params.glints ?? 1) *
            (0.5 + 0.6 * Math.max(drop, sustained)),
          // Snare powder stays (mid transients) — no new dust; suppressed on
          // kicks so low-end impacts stay solid.
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          // --- BEAT-GRID uniforms.
          u_beatsPerBar: beatsPerBar,
          u_sectorPos: sectorPos,
          u_charged: charged,
          u_segFade: Math.min(1, segFade),
          u_sectorSlam: Math.min(1, sectorSlam),
          u_gridFill: Math.min(1, gridFill),
        };
      },
    });
  },
};

export default g08VoyageBeatgatePreset;
