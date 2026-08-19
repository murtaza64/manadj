/**
 * "g03 scope-ribbon" (genetic arena, generation 03 — novel): a NOVEL
 * reimagining of the oscilloscope (wantsWave). The live master waveform is
 * a LUMINOUS RIBBON flying through dark space: extruded in fake-3D (a
 * perspective-tapered band with a shaded normal so it reads as a twisting
 * sheet, not a line), colored per-band along its length (red bass → green
 * mid → blue high), leaving GL feedback echo-trails that twist with the
 * mids. Kicks crack the ribbon like a whip (a SOLID displacement wave that
 * travels along it); snares fray it into powder briefly; highs make it
 * shimmer. Meter drives the geometry: the ribbon coils tighter into a loop
 * across each bar, ties a knot-flourish at phrase boundaries, and on
 * sections the camera CUTS to a new angle (a regime jump). Buildups wind
 * tension into tighter coils; drops release into a full-screen whip-crack.
 *
 * Assigned tech: stereo wave (wantsWave) + per-band impulses + energy trend
 * (drop/buildup) + centroid/spread/flatness + beat/bar/phrase/section
 * tiers. frame.wave may be null when the feed doesn't carry it — the ribbon
 * flattens to a resting sine and the scene keeps breathing on band/meter
 * energy alone.
 *
 * Photosensitivity floor (docs/visualizer-ga.md): the drop whip-release is
 * a fullscreen luminance envelope, so it is hard rate-limited to at most
 * one flash per ~0.9 s and its ceiling is capped well under saturated
 * strobing; localized ribbon pulses are exempt.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';
import { ADDITIVE_COLORS } from '../../../waveform/styles';

/** Downsampled waveform resolution handed to GLSL as uniform float[WAVE_N]. */
const WAVE_N = 64;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dt;
uniform float u_energy;
uniform float u_decay;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_centroid;
uniform float u_spread;
uniform float u_flatness;
uniform float u_barPhase;
uniform float u_coil;
uniform float u_knot;
uniform float u_build;
uniform float u_drop;
uniform float u_flash;
uniform float u_camAngle;
uniform float u_camZoom;
uniform float u_whip;
uniform float u_whipPos;
uniform float u_amp;
uniform vec3 u_inkLow;
uniform vec3 u_inkMid;
uniform vec3 u_inkHigh;
uniform float u_wave[64];

const float WAVE_COUNT = 64.0;
const float PI = 3.14159265;

// Constant-loop lookup into the waveform uniform (GLSL ES 1.0 forbids
// dynamic array indexing).
float waveAt(float idx) {
  float v = 0.0;
  for (int k = 0; k < 64; k++) {
    if (float(k) == idx) v = u_wave[k];
  }
  return v;
}

// Smooth sampled waveform amplitude at a fractional position along [0,1].
float sampleWave(float t) {
  float wpos = clamp(t, 0.0, 1.0) * (WAVE_COUNT - 1.0);
  float wi = floor(wpos);
  float wf = wpos - wi;
  return mix(waveAt(wi), waveAt(min(wi + 1.0, WAVE_COUNT - 1.0)), wf);
}

