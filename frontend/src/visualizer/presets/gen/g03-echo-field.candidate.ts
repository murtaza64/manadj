/**
 * "g03 echo-field" (genetic arena, generation 03 — novel, Delay-Line Echo
 * Field from the VJ effect-vocabulary research). A feedback field where
 * DECAY IS SPATIAL AND SPECTRAL: the screen is partitioned into radial
 * regions (center = lows, outward = highs) each bound to one of the 24
 * spectrum bins. Every region's feedback persistence RIDES its band's
 * energy — a loud band's territory holds its trail long, a quiet band's
 * fades fast — so the spectrum literally paints its own decaying portrait.
 *
 * RGB DELAY: the feedback tap samples the three channels at slightly
 * different offsets (per-channel advection), so persisting light smears
 * into chromatic echoes rather than a flat afterglow.
 *
 * FRESH STAMPS on onsets, band-colored: a kick drops a BIG solid central
 * bloom; snares spatter mid-field strokes; hats flick fine peripheral
 * specks. METER: the bar boundary sweeps a clean 'wiper' line across the
 * field, brightening what it crosses; 16-bar SECTIONS rotate the whole
 * region layout (a scene-scale re-map of which band owns which territory).
 *
 * Assigned tech: 24-band spectrum (u_spectrum[24]) + per-band impulses
 * (kick/snare/hat) + full metric ladder (barPhase / barIndex sections).
 * Feedback-based; degrades gracefully with no grid (a synthetic bar phase
 * advanced by bass energy keeps the wiper and section rotation alive).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';
import { ADDITIVE_COLORS } from '../../../waveform/styles';

/** The spectrum feed is 24 geometric bands (channel.SPECTRUM_BAND_COUNT);
 * the brief pins the uniform + typed-array length to EXACTLY 24. */
const SPECTRUM_N = 24;

/** GLSL ES 1.0 fragment source, assembled without backticks so no template
 * literal ever lives inside the shader string (brief rule). */
