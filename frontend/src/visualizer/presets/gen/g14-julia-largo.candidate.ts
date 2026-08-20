/**
 * g14-julia-largo (gen-14 NOVEL — clean-room Julia resurrection #3).
 * Fossils g02-julia / g03-julia-lumen / g04-julia-glacial read only for
 * the autopsy: "too fast to read as musical", "blank much of the time".
 *
 * The fix is architectural, not parametric:
 * - C lives on a PRE-VERIFIED dense locus (just inside the main cardioid,
 *   or the period-2 disk) so the Julia set is connected BY CONSTRUCTION —
 *   it can never wander into Cantor-dust blankness.
 * - C advances one MONOTONE genome-fixed θ step per BAR (ladder-correct),
 *   eased over ~0.25 s, then HELD STILL. Phrase bars step 4×; section
 *   bars swap locus family + palette bank. No random-sign jitter walk.
 * - ALL wall-clock clocks are frozen: the orbit-trap point and the frame
 *   rotation are bar-quantized constants eased on the same envelope; zoom
 *   is a genome constant with a tiny bandsSlow breath. Between steps the
 *   anatomy is STILL — the music moves only LIGHT.
 * - Never blank: exterior pixels get smooth-iteration banded palette
 *   color, interior gets orbit-trap glow, and an additive floor is
 *   applied BEFORE energy scaling.
 * - Kicks are COLOR events (trap bloom + a traveling radial light ring),
 *   never displacement or zoom punches. Whole-frame kick lift ≤ 1.08.
 *
 * No feedback buffer: pure stateless shader, no contraction concerns.
 * Photosafety: no full-field strobe; the kick ring is localized, the
 * global lift is small and kick-rate-bounded by the impulse envelope.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform vec2 u_c;          // Julia parameter (bar-quantized, JS-eased)
uniform float u_rot;       // frame rotation (bar-quantized, JS-eased)
uniform vec2 u_trap;       // orbit-trap point (bar-quantized, JS-eased)
uniform float u_trapRad;   // trap radius (mid breathing + buildup tighten)
uniform float u_zoom;      // genome framing + tiny bandsSlow breath
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_drop;      // smoothed excitement WITH bass
uniform float u_buildup;   // smoothed excitement WITHOUT bass
uniform float u_energy;    // max(drop, sustained) — plateau-safe lift
uniform float u_ringAge;   // seconds since last strong kick
uniform float u_ringAmp;   // that kick's captured strength
uniform float u_bank;      // palette bank 0..3 (section-stepped, eased)
uniform float u_bandGain;  // exterior band density param
uniform float u_glow;      // trap gain param
uniform float u_warm;      // centroid temperature (slow EMA)
uniform float u_lineW;     // genome line-trap weight

const int ITER = 80;

// Four iq cosine banks, luminance-comparable (similar bias/amp), morphed
// continuously by u_bank so section swaps read as chroma events.
vec3 bank0(float t) { return vec3(0.42, 0.20, 0.30) + vec3(0.45, 0.38, 0.42) * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.18, 0.42))); }
vec3 bank1(float t) { return vec3(0.24, 0.32, 0.42) + vec3(0.38, 0.44, 0.46) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.3, 0.1))); }
vec3 bank2(float t) { return vec3(0.36, 0.38, 0.20) + vec3(0.44, 0.42, 0.38) * cos(6.28318 * (vec3(1.0, 0.8, 0.9) * t + vec3(0.12, 0.42, 0.75))); }
vec3 bank3(float t) { return vec3(0.40, 0.24, 0.42) + vec3(0.42, 0.40, 0.46) * cos(6.28318 * (vec3(0.8, 1.0, 0.9) * t + vec3(0.8, 0.05, 0.35))); }

vec3 palette(float t) {
  float x = clamp(u_bank, 0.0, 3.0);
  vec3 c = mix(bank0(t), bank1(t), clamp(x, 0.0, 1.0));
  c = mix(c, bank2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, bank3(t), clamp(x - 2.0, 0.0, 1.0));
  // Drop warms + saturates; buildup cools. Bounded biases (color, not luma).
  c += vec3(0.10, 0.01, -0.07) * u_drop - vec3(0.06, 0.02, -0.05) * u_buildup;
  c += vec3(0.10, 0.02, -0.09) * (u_warm - 0.5);
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.6 / u_zoom;
  float cs = cos(u_rot);
  float sn = sin(u_rot);
  vec2 z = mat2(cs, -sn, sn, cs) * p;
  float rScreen = length(p);

  // ---- Julia iteration with alive-mask + orbit traps.
  float alive = 1.0;
  float nu = float(ITER);       // smooth iteration count at escape
  float trapPt = 1e5;           // min distance to the trap point
  float trapLn = 1e5;           // min distance to the horizontal line trap
  float m2 = 0.0;
  for (int i = 0; i < ITER; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + u_c;
    m2 = dot(z, z);
    float esc = step(16.0, m2) * alive;   // 1 exactly on the escape frame
    // Smooth iteration: nu = i + 1 - log2(log2(|z|)) captured at escape.
    if (esc > 0.5) {
      nu = float(i) + 1.0 - log2(max(1.0, log2(max(m2, 1.0001)) * 0.5));
    }
    alive *= 1.0 - esc;
    // Traps accumulate only while the orbit is alive.
    trapPt = min(trapPt, mix(1e5, length(z - u_trap), alive));
    trapLn = min(trapLn, mix(1e5, abs(z.y), alive));
  }

  vec3 col = vec3(0.0);

  // ---- Exterior: smooth-nu banded palette. EVERY escaped pixel colored —
  // the never-blank guarantee. Band edges shimmer with highs (localized to
  // the edges, not full-field).
  float ext = 1.0 - alive;
  float bandT = nu * (0.16 + 0.10 * u_bandGain);
  float bandEdge = abs(fract(bandT * 2.0) - 0.5) * 2.0;   // 1 at band centers
  float edgeLine = pow(1.0 - bandEdge, 6.0);              // thin edge lines
  vec3 extCol = palette(bandT + u_bank * 0.13);
  float extLum = 0.30 + 0.28 * pow(bandEdge, 1.5) + edgeLine * (0.25 + 1.4 * u_high);
  col += ext * extCol * extLum;

  // ---- Interior: orbit-trap glow. Point trap = the anatomy's skeleton;
  // line trap adds filigree veins. Mid flashes (snare) whiten the trap.
  float gPt = exp(-trapPt * trapPt / max(u_trapRad * u_trapRad, 1e-4) * 3.0);
  float gLn = exp(-trapLn * (26.0 - 10.0 * u_trapRad));
  vec3 inCol = palette(0.08 + trapPt * 0.9 + u_bank * 0.21);
  vec3 veinCol = palette(0.55 + trapLn * 1.4);
  float trapGain = u_glow * (0.55 + 0.75 * u_low + 0.9 * u_kick + 0.4 * u_drop);
  col += alive * (inCol * gPt * trapGain + veinCol * gLn * u_lineW * trapGain * 0.7);
  col += alive * mix(inCol, vec3(1.0), 0.6) * gPt * u_snare * 0.7;
  // Interior body floor: even far from traps the set reads as a solid form.
  col += alive * inCol * 0.22;

  // ---- Kick light ring: a traveling COLOR wave (no displacement). It
  // lights whatever anatomy it passes — the fossil zoom-punch, replaced.
  float front = 0.12 + u_ringAge * 1.3;
  float ring = exp(-pow((rScreen - front) * 6.0, 2.0)) * exp(-u_ringAge * 2.2) * u_ringAmp;
  col += palette(0.3 + front * 0.4) * ring * 0.85;

  // ---- Additive luminance floor BEFORE energy scaling: silence dims the
  // image but can never blank it (fossil failure #2).
  col += extCol * ext * 0.16 + inCol * alive * 0.16;

  // Energy rides ABOVE the floor; buildup dims mildly (bounded).
  col *= 0.74 + 0.42 * u_energy - 0.10 * u_buildup;
  // Kick lift: small, whole-frame, capped (photosafety: ≤ 3 flashes/s comes
  // from the impulse envelope; the lift itself is ≤ 8%).
  col *= 1.0 + 0.08 * u_kick;

  // Chroma-preserving soft knee.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.82) {
    col *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** splitmix32-style scalar hash → stable [0,1). */
