/**
 * g12-voyage-menagerie (gen-12 DUST DIVERSITY, tweak of the g00-voyage engine).
 *
 * Dust is BACK by explicit human request ("new types of dust", "hope to see
 * more variations on the dust") — but DIVERSIFIED. The voyage skeleton keeps
 * its ripple / horizon-ring / lens core; the old monochrome interference disk
 * wash is REPLACED by THREE DISTINCT DUST SPECIES, one per band, each its own
 * creature (size, motion, hue all different, identifiable at a glance):
 *
 *  - LOWS = CINDERS. Sparse, LARGE, heavy glowing motes that arc
 *    ballistically and fall slowly (per-cell gravity), IGNITING when the kick
 *    ripple wavefront passes them. Warm palette slice (ember/orange).
 *  - MIDS = SILK STREAMERS. Ribbon-like threads (elongated, smooth — NOT
 *    points) advected along the flow, breathing with bandsSlow.mid. Palette
 *    mid slice.
 *  - HIGHS = GLASS MIDGES. Tiny darting specks that change direction quickly
 *    (per-cell jitter clock), appearing only with high content. Cool palette
 *    slice (+0.35 phase).
 *
 * Kick ripple interacts per species: cinders ignite, streamers whip sideways,
 * midges scatter. Drop = all three at maximum population riding
 * max(drop, energy). EQ kill (dominant deck knob -> 0) removes that species.
 *
 * Engine idioms reused: unsharp feedback tap, chroma-preserving soft knee,
 * per-axis seed mixing, traveling kick ripple that LIGHTS what it passes,
 * charged horizon ring, localized lens swirl, u_specHue spectral-hue bias.
 * Motion smoothness: travel/rotation/streamer-flow rates ride the slow bands
 * (u_lowSlow/u_midSlow/u_highSlow); instantaneous bands/impulse drive only
 * brightness, ignition punches, and spawns. Feedback contraction respected
 * (decay < 1, drama in the (1-decay) fresh term). Photosensitivity floor
 * respected (no saturated-red full-field strobe; species are localized).
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

// DUST FIX v3: deterministic per-track hue anchor. Bit-mix folded to [0,1) so
// different track ids land on genuinely different hues.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;      // motion-grade low (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;      // motion-grade mid: streamer flow rate
uniform float u_high;
uniform float u_highSlow;     // motion-grade high: midge dart rate
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;     // harmonic content: palette phase
uniform float u_specHue;      // slow-tracked centroid (~1s EMA): species hue bias
uniform float u_drop;         // excitement WITH bass
uniform float u_buildup;      // excitement WITHOUT bass
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;    // seconds since the last strong kick
uniform float u_rippleAmp;    // that kick's captured strength
uniform float u_sustain;      // sustained loudness
uniform float u_armPhase;     // spiral-arm drift, BPM-locked when gridded
uniform float u_dust;         // overall dust gain slider
uniform float u_palette;      // palette blend 0..3
uniform float u_charge;       // bass-ring charge
uniform float u_spawnSnare;   // snare-driven burst gain
uniform float u_cinders;      // LOW species population (EQ-gated)
uniform float u_streamers;    // MID species population (EQ-gated)
uniform float u_midges;       // HIGH species population (EQ-gated)
uniform float u_hueRot;       // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};

// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in TURNS;
// luminance (Y) untouched so gains are unchanged. Negatives clamped.
vec3 hueRotate(vec3 c, float rot) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float i = dot(c, vec3(0.596, -0.274, -0.322));
  float q = dot(c, vec3(0.211, -0.523, 0.312));
  float h = atan(q, i) + rot * 6.28318;
  float chroma = sqrt(i * i + q * q);
  i = chroma * cos(h);
  q = chroma * sin(h);
  return max(vec3(0.0), vec3(
    y + 0.956 * i + 0.621 * q,
    y - 0.272 * i - 0.647 * q,
    y - 1.106 * i - 1.703 * q
  ));
}

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

// iq cosine palette: deep-space families that TRAVEL.
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

// ---- Species hues: DISTINCT palette slices, each spectral-hue biased so
// they still TRAVEL as a family but never collapse onto one another.
// DUST FIX v3: each species is offset by u_hueRot (per-song sweep) — their
// distinct base slices (0.03/0.4/0.72) are preserved so they stay mutually
// distinct, but the whole family lands on a genuinely different anchor per song.
vec3 cinderHue() { return hueRotate(palette(0.03 + u_specHue * 0.4 + u_time * 0.01), u_hueRot); }         // warm
vec3 streamerHue() { return hueRotate(palette(0.4 + u_specHue * 0.4 + u_time * 0.02), u_hueRot); }        // mid
vec3 midgeHue() { return hueRotate(mix(palette(0.72 + u_specHue * 0.4), vec3(0.55, 0.85, 1.0), 0.5), u_hueRot); } // cool

// ---- SPECIES 1: CINDERS (LOWS). Sparse LARGE motes on a coarse lattice;
// each cell launches a mote that arcs and falls (gravity), re-seeded each
// lifetime. Ignites (brightens + swells) when the kick ripple crosses it.
vec3 cinders(vec2 c, float rippleWave) {
  vec3 col = vec3(0.0);
  float density = 5.5;                       // coarse -> sparse & large
  vec2 q = c * density;
  vec2 base = floor(q);
  // 3x3 neighborhood so a falling mote crossing a cell boundary stays whole.
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cell = base + vec2(float(ox), float(oy));
      vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
      // Sparse: only a fraction of cells host a cinder (population-gated).
      float live = step(0.62 - 0.25 * u_cinders, hash(sc * 1.61 + 3.3));
      // Per-cell lifetime clock: launch, arc, fall, recycle.
      float period = 2.4 + 2.6 * hash(sc.yx + 5.1);
      float birth = hash(sc + 9.9) * period;
      float age = mod(u_time + birth, period);
      float life = age / period;
      // Ballistic arc: launch up with slight lateral drift, gravity pulls down.
      vec2 launch = vec2((hash(sc + 2.1) - 0.5) * 0.5, 0.5 + 0.4 * hash(sc.yx + 6.6));
      float grav = 0.9;
      vec2 pos0 = vec2(hash(sc + 1.3), hash(sc.yx + 4.7));
      vec2 pos = pos0 + launch * age - vec2(0.0, 0.5 * grav * age * age);
      vec2 f = (fract(q) - fract(pos * density)) ;
      // wrap fractional target into the local cell
      vec2 target = pos * density - cell;
      f = (q - base) - target;
      float d2 = dot(f, f);
      // LARGE soft mote + tiny hot core.
      float size = 0.16 + 0.12 * hash(sc + 17.9);
      float body = exp(-d2 / (size * size));
      float coreHot = exp(-d2 / (size * size * 0.18));
      // Fade in/out across the lifetime (born bright, cools as it falls).
      float envlp = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life));
      // Ignition: the kick ripple passing this mote flares it.
      float ignite = 1.0 + 3.0 * rippleWave;
      float bright = (0.35 + 0.65 * u_low) * ignite;
      vec3 hue = mix(cinderHue(), vec3(1.0, 0.85, 0.6), 0.35 * u_kick + 0.4 * rippleWave);
      col += hue * (body + coreHot * 0.8) * envlp * live * bright;
    }
  }
  return col * u_cinders;
}

// ---- SPECIES 2: SILK STREAMERS (MIDS). Ribbon-like threads: a low-freq
// warped sine field carved into thin smooth bands that flow along the disk
// and breathe with the (slow) mid band. NOT points.
vec3 streamers(vec2 c, float r, float ang, float reverb) {
  // Advection phase rides the SLOW mid (motion smoothness) + arm drift.
  float flow = u_time * (0.15 + 0.7 * u_midSlow) + u_armPhase * 0.5;
  // Warp the angle by a slow noise so ribbons undulate like silk.
  float warp = fbm(vec2(ang * 1.6 + r * 2.0 - flow, r * 3.0 + flow * 0.4));
  // Several thin ribbons at different angular frequencies.
  float ribbon = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float freq = 5.0 + fi * 4.0;
    float band = sin(ang * freq + warp * 6.28318 + flow * (1.0 + fi * 0.3) + fi * 2.1);
    // Thin, smooth ribbon: high power on a near-zero crossing.
    ribbon += pow(max(0.0, 1.0 - abs(band)), 26.0 - 6.0 * fi);
  }
  // Confine to the disk annulus; breathe width with the slow mid.
  float annulus = smoothstep(0.1, 0.28, r) * exp(-r * 1.6);
  float breathe = 0.6 + 0.6 * u_midSlow + 0.3 * sin(u_time * 1.3 + r * 4.0);
  vec3 hue = streamerHue();
  return hue * ribbon * annulus * breathe * (0.12 + 0.9 * u_mid) * reverb * u_streamers;
}

// ---- SPECIES 3: GLASS MIDGES (HIGHS). Tiny darting specks on a fine
// lattice; each speck jitters to a NEW random direction on a fast clock, so
// the swarm reads as quick, nervous darting. Cool, appears only with highs.
vec3 midges(vec2 c) {
  vec3 col = vec3(0.0);
  float density = 26.0;                      // fine -> tiny & many
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.51) * 37.0, fract(u_seed * 0.29) * 51.0);
  float live = step(0.55 - 0.35 * u_midges, hash(sc * 2.13 + 7.7));
  // Dart clock: change direction ~4-8x/s, faster with slow highs.
  float rate = 4.0 + 6.0 * u_highSlow;
  float tick = floor(u_time * rate + hash(sc + 1.1) * 10.0);
  // New random heading each tick; short hop from a per-tick origin.
  float a = hash(sc + tick * 1.7) * 6.28318;
  float hop = 0.18 + 0.22 * hash(sc.yx + tick * 2.3);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 pos = vec2(0.5) + dir * hop * fract(u_time * rate);
  vec2 f = fract(q) - pos;
  float d2 = dot(f, f);
  float speck = exp(-d2 * 320.0);            // TINY
  float twinkle = 0.5 + 0.5 * sin(u_time * 30.0 + hash(sc + 4.4) * 6.28318);
  vec3 hue = midgeHue();
  col += hue * speck * live * twinkle * (0.1 + 1.6 * u_high);
  return col * u_midges;
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
  float on = step(gate, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02);
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + churn + traveling kick ripple.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_midSlow + 0.012 * u_buildup);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration + unsharp anti-mush tap.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueRot;
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
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
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_lowSlow)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);
  fresh += gravityColor * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);

  // Kick reverberation LIGHTS the medium it passes.
  float reverb = 1.0 + 2.6 * rippleWave;

  // ---- THE MENAGERIE: three distinct dust species, each gated by centerDim
  // so the black-hole interior stays dark and they read against it. Overall
  // dust slider (u_dust) scales all three.
  fresh += cinders(c, rippleWave) * centerDim * u_dust;
  fresh += streamers(c, r, ang, reverb) * centerDim * u_dust;
  fresh += midges(c) * centerDim * reverb * u_dust;

  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
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
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

/** EQ gate: dominant deck knob 0.5 = flat (1), 0 = kill (0), 1 = boost. */
function eqGate(knob: number): number {
  return Math.min(1.4, Math.max(0, (knob - 0.5) * 2 + 1));
}