const FRAGMENT = [
  'precision highp float;',
  'uniform sampler2D u_prev;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform float u_dt;',
  'uniform float u_energy;',
  'uniform float u_persist;',    // base trail floor (param)
  'uniform float u_chroma;',     // RGB-delay strength (param)
  'uniform float u_layout;',     // section rotation angle (radians)
  'uniform float u_barPhase;',   // 0..1 across the bar (wiper position)
  'uniform float u_barLit;',     // 0..1 wiper brightness envelope
  'uniform float u_kick;',       // impulse.low
  'uniform float u_snare;',      // impulse.mid
  'uniform float u_hat;',        // impulse.high
  'uniform float u_low;',
  'uniform float u_mid;',
  'uniform float u_high;',
  'uniform vec2 u_kickPos;',
  'uniform vec2 u_snareA;',
  'uniform vec2 u_snareB;',
  'uniform vec2 u_hatA;',
  'uniform vec2 u_hatB;',
  'uniform vec2 u_hatC;',
  'uniform vec3 u_inkLow;',
  'uniform vec3 u_inkMid;',
  'uniform vec3 u_inkHigh;',
  'uniform float u_spectrum[24];',
  '',
  'const float SPEC_N = 24.0;',
  'const float PI = 3.14159265;',
  '',
  '// Constant-loop lookup (GLSL ES 1.0 forbids dynamic array indexing).',
  'float specAt(float idx) {',
  '  float v = 0.0;',
  '  for (int k = 0; k < 24; k++) {',
  '    if (float(k) == idx) v = u_spectrum[k];',
  '  }',
  '  return v;',
  '}',
  '',
  '// Aspect-corrected vector from center so regions stay round on a wide',
  '// canvas.',
  'vec2 toField(vec2 uv) {',
  '  vec2 c = uv - 0.5;',
  '  c.x *= u_res.x / u_res.y;',
  '  return c;',
  '}',
  '',
  '// Which spectrum bin owns this point: radius picks the band (low center,',
  '// high edge); the section layout angle rotates the mapping so a spiral',
  '// of angle nudges the assignment — a scene-scale re-map on sections.',
  'float bandOf(vec2 field) {',
  '  float r = length(field);',
  '  float ang = atan(field.y, field.x) + u_layout;',
  '  // Radial base + a gentle angular spiral so territories interleave.',
  '  float t = clamp(r * 1.7 + 0.06 * sin(ang * 3.0 + r * 8.0), 0.0, 0.999);',
  '  return floor(t * SPEC_N);',
  '}',
  '',
  '// Band color: lows red, mids green, highs blue, blended across the run.',
  'vec3 bandColor(float bin) {',
  '  float f = bin / (SPEC_N - 1.0);',
  '  if (f < 0.5) return mix(u_inkLow, u_inkMid, f * 2.0);',
  '  return mix(u_inkMid, u_inkHigh, (f - 0.5) * 2.0);',
  '}',
  '',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  '  float aspect = u_res.x / u_res.y;',
  '  vec2 field = toField(uv);',
  '  float r = length(field);',
  '',
  '  // --- Spatial + spectral decay. This point sits in a band region; that',
  '  // band energy sets how long its trail persists. Loud band = near-1',
  '  // persistence (long echo), quiet band = fast fade.',
  '  float bin = bandOf(field);',
  '  float bandE = specAt(bin);',
  '  float persist = u_persist + (0.985 - u_persist) * clamp(bandE * 1.6, 0.0, 1.0);',
  '  persist = clamp(persist, 0.80, 0.992);',
  '',
  '  // --- RGB delay: sample each channel of the previous frame at a slightly',
  '  // different offset so persisting light smears into chromatic echoes.',
  '  // Offset rides band energy + the global chroma param.',
  '  vec2 dir = field / (r + 1e-4);',
  '  float amt = u_chroma * (0.0015 + 0.004 * bandE);',
  '  vec2 offR = dir * amt;',
  '  vec2 offB = -dir * amt;',
  '  vec2 srcR = vec2((field - offR).x / aspect, (field - offR).y) + 0.5;',
  '  vec2 srcG = uv;',
  '  vec2 srcB = vec2((field - offB).x / aspect, (field - offB).y) + 0.5;',
  '  vec3 echo;',
  '  echo.r = texture2D(u_prev, srcR).r;',
  '  echo.g = texture2D(u_prev, srcG).g;',
  '  echo.b = texture2D(u_prev, srcB).b;',
  '  echo *= persist;',
  '',
  '  // --- The region gently glows with its own live band energy, tinted by',
  '  // its band color: the spectrum keeps repainting its portrait.',
  '  vec3 field_ink = bandColor(bin) * bandE * (0.10 + 0.25 * u_energy);',
  '  echo += field_ink;',
  '',
  '  // --- Kick: BIG solid central bloom (low-ink), a shockwave ring around',
  '  // it. Solid, central, unmistakable — the core pump.',
  '  vec2 kf = toField(u_kickPos);',
  '  float kr = length(field - kf);',
  '  float core = exp(-pow(kr * 3.2, 2.0));',
  '  float ring = exp(-pow((kr - 0.14 - 0.10 * u_kick) * 9.0, 2.0));',
  '  vec3 kickInk = mix(u_inkLow, vec3(1.0), 0.25);',
  '  echo += kickInk * u_kick * (core * 1.6 + ring * 0.7);',
  '',
  '  // --- Snare: mid-field band-colored strokes (a couple of tight lobes).',
  '  vec2 saf = toField(u_snareA);',
  '  vec2 sbf = toField(u_snareB);',
  '  float snStroke = 0.0;',
  '  snStroke += exp(-pow(length(field - saf) * 22.0, 2.0));',
  '  snStroke += exp(-pow(length(field - sbf) * 26.0, 2.0));',
  '  echo += mix(u_inkMid, u_inkHigh, 0.35) * u_snare * snStroke * 1.3;',
  '',
  '  // --- Hats: fine peripheral specks (only out near the rim).',
  '  float rim = smoothstep(0.28, 0.55, r);',
  '  vec2 haf = toField(u_hatA);',
  '  vec2 hbf = toField(u_hatB);',
  '  vec2 hcf = toField(u_hatC);',
  '  float hat = 0.0;',
  '  hat += exp(-pow(length(field - haf) * 70.0, 2.0));',
  '  hat += exp(-pow(length(field - hbf) * 80.0, 2.0));',
  '  hat += exp(-pow(length(field - hcf) * 75.0, 2.0));',
  '  echo += u_inkHigh * u_hat * hat * rim * 1.4;',
  '',
  '  // --- Bar wiper: a clean sweep line at the bar phase angle, brightening',
  '  // whatever band territory it crosses. Fades across the bar (u_barLit).',
  '  float sweepAng = u_barPhase * 2.0 * PI - PI;',
  '  vec2 sweepDir = vec2(cos(sweepAng), sin(sweepAng));',
  '  float along = dot(field, sweepDir);',
  '  float across = dot(field, vec2(-sweepDir.y, sweepDir.x));',
  '  float wiper = exp(-pow(across * 26.0, 2.0)) * step(0.0, along);',
  '  echo += bandColor(bin) * wiper * u_barLit * (0.25 + 0.5 * bandE) * 1.2;',
  '',
  '  // --- Chroma-preserving soft knee (never per-channel clamp): squash the',
  '  // brightest channel toward 1 while holding the color ratio.',
  '  float m = max(echo.r, max(echo.g, echo.b));',
  '  if (m > 0.82) {',
  '    echo *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;',
  '  }',
  '  gl_FragColor = vec4(echo, 1.0);',
  '}',
].join('\n');

/** 0-1 RGB tuple → GL vec3 uniform triple. */
function inkVec(rgb: readonly [number, number, number]): [number, number, number] {
  return [rgb[0], rgb[1], rgb[2]];
}

/** ((x % n) + n) % n — barIndex can be negative before the first downbeat. */
function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/** Random point on a ring [rMin, rMax] around center, in 0..1 uv space. */
function ringPoint(rMin: number, rMax: number): [number, number] {
  const a = Math.random() * Math.PI * 2;
  const rr = rMin + Math.random() * (rMax - rMin);
  return [0.5 + Math.cos(a) * rr, 0.5 + Math.sin(a) * rr];
}

