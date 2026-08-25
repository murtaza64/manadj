/**
 * "g04 echo-ink" (genetic arena, generation 04 — TWEAK of g03 echo-field).
 * The delay-line echo field stays, but the CONTRAST HIERARCHY is inverted to
 * kill the human note: 'background rings are too bright to see dots well'.
 *
 *   - REGION FIELD → FAINT GUIDES. The per-band region glow that used to
 *     repaint the whole screen drops to ~12% alpha: it becomes structural
 *     scaffolding you sense but never fight. The persistence trails also run
 *     dimmer so the field never floods.
 *   - ONSET STAMPS → THE STARS. Kicks/snares/hats are now brighter, tighter,
 *     and carry a real GLOW halo (a wide soft bloom under a hot core) so the
 *     ink reads as luminous dots on a quiet field. Energy scales their punch
 *     — restrained when quiet, maximal when the music goes hard.
 *
 * METER (new, per gen-4 directive — more phrase stuff, more meter):
 *   - BEAT-GRID QUANTIZED STAMPS. Snare and hat stamps land ON the beat grid:
 *     their positions snap to slots around a "bar circle" (one slot per beat,
 *     plus fine sub-slots for hats), so the dots trace the meter instead of
 *     scattering randomly. Kick blooms at the circle center (the downbeat
 *     anchor), nudged onto the current beat's spoke.
 *   - BAR WIPER (kept from g03, brighter) sweeps the field each bar.
 *   - PHRASE BOUNDARY (every 4 bars) = FULL-FIELD WIPER + REGION RE-SEED:
 *     a bright expanding ring flashes across the whole screen (rate-limited,
 *     photosensitivity floor) AND the region layout jumps to a new mapping —
 *     a scene-scale re-seed of which band owns which territory.
 *   - 16-bar SECTIONS still add a larger layout rotation on top.
 *
 * Assigned tech: 24-band spectrum + per-band impulses (kick/snare/hat) +
 * full metric ladder (barPhase / barIndex → beats, bars, phrases, sections).
 * Feedback-based; degrades gracefully with no grid (synthetic bass-driven bar
 * phase keeps the wiper, quantize grid, phrase re-seed, and rotation alive).
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
  'uniform float u_stamp;',      // stamp glow strength (param)
  'uniform float u_layout;',     // section rotation angle (radians)
  'uniform float u_barPhase;',   // 0..1 across the bar (wiper position)
  'uniform float u_barLit;',     // 0..1 wiper brightness envelope
  'uniform float u_phrase;',     // 0..1 phrase-wiper radius (0 = idle)
  'uniform float u_phraseLit;',  // 0..1 phrase-wiper brightness envelope
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
  '// A luminous stamp: a hot tight core wrapped in a wide soft glow halo, so',
  '// the ink reads as a glowing star, not a flat blob. d = distance to stamp.',
  'float glowStamp(float d, float coreK, float haloK) {',
  '  float core = exp(-pow(d * coreK, 2.0));',
  '  float halo = exp(-pow(d * haloK, 2.0));',
  '  return core * 1.35 + halo * 0.5;',
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
  '  // persistence (long echo), quiet band = fast fade. Trails run a touch',
  '  // dimmer than g03 so the field stays a quiet stage for the stamps.',
  '  float bin = bandOf(field);',
  '  float bandE = specAt(bin);',
  '  float persist = u_persist + (0.975 - u_persist) * clamp(bandE * 1.6, 0.0, 1.0);',
  '  persist = clamp(persist, 0.78, 0.986);',
  '',
  '  // --- RGB delay: sample each channel of the previous frame at a slightly',
  '  // different offset so persisting light smears into chromatic echoes.',
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
  '  // --- CONTRAST FIX: the region no longer floods the screen. It is a',
  '  // FAINT GUIDE (~12% alpha) — structural scaffolding you sense but that',
  '  // never competes with the stamps. Rides energy so it wakes on drops.',
  '  vec3 field_ink = bandColor(bin) * bandE * (0.05 + 0.07 * u_energy);',
  '  echo += field_ink;',
  '',
  '  // --- Kick: BIG glowing central bloom (low-ink), a shockwave ring around',
  '  // it. Now brighter and with a wider glow halo — the core pump as a star.',
  '  vec2 kf = toField(u_kickPos);',
  '  float kr = length(field - kf);',
  '  float kcore = glowStamp(kr, 3.0, 1.4);',
  '  float ring = exp(-pow((kr - 0.14 - 0.10 * u_kick) * 9.0, 2.0));',
  '  vec3 kickInk = mix(u_inkLow, vec3(1.0), 0.35);',
  '  echo += kickInk * u_kick * (kcore * 1.9 + ring * 0.8) * u_stamp;',
  '',
  '  // --- Snare: mid-field GLOWING band-colored dots (grid-quantized).',
  '  float snStroke = 0.0;',
  '  snStroke += glowStamp(length(field - toField(u_snareA)), 24.0, 9.0);',
  '  snStroke += glowStamp(length(field - toField(u_snareB)), 28.0, 10.0);',
  '  echo += mix(u_inkMid, vec3(1.0), 0.15) * u_snare * snStroke * 1.7 * u_stamp;',
  '',
  '  // --- Hats: fine GLOWING peripheral specks (grid-quantized, out near rim).',
  '  float rim = smoothstep(0.24, 0.5, r);',
  '  float hat = 0.0;',
  '  hat += glowStamp(length(field - toField(u_hatA)), 60.0, 24.0);',
  '  hat += glowStamp(length(field - toField(u_hatB)), 70.0, 26.0);',
  '  hat += glowStamp(length(field - toField(u_hatC)), 65.0, 25.0);',
  '  echo += mix(u_inkHigh, vec3(1.0), 0.2) * u_hat * hat * rim * 1.8 * u_stamp;',
  '',
  '  // --- Bar wiper: a clean sweep line at the bar phase angle, brightening',
  '  // whatever band territory it crosses. Fades across the bar (u_barLit).',
  '  float sweepAng = u_barPhase * 2.0 * PI - PI;',
  '  vec2 sweepDir = vec2(cos(sweepAng), sin(sweepAng));',
  '  float along = dot(field, sweepDir);',
  '  float across = dot(field, vec2(-sweepDir.y, sweepDir.x));',
  '  float wiper = exp(-pow(across * 26.0, 2.0)) * step(0.0, along);',
  '  echo += bandColor(bin) * wiper * u_barLit * (0.25 + 0.5 * bandE) * 1.1;',
  '',
  '  // --- Phrase wiper: on a phrase boundary a bright ring expands from center',
  '  // across the whole field, a scene-scale reset stroke. u_phrase is the ring',
  '  // radius (0..~1), u_phraseLit its (rate-limited) brightness envelope.',
  '  float pRing = exp(-pow((r - u_phrase) * 7.0, 2.0));',
  '  vec3 phraseInk = mix(bandColor(bin), vec3(1.0), 0.4);',
  '  echo += phraseInk * pRing * u_phraseLit * 0.8;',
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

/** A point snapped to a beat-grid slot on a ring around center, in 0..1 uv
 * space. `slot`/`slots` pick the spoke; `jitterSlot` adds fine sub-slots so
 * co-located hats don't perfectly overlap; radius jitters within [rMin,rMax]. */