function splitmix(n: number): number {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
}

/** C on the pre-verified dense locus. family 0 = just inside the main
 * cardioid (m = 0.985·e^{iθ}, c = m/2 − m²/4); family 1 = period-2 disk
 * (c = −1 + 0.24·e^{iθ}). Connected Julia set by construction. */
function cOnLocus(family: number, theta: number): [number, number] {
  if (family === 1) {
    return [-1 + 0.24 * Math.cos(theta), 0.24 * Math.sin(theta)];
  }
  const mr = 0.985 * Math.cos(theta);
  const mi = 0.985 * Math.sin(theta);
  // c = m/2 − m²/4
  const m2r = mr * mr - mi * mi;
  const m2i = 2 * mr * mi;
  return [mr / 2 - m2r / 4, mi / 2 - m2i / 4];
}

const candidate: VisualizerPreset = {
  id: 'g14-julia-largo',
  name: 'g14 julia-largo',
  hiRes: true,
  params: [
    { id: 'pace', label: 'bar-step size', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'zoom', label: 'framing', min: 0.7, max: 1.6, step: 0.05, default: 1 },
    { id: 'glow', label: 'trap glow', min: 0.4, max: 1.8, step: 0.05, default: 1 },
    { id: 'bands', label: 'exterior bands', min: 0.5, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    // Quantized state: everything below changes ONLY on bar boundaries.
    let lastBar = -1;
    let theta = 0;                       // monotone walk along the locus
    let family = 0;                      // 0 cardioid, 1 period-2 disk
    let bankTarget = 0;
    let rotTarget = 0;
    let trapTarget: [number, number] = [0.18, 0.12];
    // Eased (displayed) state.
    let cNow: [number, number] | null = null;
    let cTarget: [number, number] = cOnLocus(0, 0);
    let rotNow = 0;
    let bankNow = 0;
    let trapNow: [number, number] = [0.18, 0.12];
    // Envelopes.
    let ringAge = 999;
    let ringAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let warm = 0.5;
    let breath = 0;
    let gridlessClock = 0;
    let genomeKey = -1;
    let genome = { theta0: 0, step: 0.07, rotStep: 0.11, zoomBase: 1, lineW: 0.6 };
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0.0001, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        // ---- Genome: stable per dominant trackId.
        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
        }
        const key = dom?.trackId ?? 0;
        if (key !== genomeKey) {
          genomeKey = key;
          genome = {
            theta0: splitmix(key) * Math.PI * 2,
            step: 0.05 + splitmix(key + 1) * 0.06,     // rad per bar, monotone
            rotStep: 0.07 + splitmix(key + 2) * 0.09,  // rad per phrase
            zoomBase: 0.92 + splitmix(key + 3) * 0.2,
            lineW: 0.35 + splitmix(key + 4) * 0.6,
          };
          theta = genome.theta0;
        }

        // ---- Bar clock (ladder-correct; gridless = one step per 2 s).
        let bar: number;
        if (frame.beat) {
          bar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
        } else {
          gridlessClock += dt;
          bar = Math.floor(gridlessClock / 2);
        }
        const pace = frame.params.pace ?? 1;
        if (bar !== lastBar) {
          const isSection = bar % 16 === 0;
          const isPhrase = bar % 4 === 0;
          if (lastBar >= 0) {
            if (isSection) {
              family = 1 - family;
              theta += genome.step * pace * 8;
              bankTarget = (bankTarget + 1) % 4;
            } else if (isPhrase) {
              theta += genome.step * pace * 4;
              rotTarget += genome.rotStep;
            } else {
              theta += genome.step * pace;
            }
          }
          cTarget = cOnLocus(family, theta);
          // Trap point: bar-quantized hash inside the busy annulus.
          const ta = splitmix(bar * 7 + 13) * Math.PI * 2;
          const tr = 0.1 + splitmix(bar * 11 + 5) * 0.4;
          trapTarget = [Math.cos(ta) * tr, Math.sin(ta) * tr];
          lastBar = bar;
        }

        // ---- Easing: one quick legible statement (~0.25 s), then STILL.
        const ease = 1 - Math.exp(-dt / 0.25);
        if (cNow === null) cNow = [...cTarget] as [number, number];
        cNow[0] += (cTarget[0] - cNow[0]) * ease;
        cNow[1] += (cTarget[1] - cNow[1]) * ease;
        rotNow += (rotTarget - rotNow) * ease;
        trapNow[0] += (trapTarget[0] - trapNow[0]) * ease;
        trapNow[1] += (trapTarget[1] - trapNow[1]) * ease;
        bankNow += (bankTarget - bankNow) * (1 - Math.exp(-dt / 0.8));

        // ---- Envelopes (the only continuous motion is LIGHT).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const motion = frame.bandsSlow ?? frame.bands;
        const energyNow = (frame.bands.low + frame.bands.mid + frame.bands.high) / 3;
        const sustained = Math.min(1, energyNow * 1.4);
        warm += (frame.centroid - warm) * (1 - Math.exp(-dt / 1.0));
        // Zoom breath: bandsSlow only, ±2% — framing is essentially fixed.
        breath += ((motion.low - 0.5) * 0.04 - breath) * (1 - Math.exp(-dt / 0.7));
        ringAge += dt;
        if (frame.impulse.low > 0.35 && ringAge > 0.12) {
          ringAge = 0;
          ringAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        // Trap radius: mid breathing, buildup tightens, drop blooms.
        const trapRad =
          (0.16 + 0.1 * motion.mid) * (1 - 0.3 * smoothBuildup) * (1 + 0.4 * smoothDrop);

        return {
          u_c: cNow as [number, number],
          u_rot: rotNow,
          u_trap: trapNow,
          u_trapRad: trapRad,
          u_zoom: genome.zoomBase * (frame.params.zoom ?? 1) * (1 + breath),
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_energy: Math.max(smoothDrop, sustained),
          u_ringAge: ringAge,
          u_ringAmp: ringAmp,
          u_bank: bankNow,
          u_bandGain: frame.params.bands ?? 1,
          u_glow: frame.params.glow ?? 1,
          u_warm: warm,
          u_lineW: genome.lineW,
        };
      },
    });
  },
};

export default candidate;
