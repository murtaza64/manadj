/**
 * "g15 kelvin-ink" (gen-15, fluids/flow lens — novel): a Kelvin–Helmholtz
 * vortex sheet. Two counter-flowing dye streams fill the frame — the TOP
 * stream flows one way, the BOTTOM the other — and the shear interface
 * between them rolls up into a chain of growing billows (six CPU-tracked
 * vortices riding the interface add localized rotation to the advection
 * field). Strong shear (a drop) winds the billows into full spirals.
 *
 * THE SIGNATURE MOVE: the house aberration fluid — chromatic shear inside
 * the feedback resampler — generalized from radial to FLOW-SPACE: the R/B
 * feedback taps split along the LOCAL velocity direction, so the fringes
 * stream with the fluid instead of radiating from a center.
 *
 * Deck-owned: stream speeds ride the two loudest decks' audible levels
 * (smoothed ~0.4s) — beatmatch becomes visible shear; with fewer than two
 * decks the streams fall back to slow mid/low bands. Dye duo committed
 * per track (dominantChannel trackId genome).
 *
 * Music mapping:
 *   deck levels / bandsSlow → stream speeds (motion law: smoothed)
 *   max(drop, sustained)    → vortex strength wind-up (billow spirals)
 *   impulse.low             → a pressure bulge travels the interface,
 *                             kinks it, and LIGHTS the dye it crosses
 *   impulse.mid             → a sharp dye flick off a billow crest
 *   section (ladder %16)    → the streams REVERSE (eased ~1.5s theatre)
 *
 * Contraction: decay < 1; all dye/meniscus injections are scaled by
 * (1 − decay) (bounded steady state) or are bounded mixes. Edges fade to
 * water where advection samples off-texture (no clamp streaks). GLSL ES
 * 1.0, constant loops, no backticks. Chroma-preserving soft knee.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const VORT_N = 6;

/** splitmix-style bit mix folded to [0,1) — per-track genome anchor. */
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

/** Committed dye duos (top / bottom / interface-hot), luminance-matched. */
const DUOS: [number[], number[], number[]][] = [
  [
    [0.95, 0.1, 0.22],
    [0.08, 0.8, 1.0],
    [1.0, 0.92, 0.78],
  ],
  [
    [1.0, 0.58, 0.05],
    [0.5, 0.22, 1.0],
    [1.0, 0.95, 0.85],
  ],
  [
    [1.0, 0.14, 0.72],
    [0.45, 1.0, 0.16],
    [0.95, 1.0, 0.9],
  ],
  [
    [0.05, 0.92, 0.72],
    [1.0, 0.32, 0.4],
    [0.95, 0.98, 1.0],
  ],
];

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_decay;
uniform float u_vTop;      // top stream velocity (units/s, signed)
uniform float u_vBot;      // bottom stream velocity (units/s, signed)
uniform float u_vortS;     // vortex strength (shear wind-up)
uniform float u_billow;    // billow scale (vortex falloff)
uniform float u_waveAmp;   // interface wave amplitude
uniform float u_ph1;
uniform float u_ph2;
uniform float u_bulgeX;    // kick pressure bulge (field x)
uniform float u_bulgeAge;
uniform float u_bulgeAmp;
uniform float u_kick;
uniform float u_windup;    // aberration drive (drop/sustained)
uniform float u_dye;       // dye injection gain
uniform float u_topLv;     // deck activity per stream
uniform float u_botLv;
uniform float u_dir;       // flow direction ease (+1 .. -1)
uniform vec2 u_flickPos;
uniform float u_flickAmp;
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform vec3 u_colHot;
uniform float u_vortX[6];  // vortex x in uv units

const vec3 WATER = vec3(0.01, 0.012, 0.02);

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

