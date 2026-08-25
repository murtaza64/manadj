/**
 * "Voyage" preset (realtime-visualization 05, v3): a galaxy driven by the
 * feedback buffer with differential rotation — the inner field turns
 * faster, shearing everything stamped into it into spiral arms.
 *
 * v3 (walkthrough feedback):
 * - The "low-res" feel was progressive resampling blur: every warp frame
 *   bilinearly resamples the field, smearing it. Fixed with an unsharp
 *   tap in the feedback pass (center boosted against a 4-tap blur), plus
 *   the hiRes backing budget.
 * - Color movement: mids/highs no longer sit on fixed band colors — the
 *   disk runs a drifting cosine palette (phase moved by time + spectral
 *   centroid), stars keep temperature variation. Shape carries the band
 *   identity; color is free to travel.
 * - Spacey filter stack: radial chromatic aberration (stronger through
 *   drops), an anamorphic lens streak on the core, and fine film grain.
 * - Drops ≠ buildups: excitement is split by bass presence. A BUILDUP
 *   (excitement without lows — risers, filtered kicks) collapses the
 *   field INWARD (zoom < 1), spins faster, cools the palette, and starves
 *   star spawning. The DROP (excitement with lows) explodes outward with
 *   hot colors, boosted spawns, and full shockwaves.
 */

import { ADDITIVE_COLORS } from '../../waveform/styles';
import { energyOf } from '../style';
import { createGlRenderer } from './glPreset';
import type { VisualizerPreset } from './types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

// DUST FIX v3: deterministic per-track hue anchor. splitmix64-style bit mix
// folded to [0,1) — different track ids land on genuinely different hues.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;     // motion-grade low: gravity-wave phase rate (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;    // motion-grade mid: churn/warp rate (erratic-motion law)
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
uniform float u_hueRot;     // DUST FIX v3: per-song hue anchor + slow spectral travel, in TURNS 0..1

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};

// DUST FIX v3: value-preserving hue ROTATION in YIQ chroma-plane. rot is in
// TURNS; luminance (Y) is untouched by construction so gains/brightness are
// unchanged. Negatives clamped (rotation can push a channel below 0).
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

// iq cosine palette: deep-space blues/violets/pinks that TRAVEL — phase
// rides time and the spectral centroid, warmth rides the drop.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