const g03EchoFieldPreset: VisualizerPreset = {
  id: 'g03-echo-field',
  name: 'g03 echo-field',
  hiRes: true,
  params: [
    { id: 'persist', label: 'base persistence', min: 0.75, max: 0.95, step: 0.01, default: 0.86 },
    { id: 'chroma', label: 'rgb echo', min: 0, max: 2.5, step: 0.05, default: 1.1 },
    { id: 'sweep', label: 'wiper strength', min: 0, max: 1.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    const spectrum = new Float32Array(SPECTRUM_N);

    // Section layout angle, eased toward a target that jumps on 16-bar
    // section boundaries.
    let layoutAngle = 0;
    let layoutTarget = 0;
    let prevBarIndex: number | null = null;

    // Gridless free-run bar phase (bass-driven) when no beat grid.
    let freeBar = 0;

    // Onset stamp positions (kept between frames; only re-rolled on a fresh
    // transient so a stamp stays put while it decays).
    const kickPos: [number, number] = [0.5, 0.5];
    const snareA: [number, number] = [0.5, 0.5];
    const snareB: [number, number] = [0.5, 0.5];
    const hatA: [number, number] = [0.5, 0.5];
    const hatB: [number, number] = [0.5, 0.5];
    const hatC: [number, number] = [0.5, 0.5];
    let lastKick = 0;
    let lastSnare = 0;
    let lastHat = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const energy = energyOf(frame.bands);
        const kick = frame.impulse.low;
        const snare = frame.impulse.mid;
        const hat = frame.impulse.high;

        // Copy the 24-band spectrum into the fixed-length array (pad/truncate
        // defensively — the feed is SPECTRUM_BAND_COUNT === 24).
        const src = frame.spectrum;
        for (let i = 0; i < SPECTRUM_N; i++) spectrum[i] = src[i] ?? 0;

        // --- Metric ladder: bar phase drives the wiper; barIndex sections
        // rotate the layout. Free-run when no grid.
        const beat = frame.beat;
        let barPhase: number;
        let barIndex: number;
        if (beat && beat.bpm) {
          barPhase = beat.barPhase;
          barIndex = beat.barIndex;
        } else {
          const bpm = beat?.bpm ?? 120;
          const beatsPerBar = beat?.beatsPerBar ?? 4;
          const barsPerSec = bpm / 60 / beatsPerBar;
          freeBar += dt * barsPerSec * (0.6 + 0.8 * energy);
          barPhase = mod(freeBar, 1);
          barIndex = Math.floor(freeBar);
        }

        // Section boundary (every 16 bars): jump the layout target.
        if (prevBarIndex !== null && barIndex !== prevBarIndex) {
          if (mod(barIndex, 16) === 0) {
            layoutTarget += Math.PI * (0.4 + Math.random() * 0.6);
          }
        }
        prevBarIndex = barIndex;
        // Ease toward the target so the re-map glides (dramatic but not a jump).
        layoutAngle += (layoutTarget - layoutAngle) * Math.min(1, dt * 2.2);

        // Wiper brightness: brightest right at the downbeat, fading across the
        // bar. Multiplied by the sweep param.
        const barLit = Math.pow(1 - barPhase, 1.5) * (frame.params.sweep ?? 1);

        // --- Onset stamps: re-roll a stamp's position only on a fresh hit.
        if (kick > 0.28 && kick > lastKick + 0.05) {
          const p = ringPoint(0, 0.1);
          kickPos[0] = p[0];
          kickPos[1] = p[1];
        }
        lastKick = kick;

        if (snare > 0.25 && snare > lastSnare + 0.05) {
          const a = ringPoint(0.14, 0.3);
          const b = ringPoint(0.14, 0.3);
          snareA[0] = a[0]; snareA[1] = a[1];
          snareB[0] = b[0]; snareB[1] = b[1];
        }
        lastSnare = snare;

        if (hat > 0.22 && hat > lastHat + 0.04) {
          const a = ringPoint(0.34, 0.5);
          const b = ringPoint(0.34, 0.5);
          const c = ringPoint(0.34, 0.5);
          hatA[0] = a[0]; hatA[1] = a[1];
          hatB[0] = b[0]; hatB[1] = b[1];
          hatC[0] = c[0]; hatC[1] = c[1];
        }
        lastHat = hat;

        return {
          u_time: frame.time,
          u_dt: dt,
          u_energy: energy,
          u_persist: frame.params.persist ?? 0.86,
          u_chroma: frame.params.chroma ?? 1.1,
          u_layout: layoutAngle,
          u_barPhase: barPhase,
          u_barLit: barLit,
          u_kick: kick,
          u_snare: snare,
          u_hat: hat,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kickPos: kickPos,
          u_snareA: snareA,
          u_snareB: snareB,
          u_hatA: hatA,
          u_hatB: hatB,
          u_hatC: hatC,
          u_inkLow: inkVec(ADDITIVE_COLORS[0]),
          u_inkMid: inkVec(ADDITIVE_COLORS[1]),
          u_inkHigh: inkVec(ADDITIVE_COLORS[2]),
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g03EchoFieldPreset;