// Interface height at field-x: two drifting modes + the kick bulge kink.
float yInterface(float x) {
  float y = u_waveAmp * (0.6 * sin(x * 5.1 + u_ph1) + 0.4 * sin(x * 9.7 - u_ph2));
  y += 0.07 * u_bulgeAmp * exp(-pow((x - u_bulgeX) * 5.0, 2.0)) * exp(-u_bulgeAge * 2.4);
  return y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 px = 1.0 / u_res;

  float yI = yInterface(p.x);
  float rel = p.y - yI;
  float side = smoothstep(-0.05, 0.05, rel);

  // ---- Velocity field: two counter-streams + the vortex chain + curl.
  vec2 vel = vec2(mix(u_vBot, u_vTop, side), 0.0);
  for (int i = 0; i < 6; i++) {
    float vx = (u_vortX[i] - 0.5) * aspect;
    vec2 vp = vec2(vx, yInterface(vx));
    vec2 d = p - vp;
    vec2 perp = vec2(-d.y, d.x);
    vel += perp * u_vortS * exp(-dot(d, d) * u_billow);
  }
  vel += (vec2(
    noise(p * 6.0 + u_time * 0.2),
    noise(p * 6.0 + vec2(8.1, 2.7) - u_time * 0.17)
  ) - 0.5) * (0.006 + 0.02 * u_windup);
  // The bulge pushes fluid radially as it travels (solid, physical).
  vec2 bp = vec2(u_bulgeX, yInterface(u_bulgeX));
  vec2 bd = p - bp;
  float br = length(bd);
  vel += (br > 1e-4 ? bd / br : vec2(0.0))
    * u_bulgeAmp * exp(-br * 6.0) * exp(-u_bulgeAge * 3.0) * 0.14;

  vec2 src = p - vel * u_dt;
  vec2 srcUv = src / vec2(aspect, 1.0) + 0.5;
  float edgeFade = smoothstep(0.0, 0.012, srcUv.x) * smoothstep(0.0, 0.012, 1.0 - srcUv.x)
    * smoothstep(0.0, 0.012, srcUv.y) * smoothstep(0.0, 0.012, 1.0 - srcUv.y);

  // ---- FLOW-SPACE ABERRATION: R/B taps split along the local velocity.
  float speed = length(vel);
  vec2 flowDir = speed > 1e-5 ? vel / speed : vec2(1.0, 0.0);
  vec2 ab = flowDir * (0.0014 + 0.005 * u_kick + 0.0045 * u_windup) / vec2(aspect, 1.0);
  vec3 tapC = texture2D(u_prev, srcUv).rgb;
  vec3 sampled = vec3(
    texture2D(u_prev, srcUv + ab).r,
    tapC.g,
    texture2D(u_prev, srcUv - ab).b
  );
  vec3 blur = (texture2D(u_prev, srcUv + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, srcUv - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, srcUv + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, srcUv - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sharp = max(vec3(0.0), sampled * 1.33 - blur * 0.33);
  vec3 ink = mix(WATER, mix(WATER, sharp, edgeFade), u_decay);

  // ---- Dye injection: filaments hugging the interface, entering at each
  // stream's inflow edge. (1 - decay)-normalized: steady state bounded.
  float inj = (1.0 - u_decay) * u_dye;
  float halfW = aspect * 0.5;
  float inTop = exp(-pow((p.x + u_dir * halfW * 0.85) * 2.4, 2.0));
  float inBot = exp(-pow((p.x - u_dir * halfW * 0.85) * 2.4, 2.0));
  float filTop = exp(-pow((rel - 0.1) * 70.0, 2.0)) + exp(-pow((rel - 0.24) * 60.0, 2.0))
    + 0.7 * exp(-pow((rel - 0.4) * 50.0, 2.0));
  float filBot = exp(-pow((rel + 0.1) * 70.0, 2.0)) + exp(-pow((rel + 0.24) * 60.0, 2.0))
    + 0.7 * exp(-pow((rel + 0.4) * 50.0, 2.0));
  ink += u_colA * filTop * inTop * (0.35 + 0.85 * u_topLv) * inj * 1.4;
  ink += u_colB * filBot * inBot * (0.35 + 0.85 * u_botLv) * inj * 1.4;

  // ---- Meniscus: the glowing interface line; the kick bulge LIGHTS the
  // dye it passes (traveling brightness front).
  float men = exp(-pow(rel * 95.0, 2.0));
  float bulgeLight = exp(-pow((p.x - u_bulgeX) * 3.5, 2.0)) * exp(-u_bulgeAge * 2.4) * u_bulgeAmp;
  ink += u_colHot * men * (0.4 + 0.5 * u_windup + 2.2 * bulgeLight) * inj * 1.6;
  // The front also lights nearby dye body, not just the line.
  ink += mix(u_colA, u_colB, side) * bulgeLight * exp(-abs(rel) * 7.0) * inj * 2.2;

  // ---- Snare flick: a sharp dye streak off a billow crest (bounded mix).
  if (u_flickAmp > 0.01) {
    vec2 fd = (p - u_flickPos) * vec2(26.0, 90.0);
    float fl = exp(-dot(fd, fd));
    ink = mix(ink, u_colHot, clamp(fl * u_flickAmp, 0.0, 1.0) * 0.85);
  }

  // Chroma-preserving soft knee.
  float m = max(ink.r, max(ink.g, ink.b));
  if (m > 0.8) {
    ink *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(ink, 0.0), 1.0);
}
`;

const g15KelvinInkPreset: VisualizerPreset = {
  id: 'g15-kelvin-ink',
  name: 'g15 kelvin-ink',
  hiRes: true,
  params: [
    { id: 'shear', label: 'shear gain', min: 0.3, max: 2.5, step: 0.05, default: 1 },
    { id: 'billow', label: 'billow size', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'dye', label: 'dye density', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 1.4, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    const vortX = new Float32Array(VORT_N);
    for (let i = 0; i < VORT_N; i++) vortX[i] = (i + 0.5) / VORT_N;
    let ph1 = Math.random() * 6.28;
    let ph2 = Math.random() * 6.28;
    let topSm = 0;
    let botSm = 0;
    let windup = 0;
    let dir = 1;
    let dirTarget = 1;
    let lastSection: number | null = null;
    let bulgeX = 0;
    let bulgeAge = 999;
    let bulgeAmp = 0;
    let flickAmp = 0;
    const flickPos: [number, number] = [0, 0];
    let duoIndex = 0;
    let lastTrack: number | null = null;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const motion = frame.bandsSlow ?? frame.bands;

        // Two loudest decks own the streams; fallback = slow band split.
        const byLevel = [...frame.decks].sort((a, b) => b.level - a.level);
        const topRaw = byLevel.length >= 2 ? byLevel[0].level : 0.3 + 0.7 * motion.mid;
        const botRaw = byLevel.length >= 2 ? byLevel[1].level : 0.3 + 0.7 * motion.low;
        const ease = 1 - Math.exp(-dt / 0.4);
        topSm += (topRaw - topSm) * ease;
        botSm += (botRaw - botSm) * ease;

        // Wind-up: max(drop, sustained), smoothed — vortex strength driver.
        const regime = frame.regime;
        const lift = regime
          ? Math.max(regime.sustained, regime.dropTransition)
          : Math.min(1, Math.max(frame.trend.excitement, (motion.low + motion.mid) * 0.8));
        windup += (lift - windup) * (1 - Math.exp(-dt / 0.5));

        // Section boundary: streams reverse (eased ~1.5s).
        const bar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
        const section = bar !== null ? Math.floor(bar / 16) : null;
        if (section !== null) {
          if (lastSection !== null && section !== lastSection) dirTarget = -dirTarget;
          lastSection = section;
        }
        dir += (dirTarget - dir) * (1 - Math.exp(-dt / 1.5));

        const shearGain = frame.params.shear ?? 1;
        const vTop = dir * (0.03 + 0.24 * topSm) * shearGain;
        const vBot = -dir * (0.03 + 0.24 * botSm) * shearGain;
        const shear = Math.abs(vTop - vBot);

        // Vortex chain drifts gently with the sheet; phases ride the shear.
        for (let i = 0; i < VORT_N; i++) {
          vortX[i] += dir * 0.008 * (1 + windup) * dt;
          if (vortX[i] > 1.12) vortX[i] -= 1.24;
          if (vortX[i] < -0.12) vortX[i] += 1.24;
        }
        ph1 += shear * 2.0 * dt + dt * 0.1;
        ph2 += shear * 1.4 * dt + dt * 0.07;

        // Kick: pressure bulge travels the interface, retriggered.
        bulgeAge += dt;
        const kick = frame.impulse.low;
        if (kick > 0.33 && bulgeAge > 0.16) {
          bulgeAge = 0;
          bulgeAmp = Math.min(1, kick * 1.2);
          bulgeX = -dir * 0.7; // enters from the top stream's inflow side
        }
        bulgeX += dir * 0.55 * dt;

        // Snare: dye flick off the billow crest nearest mid-frame.
        const snare = frame.impulse.mid;
        if (snare > 0.3) {
          let best = 0;
          let bestDist = 99;
          for (let i = 0; i < VORT_N; i++) {
            const d = Math.abs(vortX[i] - 0.5);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
          flickPos[0] = (vortX[best] - 0.5) * 1.6;
          flickPos[1] = (Math.random() - 0.5) * 0.16;
          flickAmp = Math.min(1, snare * 1.15);
        } else {
          flickAmp *= Math.exp(-dt / 0.09);
        }

        // Duo palette per track (dominance law).
        const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
        const track = dom?.trackId ?? null;
        if (track !== null && track !== lastTrack) {
          lastTrack = track;
          duoIndex = Math.floor(splitmix01(track) * DUOS.length) % DUOS.length;
        }
        const [colA, colB, colHot] = DUOS[duoIndex];

        const persistence = frame.params.persistence ?? 1;
        const decay = Math.min(0.9975, 1 - (1 - 0.9935) / persistence);

        return {
          u_time: frame.time,
          u_dt: dt,
          u_decay: decay,
          u_vTop: vTop,
          u_vBot: vBot,
          u_vortS: shear * (1.6 + 3.2 * windup),
          u_billow: 60 / (frame.params.billow ?? 1),
          u_waveAmp: 0.016 + 0.05 * windup,
          u_ph1: ph1,
          u_ph2: ph2,
          u_bulgeX: bulgeX,
          u_bulgeAge: bulgeAge,
          u_bulgeAmp: bulgeAmp,
          u_kick: kick,
          u_windup: windup,
          u_dye: frame.params.dye ?? 1,
          u_topLv: topSm,
          u_botLv: botSm,
          u_dir: dir,
          u_flickPos: flickPos,
          u_flickAmp: flickAmp,
          u_colA: [colA[0], colA[1], colA[2]],
          u_colB: [colB[0], colB[1], colB[2]],
          u_colHot: [colHot[0], colHot[1], colHot[2]],
          u_vortX: vortX,
        };
      },
    });
  },
};

export default g15KelvinInkPreset;