// Branchless continuous palette: the slider MORPHS between the four
// (0 ember → 1 nebula → 2 aurora → 3 solar) instead of switching.
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
  // Per-axis seed mixing: adding one scalar to both axes made the sin-hash
  // align stars into moiré diagonals across the lattice.
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the traveling palette at each star's own hash phase
  // (wide span) so the scatter picks up spectral color instead of a fixed
  // cool/warm ramp. Luminance is unchanged (starShape * on * bright * gain).
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02);
  return hueRotate(mix(tint, HIGH, 0.2), u_hueRot) * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + two NON-circular motions —
  // a turbulent churn field (mids knead the accumulated sky) and a
  // traveling kick ripple (each strong kick sends a displacement wave
  // through everything on screen, Tunnel-style physicality).
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_midSlow + 0.012 * u_buildup);  // motion: slow bands (erratic-motion law)
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  // BLACK HOLE, localized: the event-horizon radius is the bass ring;
  // the lens lives INSIDE it (gaussian in r/horizon), so distortion churns
  // the interior while the field outside stays legible. Swirl is a hint,
  // not a whirlpool.
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration: radial RGB split, widening through the drop
  // and blowing out along the ripple wavefront.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = 0.0; // CLASSIC red/blue aberration fluid (human: keep some presets classic)
  vec3 tapA = texture2D(u_prev, src + ab).rgb;
  vec3 tapC = texture2D(u_prev, src).rgb;
  vec3 tapB = texture2D(u_prev, src - ab).rgb;
  vec3 sampled = max(vec3(0.0), hueRotate(vec3(
    hueRotate(tapA, -fringeRot).r,
    hueRotate(tapC, -fringeRot).g,
    hueRotate(tapB, -fringeRot).b
  ), fringeRot));
  // Unsharp: the anti-mush pass — boost against a 4-tap blur so stars
  // and arms stay crisp through endless resampling.
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  // The bass circle stops being a circle: the low band kneads its rim
  // (two angular modes + a kick-synced tremor), so the core's SHAPE
  // follows the bassline, not just its size.
  // Electrical vibration: two fast noise bands arcing around the rim —
  // the bass circle hums like a live wire, violently under a kick.
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  // Gravity waves: concentric rings breathing out of the core with the
  // bassline itself (not just kicks) — sustained lows keep the center alive.
  // motion: slow bands (erratic-motion law) — gravity-wave travel rate
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_lowSlow)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a warm slice of the traveling palette, biased by
  // the spectral hue, replacing the fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  // The event horizon ring: a wide ember glow + a thin white-hot arc,
  // both jittering with the voltage field — THE bass element. Interior is
  // dark (centerDim), so the ring reads as the edge of the black hole.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  // Focused + evolving: the ring CHARGES with kick energy (color runs
  // ember → orange → white-hot as charge builds) and each kick discharges
  // a wave from the horizon (the ripple's new launch point).
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring color: a warm palette slice (spectral-hue biased) charges toward a
  // warmer palette accent, then to white-hot at high charge. The palette
  // supplies the hue; the charge→white ramp and gains preserve luminance.
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart: a deep, low-luma slice of the traveling palette (spectral-hue
  // biased) instead of a fixed dark red — it still whitens under a kick and
  // the outer corona rides LOW. Kept dark (palette floor) so it reads as coal;
  // gains/kick-whiten preserve luminance.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  // Radial dimmer keeps the middle dark so dust/stars read against it.
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak across the core — the spacey money shot. Both
  // ends of the mix now sample the traveling palette (a wide phase offset for
  // the cool end, spectral-hue biased) instead of a fixed steel-blue.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // The disk: spiral lanes + clouds in the TRAVELING palette.
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Wide phase span + spatial drift: the old 0.7·cloudField span sampled
  // under half a palette period (and blend positions average cosines
  // flatter still) — dust came out monochrome at many slider stops.
  // SPECTRAL DUST TINT: the dust/disk palette phase is biased by the
  // slow-tracked centroid (u_specHue, ~1s EMA) so dust hue follows spectral
  // content — brighter spectra push the disk color across the wheel.
  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  // Kick reverberation: the traveling wavefront LIGHTS the dust it passes
  // through (displacement alone read as subtle; this makes it audible).
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  // HIGH NEBULA: distinct physics from the mid dust — finer scale,
  // counter-rotation, electric blue-white tint, fast shimmer flicker.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = hueRotate(mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65), u_hueRot);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient nebula PUFFS: stamped into the feedback at full
  // strength (like the old stars, but cloud-natured) — they persist,
  // shear into the spiral, and fade. Snare powder stays as-is.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    // Shockwave hue from the traveling palette (spectral-hue biased) mixed
    // toward a warm-white accent, replacing the fixed LOW->warm ramp. Kick
    // gain / drop scaling unchanged (luminance identical).
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    // Whole-frame punch: a brief lift so the kick lands everywhere.
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    // Highs live in the nebula now (puffs above); only the snare powder
    // keeps discrete star points — the hit you liked. Palette-tinted so
    // the slider reaches them too.
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // Film grain — fine, a touch louder through the drop.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade: the whole frame leans toward the palette hue, so the
  // blend slider is legible even while bass-red owns the center.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // Buildups cool and dim slightly (tension), drops bloom.
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

export const voyagePreset: VisualizerPreset = {
  id: 'voyage',
  name: 'Voyage',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase
    // so dust hue follows spectral content without jerking on transients.
    let slowCentroid = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of the dominant deck's
    // trackId) eased over ~2s so track changes SWEEP the wheel, plus a slow
    // spectral travel around it. Full-wheel rotation of the dust/star/nebula/
    // accent layers, value-preserving (see hueRotate).
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        // motion: slow bands (erratic-motion law)
        const motion = frame.bandsSlow ?? frame.bands;
        const energyMotion = energyOf(motion);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        // Excitement split by bass presence: with lows = the drop, without
        // = the buildup (risers/filtered kicks have busy highs, no bass).
        // Wider bass window + temporal smoothing: the old narrow clamp
        // flipped drop↔buildup regimes instantly (zoom sign flip + stacked
        // suppressors = the "eerily still" buildup cut).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        // motion: slow bands (erratic-motion law) — cruise speed rides the
        // slow energy so travel/rotation don't jerk with each transient;
        // the instantaneous `sustained` still drives brightness/spawns.
        const sustainedMotion = Math.min(1, energyMotion * 1.4);
        // Drops fly outward; buildups COLLAPSE inward (zoom < 1).
        // Cruise rides sustained loudness too — a drop's PLATEAU must fly,
        // not just its first seconds (excitement fades into the baseline).
        const lift = Math.max(drop, 0.7 * sustainedMotion);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        // Spiral-arm drift locks to the grid: one revolution per 64
        // beats (16 bars in 4/4); gridless falls back to slow time drift.
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        // Ring charge: kicks pump it, it bleeds off over ~2.5 s — the
        // ring's color/size/lens all ride it, so a busy bassline visibly
        // heats the horizon.
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        // Traveling ripple: retrigger on strong kicks, capture strength.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        // Gentle with energy: the old -0.018·energy ate stars 2.5× faster
        // exactly when drops should be dense (buildups still drain extra).
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        // DUST FIX v3: dominant deck = argmax audible level; its trackId
        // anchors a stable per-song hue. Anchor eases over ~2s (track change
        // sweeps, not snaps); centroid EMA supplies the slow travel around it.
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
        const hueTravel = (slowCentroid - 0.5) * 0.8;
        const hueRot = ((((hueAnchor + hueTravel) % 1) + 1) % 1);
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_lowSlow: motion.low, // motion: slow bands (erratic-motion law)
          u_mid: frame.bands.mid,
          u_midSlow: motion.mid, // motion: slow bands (erratic-motion law)
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_hueRot: hueRot,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          // motion: slow bands (erratic-motion law) — differential rotation rate
          u_rotStep: (0.05 + 0.5 * motion.mid + 0.5 * buildup + 0.25 * sustainedMotion) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          // Buildups starve the spawner; SUSTAINED loudness keeps it open
          // (excitement fades over a drop's plateau — it's a transition
          // signal, so the drop body must ride energy, not excitement).
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: frame.params.palette ?? 1,
          // Powder is a MID/HIGH effect: kick transients are broadband
          // (their click bleeds into impulse.high/mid), so a kick gate
          // keeps low-end impacts SOLID (core/shockwave) instead of
          // sparkly. Slightly eased overall.
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (frame.params.stars ?? 1) *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          // Snares (mid transients) throw big stars; suppressed less in
          // buildups so rolls still sparkle without flooding.
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (frame.params.stars ?? 1) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
        };
      },
    });
  },
};