// Per-band ink ramp along the ribbon length (bass red -> mid green ->
// high blue), matching the waveform band identity. Color is free to
// travel; shape carries the band story.
vec3 rampInk(float t) {
  vec3 lo = mix(u_inkLow, u_inkMid, clamp(t * 2.0, 0.0, 1.0));
  vec3 hi = mix(u_inkMid, u_inkHigh, clamp(t * 2.0 - 1.0, 0.0, 1.0));
  return t < 0.5 ? lo : hi;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.13, 289.7))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;

  // --- Camera: a section CUT rotates the whole scene to a new angle
  // (regime jump), and buildups zoom in for tension. Sample the previous
  // frame in this rotated/zoomed space so the echo trails inherit it.
  vec2 c = uv - 0.5;
  c.x *= aspect;
  float ca = cos(u_camAngle);
  float sa = sin(u_camAngle);
  vec2 cam = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca) / u_camZoom;

  // --- Echo trails: advect the previous frame. A gentle downstream drift
  // plus a mid-driven vertical twist (the ribbon's wake), so trails smear
  // like motion blur that curls with the mids.
  float twist = (0.010 + 0.05 * u_mid) * sin(cam.x * 5.0 + u_time * 1.3);
  float drift = 0.006 + 0.02 * u_energy;
  vec2 adv = vec2(-drift, twist * (0.5 + u_build));
  vec2 srcField = c + adv;
  vec2 srcUv = vec2(srcField.x / aspect, srcField.y) + 0.5;
  vec3 col = texture2D(u_prev, srcUv).rgb * u_decay;

  // --- Ribbon geometry in camera space. x runs along the waveform, the
  // ribbon centerline coils with the bar and knots at phrase boundaries.
  float t = clamp(cam.x + 0.5, 0.0, 1.0);

  // Bar coil: the centerline winds into a loop, tighter as the bar
  // progresses and MUCH tighter during buildups (tension-coiling).
  float coilTurns = 1.0 + u_coil * 3.0 + u_build * 4.0;
  float coilPhase = t * coilTurns * 2.0 * PI + u_time * 0.6;
  float coilAmt = 0.10 * u_coil + 0.14 * u_build;
  float centerline = sin(coilPhase) * coilAmt;

  // Phrase knot-flourish: a localized figure-eight cinch travels the
  // ribbon, pinching it into a knot near phrase boundaries.
  float knotX = fract(u_time * 0.25);
  float knotEnv = exp(-pow((t - knotX) * 6.0, 2.0)) * u_knot;
  centerline += sin(coilPhase * 2.0) * 0.12 * knotEnv;

  // Kick whip-crack: a SOLID displacement wave travels along the ribbon
  // from the whip origin — a crisp lateral snap, not powder (kicks are
  // solid responses).
  float whipD = t - u_whipPos;
  float whipPulse = exp(-pow(whipD * 7.0, 2.0)) * u_whip;
  centerline += sign(sin(whipD * 30.0)) * 0.18 * whipPulse
              + sin(whipD * 40.0) * 0.06 * whipPulse;

  // The waveform itself, scaled by amp and lifted by energy.
  float wv = sampleWave(t) * u_amp * (0.7 + 0.6 * u_energy);
  float ribbonY = centerline + wv;

  // --- Fake-3D extrusion: give the ribbon a thickness that tapers with a
  // perspective "depth" swept along its length, and shade a fake normal so
  // it reads as a twisting sheet catching light rather than a flat line.
  float depth = 0.5 + 0.5 * sin(t * 3.5 + u_time * 0.5 + centerline * 3.0);
  float thickness = mix(0.018, 0.055, depth) * (1.0 + 0.6 * u_energy);
  float dY = cam.y - ribbonY;
  float band = exp(-pow(dY / thickness, 2.0));

  // Fake normal shading: top edge brighter, bottom edge in shadow, so the
  // sheet appears to roll. Highs shimmer the specular.
  float normal = clamp(0.5 + dY / (thickness * 2.2), 0.0, 1.0);
  float shade = mix(0.45, 1.0, normal);
  float shimmer = 1.0 + u_hat * (0.4 * sin(t * 90.0 + u_time * 22.0) + 0.4);

  // --- Snare fray: near a snare, break the ribbon into flying powder
  // (mid/high-only particulate), scattered above/below the sheet.
  float fray = 0.0;
  if (u_snare > 0.02) {
    float cell = floor(t * 90.0);
    float sp = hash(vec2(cell, floor(u_time * 30.0)));
    float py = ribbonY + (sp - 0.5) * (0.06 + 0.18 * u_snare);
    float pd = abs(cam.y - py);
    float speck = exp(-pow(pd * 90.0, 2.0));
    float gate = step(0.55, hash(vec2(cell * 1.7, 3.0)));
    fray = speck * gate * u_snare * 1.4;
  }

  // --- Compose the ribbon color: per-band ink along the length, tonal vs
  // noisy material shifts saturation via flatness, spread widens the glow.
  vec3 ink = rampInk(t);
  // Bright bass core when the low band is hot, blue sparkle when highs are.
  ink = mix(ink, vec3(1.0), 0.25 * u_flatness);
  float glowW = thickness * (2.0 + 3.0 * u_spread);
  float glow = exp(-pow(dY / glowW, 2.0)) * 0.5;

  float lum = (band * shade * shimmer) + glow * (0.4 + 0.6 * u_energy);
  vec3 ribbon = ink * lum * (0.9 + 0.8 * u_low);

  // Fray powder colored mid/high (never bass — bass stays solid).
  vec3 frayInk = mix(u_inkMid, u_inkHigh, 0.4 + 0.6 * u_centroid);
  ribbon += frayInk * fray;

  // Kick core flash localized on the ribbon where the whip fires (solid,
  // exempt from the fullscreen limiter).
  ribbon += mix(u_inkLow, vec3(1.0), 0.4) * band * whipPulse * 1.2;

  col += ribbon;

  // --- Drop whip-release: a full-screen luminance bloom, RATE-LIMITED by
  // u_flash (host caps to <=1/0.9s and ceiling below strobe). A soft warm
  // wash biased by the ribbon color travel, not a saturated-red slam.
  vec3 dropCol = mix(u_inkMid, vec3(1.0), 0.6);
  col += dropCol * u_flash * (0.12 + 0.10 * u_drop);

  // --- Chroma-preserving soft knee (silk lineage) — never per-channel clamp.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.8) {
    col *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** 0-1 RGB tuple → GL vec3 uniform triple. */