export const g12VoyageMenageriePreset: VisualizerPreset = {
  id: 'g12-voyage-menagerie',
  name: 'g12 voyage-menagerie',
  hiRes: true,
  params: [
    { id: 'dust', label: 'dust amount (all species)', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'menagerie', label: 'species population', min: 0.4, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    let slowCentroid = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of dominant deck trackId),
    // eased over ~2s so track changes sweep; centroid EMA supplies the travel.
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;
    // Smoothed dominant-deck EQ (avoid species popping on knob jumps).
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const motion = frame.bandsSlow ?? frame.bands;
        const energyMotion = energyOf(motion);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const menagerie = frame.params.menagerie ?? 1;

        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const sustainedMotion = Math.min(1, energyMotion * 1.4);
        const lift = Math.max(drop, 0.7 * sustainedMotion);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        // DUST FIX v3: dominant deck = argmax audible level; its trackId anchors
        // a stable per-song hue, eased over ~2s; centroid EMA supplies travel.
        let domTrack: number | null = null;
        let domLevel = -1;
        for (const d of frame.decks) {
          if (d.level > domLevel) {
            domLevel = d.level;
            domTrack = d.trackId;
          }
        }
        if (domTrack !== null && domTrack !== lastAnchorTrack) {
          lastAnchorTrack = domTrack;
          hueAnchorTarget = splitmix01(domTrack);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        const hueRot = (((hueAnchor + (slowCentroid - 0.5) * 0.8) % 1) + 1) % 1;

        // Dominant audible deck (highest master-audible level) for EQ kills.
        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        let dom: (typeof frame.decks)[number] | null =
          frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        if (dom === null) {
          for (const d of frame.decks) {
            if (d.playing && (dom === null || d.level > dom.level)) dom = d;
          }
        }
        const eqAlpha = 1 - Math.exp(-dt / 0.15);
        eqLow += ((dom?.eq.low ?? 0.5) - eqLow) * eqAlpha;
        eqMid += ((dom?.eq.mid ?? 0.5) - eqMid) * eqAlpha;
        eqHigh += ((dom?.eq.high ?? 0.5) - eqHigh) * eqAlpha;

        // Species population: band content × max(drop,energy) × EQ gate.
        const popScale = 0.4 + 0.6 * Math.max(drop, sustained);
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_lowSlow: motion.low,
          u_mid: frame.bands.mid,
          u_midSlow: motion.mid,
          u_high: frame.bands.high,
          u_highSlow: motion.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_hueRot: hueRot,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          u_rotStep: (0.05 + 0.5 * motion.mid + 0.5 * buildup + 0.25 * sustainedMotion) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_cinders: Math.min(1.6, menagerie * eqGate(eqLow) * (0.2 + 0.9 * frame.bands.low) * popScale),
          u_streamers: Math.min(1.6, menagerie * eqGate(eqMid) * (0.2 + 0.9 * frame.bands.mid) * popScale),
          u_midges: Math.min(1.6, menagerie * eqGate(eqHigh) * (0.15 + 1.0 * frame.bands.high) * popScale),
        };
      },
    });
  },
};

export default g12VoyageMenageriePreset;