function gridPoint(
  slot: number,
  slots: number,
  jitterSlot: number,
  jitterSlots: number,
  rMin: number,
  rMax: number
): [number, number] {
  const base = (slot / slots) * Math.PI * 2 - Math.PI / 2;
  const fine = (jitterSlot / (slots * jitterSlots)) * Math.PI * 2;
  const a = base + fine;
  const rr = rMin + Math.random() * (rMax - rMin);
  return [0.5 + Math.cos(a) * rr, 0.5 + Math.sin(a) * rr];
}

const g04EchoInkPreset: VisualizerPreset = {
  id: 'g04-echo-ink',
  name: 'g04 echo-ink',
  hiRes: true,
  params: [
    { id: 'persist', label: 'base persistence', min: 0.75, max: 0.95, step: 0.01, default: 0.85 },
    { id: 'chroma', label: 'rgb echo', min: 0, max: 2.5, step: 0.05, default: 1.1 },
    { id: 'stamp', label: 'stamp glow', min: 0.5, max: 2.5, step: 0.05, default: 1.4 },
    { id: 'sweep', label: 'wiper strength', min: 0, max: 1.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    const spectrum = new Float32Array(SPECTRUM_N);

    // Section layout angle, eased toward a target that jumps on phrase (4-bar)
    // re-seeds and 16-bar section boundaries.
    let layoutAngle = 0;
    let layoutTarget = 0;
    let prevBarIndex: number | null = null;

    // Gridless free-run bar phase (bass-driven) when no beat grid.
    let freeBar = 0;

    // Phrase-wiper envelope: fires on a phrase boundary, expands + fades. Rate
    // limited (min interval) so it can never strobe (photosensitivity floor).
    let phraseAge = 999; // seconds since the last phrase wipe (large = idle)
    let lastPhraseFire = -999;

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

        // --- Metric ladder: bar phase drives the wiper; barIndex → beats,
        // bars, phrases (4-bar), sections (16-bar). Free-run when no grid.
        const beat = frame.beat;
        let barPhase: number;
        let barIndex: number;
        let beatsPerBar: number;
        if (beat && beat.bpm) {
          barPhase = beat.barPhase;
          barIndex = beat.barIndex;
          beatsPerBar = beat.beatsPerBar || 4;
        } else {
          const bpm = beat?.bpm ?? 120;
          beatsPerBar = beat?.beatsPerBar ?? 4;
          const barsPerSec = bpm / 60 / beatsPerBar;
          freeBar += dt * barsPerSec * (0.6 + 0.8 * energy);
          barPhase = mod(freeBar, 1);
          barIndex = Math.floor(freeBar);
        }

        // Current beat index within the bar (the grid slot a stamp snaps to).
        const beatSlot = Math.floor(barPhase * beatsPerBar);

        // Phrase (every 4 bars) and section (every 16 bars) boundaries fire on
        // a barIndex change. Phrase → full-field wiper + region re-seed;
        // section → a larger layout rotation on top.
        if (prevBarIndex !== null && barIndex !== prevBarIndex) {
          if (mod(barIndex, 4) === 0) {
            // Phrase re-seed: jump the region layout to a fresh mapping, and
            // arm the phrase wiper (rate-limited so it can't strobe).
            layoutTarget += Math.PI * (0.25 + Math.random() * 0.35);
            if (frame.time - lastPhraseFire > 0.9) {
              phraseAge = 0;
              lastPhraseFire = frame.time;
            }
          }
          if (mod(barIndex, 16) === 0) {
            layoutTarget += Math.PI * (0.4 + Math.random() * 0.6);
          }
        }
        prevBarIndex = barIndex;
        // Ease toward the target so the re-map glides (dramatic but not a jump).
        layoutAngle += (layoutTarget - layoutAngle) * Math.min(1, dt * 2.2);

        // Advance + shape the phrase wiper: radius expands over ~0.7 s,
        // brightness a single soft pulse (never a repeated flash → safe).
        phraseAge += dt;
        const phrase = Math.min(1.1, phraseAge / 0.7);
        const phraseLit = phraseAge < 0.7 ? Math.pow(1 - phraseAge / 0.7, 1.3) : 0;

        // Wiper brightness: brightest right at the downbeat, fading across the
        // bar. Multiplied by the sweep param.
        const sweepParam = frame.params.sweep ?? 1;
        const barLit = Math.pow(1 - barPhase, 1.5) * sweepParam;

        // Energy scales stamp punch: restrained when quiet, maximal when hard.
        const stampParam = (frame.params.stamp ?? 1.4) * (0.7 + 0.6 * energy);

        // --- Onset stamps: re-roll a stamp's position only on a fresh hit,
        // snapping to beat-grid slots around the bar circle so the dots trace
        // the meter (quantized positions) instead of scattering.
        if (kick > 0.28 && kick > lastKick + 0.05) {
          // Kick sits near center, nudged onto the current beat's spoke.
          const p = gridPoint(beatSlot, beatsPerBar, 0, 1, 0.0, 0.07);
          kickPos[0] = p[0];
          kickPos[1] = p[1];
        }
        lastKick = kick;

        if (snare > 0.25 && snare > lastSnare + 0.05) {
          // Snares on the beat spoke (+ its opposite), mid ring.
          const a = gridPoint(beatSlot, beatsPerBar, 0, 1, 0.16, 0.3);
          const b = gridPoint(beatSlot + Math.floor(beatsPerBar / 2), beatsPerBar, 0, 1, 0.16, 0.3);
          snareA[0] = a[0]; snareA[1] = a[1];
          snareB[0] = b[0]; snareB[1] = b[1];
        }
        lastSnare = snare;

        if (hat > 0.22 && hat > lastHat + 0.04) {
          // Hats on fine sub-slots around the beat spoke, out near the rim.
          const sub = Math.floor(barPhase * beatsPerBar * 4);
          const a = gridPoint(sub, beatsPerBar * 4, 0, 1, 0.34, 0.5);
          const b = gridPoint(sub + 1, beatsPerBar * 4, 0, 1, 0.34, 0.5);
          const c = gridPoint(sub + 2, beatsPerBar * 4, 0, 1, 0.34, 0.5);
          hatA[0] = a[0]; hatA[1] = a[1];
          hatB[0] = b[0]; hatB[1] = b[1];
          hatC[0] = c[0]; hatC[1] = c[1];
        }
        lastHat = hat;

        return {
          u_time: frame.time,
          u_dt: dt,
          u_energy: energy,
          u_persist: frame.params.persist ?? 0.85,
          u_chroma: frame.params.chroma ?? 1.1,
          u_stamp: stampParam,
          u_layout: layoutAngle,
          u_barPhase: barPhase,
          u_barLit: barLit,
          u_phrase: phrase,
          u_phraseLit: phraseLit,
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

export default g04EchoInkPreset;