function inkVec(rgb: readonly [number, number, number]): [number, number, number] {
  return [rgb[0], rgb[1], rgb[2]];
}

const g03ScopeRibbonPreset: VisualizerPreset = {
  id: 'g03-scope-ribbon',
  name: 'g03 scope-ribbon',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'amp', label: 'ribbon height', min: 0.1, max: 0.6, step: 0.02, default: 0.3 },
    { id: 'coil', label: 'bar coil', min: 0, max: 1.5, step: 0.05, default: 1 },
    { id: 'trail', label: 'trail length', min: 0.5, max: 1.4, step: 0.05, default: 1 },
    { id: 'whip', label: 'kick whip', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    const wave = new Float32Array(WAVE_N);

    // Smoothed drop/buildup split (docs: smooth ~0.35 s so regimes don't
    // flip harshly; sustained states ride max(drop, energy)).
    let dropSmooth = 0;
    let buildSmooth = 0;

    // Meter tiers, tracked across frames.
    let lastBarIndex = -1;
    let coilProgress = 0; // 0..1 across a bar
    let knotEnv = 0; // decays after a phrase boundary
    let whipEnv = 0; // decays after a kick
    let whipPos = 0.5; // where the current whip fires along the ribbon

    // Section CUT: camera angle jumps on section boundaries (regime jump).
    let camAngle = 0;
    let camTarget = 0;
    let lastSectionIndex = -1;

    // Fullscreen flash limiter (photosensitivity floor).
    let flashEnv = 0;
    let flashCooldown = 0;

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

        // Downsample the stereo mid waveform; degrade gracefully to a
        // resting sine when the feed carries no wave.
        const w = frame.wave;
        if (w && w.left.length > 0) {
          const src = w.left;
          const other = w.right;
          const n = Math.min(src.length, other.length);
          const step = n / WAVE_N;
          for (let i = 0; i < WAVE_N; i++) {
            const idx = Math.min(n - 1, Math.floor(i * step));
            wave[i] = (src[idx] + other[idx]) * 0.5;
          }
        } else {
          for (let i = 0; i < WAVE_N; i++) {
            wave[i] = Math.sin((i / WAVE_N) * Math.PI * 4 + frame.time * 2) * 0.12;
          }
        }

        // --- Smooth the drop/buildup split (~0.35 s).
        const dropTarget = frame.trend.excitement;
        const buildTarget = frame.trend.slow; // slow rising baseline = winding tension
        const sAlpha = 1 - Math.exp(-dt / 0.35);
        dropSmooth += (dropTarget - dropSmooth) * sAlpha;
        buildSmooth += (buildTarget - buildSmooth) * sAlpha;

        // --- Meter tiers from the beat lock.
        const beat = frame.beat;
        const barPhase = beat ? beat.barPhase : (frame.time * 0.25) % 1;
        const barIndex = beat ? beat.barIndex : Math.floor(frame.time * 0.5);
        coilProgress = barPhase;

        if (barIndex !== lastBarIndex) {
          // Phrase boundary (every 4 bars): tie a knot-flourish.
          if (barIndex % 4 === 0 && lastBarIndex >= 0) {
            knotEnv = 1;
          }
          // Section boundary (every 16 bars): camera CUT to a new angle.
          const sectionIndex = Math.floor(barIndex / 16);
          if (sectionIndex !== lastSectionIndex) {
            lastSectionIndex = sectionIndex;
            // Deterministic-but-varied new angle (regime jump).
            camTarget = ((sectionIndex * 2.399963) % (Math.PI * 2)) - Math.PI;
          }
          lastBarIndex = barIndex;
        }

        // Camera CUT: snap most of the way, then ease (a cut, not a pan).
        camAngle += (camTarget - camAngle) * Math.min(1, dt * 6);
        // Buildup zooms in for tension; drop releases the zoom.
        const camZoom = 1 + buildSmooth * 0.35 - dropSmooth * 0.15;

        knotEnv = Math.max(0, knotEnv - dt / 0.6);

        // --- Kick whip-crack (SOLID; gate on impulse.low so it never
        // reads as kick powder).
        if (kick > 0.28 && kick > whipEnv * 0.9) {
          whipEnv = 1;
          whipPos = 0.1 + Math.random() * 0.8;
        }
        whipEnv = Math.max(0, whipEnv - dt / 0.18);
        const whip = whipEnv * (frame.params.whip ?? 1);

        // --- Drop whip-release fullscreen flash, rate-limited.
        flashCooldown = Math.max(0, flashCooldown - dt);
        // Fire on a strong drop onset when cooldown has expired.
        if (dropSmooth > 0.5 && flashCooldown <= 0) {
          flashEnv = 1;
          flashCooldown = 0.9; // <=1 flash / 0.9 s (photosensitivity floor)
        }
        flashEnv = Math.max(0, flashEnv - dt / 0.4);
        // Ceiling capped well under a saturated strobe.
        const flash = Math.min(0.45, flashEnv * 0.45);

        const trail = frame.params.trail ?? 1;

        return {
          u_time: frame.time,
          u_dt: dt,
          u_energy: energy,
          u_decay: Math.min(0.985, 0.94 + 0.03 * trail - 0.02 * dropSmooth),
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: kick,
          u_snare: snare,
          u_hat: hat,
          u_centroid: frame.centroid,
          u_spread: frame.spread,
          u_flatness: frame.flatness,
          u_barPhase: barPhase,
          u_coil: coilProgress * (frame.params.coil ?? 1),
          u_knot: knotEnv,
          u_build: buildSmooth,
          u_drop: dropSmooth,
          u_flash: flash,
          u_camAngle: camAngle,
          u_camZoom: Math.max(0.6, camZoom),
          u_whip: whip,
          u_whipPos: whipPos,
          u_amp: frame.params.amp ?? 0.3,
          u_inkLow: inkVec(ADDITIVE_COLORS[0]),
          u_inkMid: inkVec(ADDITIVE_COLORS[1]),
          u_inkHigh: inkVec(ADDITIVE_COLORS[2]),
          u_wave: wave,
        };
      },
    });
  },
};

export default g03ScopeRibbonPreset;
