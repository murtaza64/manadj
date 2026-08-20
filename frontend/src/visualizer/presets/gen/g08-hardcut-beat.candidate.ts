/**
 * g08-hardcut-beat (gen-8 TWEAK of g07-voyage-hardcut, gen-7's WINNER 1044 3/0).
 *
 * The parent's insight held: SMOOTH INTERPOLATION BETWEEN DISCRETE STRUCTURES
 * READS AS MUSH — QUANTIZE. g07 hard-cuts a whole LOOK tuple at every PHRASE
 * boundary (one frame, no ease), with a bigger stride on section boundaries.
 * The engine (voyage: galaxy from the feedback buffer, differential rotation
 * shearing stamps into spiral arms, kick ripple that lights the dust, charged
 * horizon ring, localized lens, chroma-preserving soft knee) is copied
 * wholesale. All within-cut motion is the parent's continuous engine.
 *
 * THE TWEAK — extend the CUT HIERARCHY down the metric ladder, so quantized
 * changes cascade at three scales, visually proportional to their tier:
 *
 *   PHRASE (4 bars)  = FULL LOOK CUT (parent, unchanged). The whole look
 *                      tuple snaps to the next genome entry (palette bank,
 *                      arm count, ring/streak, lens/rot dir, star tier).
 *                      Biggest change. Section (16 bars) still strides to a
 *                      distant family + forces a palette-bank change.
 *
 *   BAR (1 bar)      = ONE MINOR ELEMENT CUT. On each bar boundary (that is
 *                      NOT also a phrase boundary) exactly ONE minor element
 *                      of the current look flips, genome-SEQUENCED (rotates
 *                      through: star tier -> lens direction -> streak on/off).
 *                      Medium change — a single element, not the whole look.
 *
 *   BEAT (1 beat)    = ACCENT A/B CHROMA FLIP. On each beat two accent
 *                      palette SAMPLES swap (the hypno-note idea applied
 *                      here): a small element re-tints between two chroma
 *                      points. A CHROMA exchange, never a luminance step —
 *                      photosafe. Smallest, fastest change.
 *
 * Result: small/fast at the beat, medium at the bar, total at the phrase —
 * a cascade of quantized cuts while motion stays continuous between. The
 * three scales are made visually distinguishable (size of change ∝ tier).
 *
 * The anticipation tick (final beat before a phrase cut) and the
 * drop-on-boundary brightness slam are retained. Timing derives from
 * `ladderBarIndex ?? barIndex` + beat phase; integer things never
 * interpolate. Same song ⇒ same sequence (trackId genome). Photosensitivity
 * floor respected: the only luminance step is the parent's rate-limited
 * (≤1 per 4 bars) cut flash; bar cuts change ONE element, beat flips are pure
 * chroma exchanges. Bright saturated colors (this repo dislikes pastels).
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

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
uniform float u_palette;    // palette bank 0..3 (QUANTIZED — integer per look)
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven star burst gain
uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1
// --- QUANTIZED LOOK TUPLE (all discrete; PHRASE-cut, some BAR-cut).
uniform float u_arms;       // spiral-arm count, integer {2,3,5,7}
uniform float u_ringOn;     // 0/1 charged horizon ring present
uniform float u_streakOn;   // 0/1 anamorphic streak present (BAR-cuttable)
uniform float u_lensDir;    // -1/+1 lens swirl chirality (BAR-cuttable)
uniform float u_starTier;   // 0/1/2 star/powder density tier (BAR-cuttable)
uniform float u_precut;     // 0..1 anticipation charge (final beat before a phrase cut)
uniform float u_cutFlash;   // 0..1 drop-on-boundary slam (decays, rate-limited)
// --- BEAT accent A/B chroma flip (swaps two accent samples per beat).
uniform float u_accentA;    // accent chroma sample A (palette phase 0..1)
uniform float u_accentB;    // accent chroma sample B (palette phase 0..1)
uniform float u_barTick;    // 0..1 bar-cut wave (medium change; decays over the bar)

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};

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

// iq cosine palette. The four are SELECTED by an integer bank (u_palette snaps
// to a whole number per look) — no continuous morph, so a phrase cut is a hard
// palette change, not a slide.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

// DISCRETE palette select: choose the bank nearest u_palette. No mix between
// banks — the cut is the aesthetic. Bright, saturated (repo dislikes pastels).
vec3 palette(float t) {
  float b = floor(u_palette + 0.5);
  vec3 c = pal0(t);
  c = b > 0.5 ? pal1(t) : c;
  c = b > 1.5 ? pal2(t) : c;
  c = b > 2.5 ? pal3(t) : c;
  // Drops warm, buildups cool (parent idiom); the cut-flash SATURATES.
  c += vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
  c *= 1.0 + 0.25 * u_cutFlash;
  return c;
}

// ACCENT palette: the SAME bank, but sampled at the beat-flipped accent phase.
// A/B swap each beat is a CHROMA exchange (same luminance envelope), photosafe.
vec3 accent(float which) {
  float ph = which > 0.5 ? u_accentB : u_accentA;
  return palette(ph);
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

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

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the (bank-selected) palette at each star own hash phase.
  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02), u_hueRot);
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

  // ---- Warp: differential rotation (direction from the look's rotDir, folded
  // into u_rotStep JS-side) + churn + traveling kick ripple.
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
  // Localized black-hole lens; chirality is the look's lensDir (discrete).
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12 * u_lensDir;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  // Chromatic aberration: radial RGB split (parent), widening on the cut-flash.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_cutFlash)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  // Unsharp anti-mush tap (parent).
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
  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  // The event-horizon ring — GATED by the look's discrete ringOn.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * u_ringOn;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge) * u_ringOn;
  // Coal heart (always present — bass identity).
  // Coal heart: a deep, low-luma slice of the (bank-selected) palette
  // (spectral-hue biased) instead of a fixed dark red — still whitens on kick.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak — GATED by the look's discrete streakOn.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick) * u_streakOn;
  // The disk: spiral lanes — the ARM COUNT is the look's integer u_arms
  // (2/3/5/7). It never interpolates: a phrase cut snaps to a new polygon.
  float arm = sin(ang * u_arms + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  // Bar-cut wave: a ring lights the dust as it passes (parent-style reverb),
  // marking the MEDIUM (bar) tier cut without changing luminance globally.
  float barFront = 0.15 + (1.0 - u_barTick) * 1.0;
  float barWaveRing = exp(-pow((r - barFront) * 9.0, 2.0)) * u_barTick;
  float reverb = 1.0 + 2.6 * rippleWave + 1.6 * barWaveRing;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  // High nebula.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  // DISTINCT DUST HUE: high nebula samples the palette at +0.35 phase from the
  // mid dust so the bands read as different dust kinds.
  vec3 electric = hueRotate(palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  // High-transient nebula puffs — scaled by the discrete star tier.
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
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  // Snare arc — this is the ACCENT element that flips chroma every beat (A/B).
  // The two samples exchange each beat: a chroma re-tint of the same arc, so
  // the beat cut is visible but is the SMALLEST of the three scales.
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * (u_arms + 1.0) + u_seed), 2.0);
    sky += accent(0.0) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    // Star powder tinted by accent B (the OTHER beat sample) — the beat flip
    // exchanges the two accent chroma across these two accent elements.
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), accent(1.0), 0.45);
  }

  // ---- ANTICIPATION TICK: the final beat before a phrase cut raises a faint
  // charge ring at the horizon (tension, no flash). Localized => photosafe.
  if (u_precut > 0.001) {
    float pre = exp(-pow((r - horizon * 1.6) * 14.0, 2.0));
    sky += mix(chargeColor, vec3(1.0), 0.4) * pre * u_precut * 0.35;
  }

  // Film grain.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade (whole frame leans toward the current bank's hue).
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // Buildups cool/dim, drops bloom (parent). The CUT-FLASH adds a moderate,
  // rate-limited brightness slam (≤1 per 4 bars — photosafe, not a strobe).
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup + 0.35 * u_cutFlash;
  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  { id: 'cutStrength', label: 'cut drama', min: 0, max: 2, step: 0.05, default: 1 },
];

// --- Song genome (JS-side, pattern g02-julia): a trackId hash seeds a stable
// look SEQUENCE so the same song cuts through the same series of looks.

/** splitmix32-style avalanche → a generator of stable [0,1) scalars. */
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

const ARM_CHOICES = [2, 3, 5, 7] as const;

/** A single discrete LOOK: nothing here interpolates — it is CUT to whole. */
interface Look {
  paletteBank: number; // 0..3
  armCount: number; // 2/3/5/7
  ringOn: number; // 0/1
  streakOn: number; // 0/1
  lensDir: number; // -1/+1
  starTier: number; // 0/1/2
  rotDir: number; // -1/+1
}

/** Derive a look from a per-index generator (stable given the same seed). */
function lookFrom(next: () => number): Look {
  return {
    paletteBank: Math.floor(next() * 4), // 0..3
    armCount: ARM_CHOICES[Math.floor(next() * ARM_CHOICES.length)],
    ringOn: next() > 0.28 ? 1 : 0, // usually on
    streakOn: next() > 0.5 ? 1 : 0,
    lensDir: next() > 0.5 ? 1 : -1,
    starTier: Math.floor(next() * 3), // 0/1/2
    rotDir: next() > 0.5 ? 1 : -1,
  };
}

/** The look at a sequence index for a given seed. A SECTION boundary (handled
 * by the caller striding the index) lands on a distant entry; plus the palette
 * bank is force-rotated on section so section cuts are bigger than phrase cuts. */
function lookAt(seed: number, index: number, sectionShift: number): Look {
  const next = splitmix(((Math.round(seed) | 0) ^ Math.imul(index | 0, 0x9e3779b9)) >>> 0);
  const look = lookFrom(next);
  if (sectionShift !== 0) {
    look.paletteBank = (look.paletteBank + 1 + (Math.abs(sectionShift) % 3)) % 4;
  }
  return look;
}

/** Dominant audible deck's trackId (highest master-audible level); null when
 * unknown — then the slow spectral character is frozen as a pseudo-seed. */
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

const PHRASE_BARS = 4;
const SECTION_BARS = 16;

/** The three BAR-tier minor elements, cycled one per bar (genome-sequenced).
 * Each bar boundary (that is not a phrase boundary) flips exactly ONE of
 * these on the current look — a single-element medium cut. */
type BarElement = 'starTier' | 'lensDir' | 'streakOn';
const BAR_ELEMENTS: BarElement[] = ['starTier', 'lensDir', 'streakOn'];

/** Two accent chroma samples (palette phase 0..1) drawn from the seed; the
 * BEAT tier flips which one the accent elements read — a pure chroma swap. */
function accentPair(seed: number, index: number): [number, number] {
  const next = splitmix(((Math.round(seed) | 0) ^ Math.imul((index | 0) + 7919, 0x85ebca6b)) >>> 0);
  const a = next();
  // Keep the pair a genuine chroma exchange: push B a good arc away from A.
  const b = (a + 0.35 + 0.3 * next()) % 1;
  return [a, b];
}

export const g08HardcutBeatPreset: VisualizerPreset = {
  id: 'g08-hardcut-beat',
  name: 'g08 hardcut-beat',
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

    // --- QUANTIZED look grammar state.
    let seedKey: number | null = null;
    let lookIndex = 0; // advances one step per phrase cut
    let current: Look = lookAt(1, 0, 0);
    let lastPhraseIndex: number | null = null;
    let lastSectionIndex: number | null = null;
    let lastBarIndex: number | null = null;
    let barTick = 0; // decays over a bar; marks the medium (bar) cut
    let barElementCursor = 0; // which minor element the next bar cut flips
    let cutFlash = 0; // decays after a drop-on-boundary slam
    let lastFlashPhrase = -999; // rate-limit: ≤1 flash per phrase

    // --- BEAT accent A/B chroma flip state.
    let accentA = 0.3;
    let accentB = 0.65;
    let accentSwap = 0; // 0/1 which sample the A/B slots currently point at
    let prevBeatCount: number | null = null;
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase.
    let slowCentroid = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of dominant deck trackId),
    // eased over ~2s so track changes sweep; centroid EMA supplies the travel.
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
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const cutStrength = frame.params.cutStrength ?? 1;

        // Excitement split by bass presence (parent), temporally smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);

        // --- Identity: dominant trackId seeds the look SEQUENCE + accent pairs.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((frame.centroid * 331 + frame.spread * 271 + frame.flatness * 197) * 101);
        if (seedKey == null || key !== seedKey) {
          seedKey = key;
          const tb0 = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
          lookIndex = Math.floor(tb0 / PHRASE_BARS);
          current = lookAt(seedKey, lookIndex, 0);
          const [pa, pb] = accentPair(seedKey, lookIndex);
          accentA = pa;
          accentB = pb;
        }

        // --- CUT TIMING: ladder tier is primary (ladderBarIndex ?? barIndex).
        const tierBar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        const barPhase = frame.beat ? frame.beat.barPhase : 0;
        let precut = 0;

        if (tierBar !== null) {
          const phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          const sectionIndex = Math.floor(tierBar / SECTION_BARS);

          // === PHRASE (4 bars): FULL LOOK CUT — one frame, no ease (parent). ===
          if (lastPhraseIndex !== null && phraseIndex !== lastPhraseIndex) {
            const sectionCut = lastSectionIndex !== null && sectionIndex !== lastSectionIndex;
            if (sectionCut) {
              lookIndex += 3 + (Math.abs(sectionIndex) % 3);
              current = lookAt(seedKey, lookIndex, sectionIndex - (lastSectionIndex ?? 0) || 1);
            } else {
              lookIndex += 1;
              current = lookAt(seedKey, lookIndex, 0);
            }
            // Re-seed the accent pair for the new look (chroma family follows).
            const [pa, pb] = accentPair(seedKey, lookIndex);
            accentA = pa;
            accentB = pb;
            // DROP-ON-BOUNDARY SLAM (parent, rate-limited ≤1 per phrase).
            const landing = Math.max(drop, 0.6 * sustained);
            if (landing > 0.25 && phraseIndex - lastFlashPhrase >= 1) {
              cutFlash = Math.min(1, landing) * cutStrength;
              lastFlashPhrase = phraseIndex;
            }
          }

          // === BAR (1 bar): ONE MINOR ELEMENT CUT, genome-sequenced. Fires on
          // every bar boundary that is NOT also a phrase boundary. ===
          if (lastBarIndex !== null && tierBar !== lastBarIndex) {
            const phraseBoundary = phraseIndex !== lastPhraseIndex;
            if (!phraseBoundary) {
              // Genome-sequenced choice of WHICH element + its new value: a
              // stable splitmix keyed on (seed, bar) so the same song flips
              // the same elements at the same bars.
              const bnext = splitmix(
                ((Math.round(seedKey) | 0) ^ Math.imul((tierBar | 0) + 104729, 0xc2b2ae35)) >>> 0
              );
              const element = BAR_ELEMENTS[barElementCursor % BAR_ELEMENTS.length];
              barElementCursor += 1;
              if (element === 'starTier') {
                // Step to a DIFFERENT tier (0/1/2) — visible density change.
                current.starTier = (current.starTier + 1 + Math.floor(bnext() * 2)) % 3;
              } else if (element === 'lensDir') {
                current.lensDir = current.lensDir > 0 ? -1 : 1; // flip chirality
              } else {
                current.streakOn = current.streakOn > 0.5 ? 0 : 1; // toggle streak
              }
              barTick = 1; // mark the medium cut (decays over ~one bar)
            }
          }
          lastBarIndex = tierBar;
          lastPhraseIndex = phraseIndex;
          lastSectionIndex = sectionIndex;

          // === BEAT (1 beat): ACCENT A/B CHROMA FLIP. Beat count from the
          // ladder bar + barPhase so flips land on the grid. Pure chroma swap
          // (exchange the two accent slots), never a luminance step. ===
          const beatsPerBar = frame.beat && frame.beat.beatsPerBar > 0 ? frame.beat.beatsPerBar : 4;
          const beatCount = Math.floor(tierBar * beatsPerBar + barPhase * beatsPerBar);
          if (prevBeatCount !== null && beatCount !== prevBeatCount) {
            accentSwap = accentSwap > 0.5 ? 0 : 1; // A<->B exchange each beat
          }
          prevBeatCount = beatCount;

          // Anticipation: the final beat of the phrase's last bar charges up.
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          if (barInPhrase === PHRASE_BARS - 1) {
            precut = Math.max(0, (barPhase - 0.75) / 0.25) * cutStrength;
          }
        } else {
          // Gridless: no hard cuts (no boundaries to land on) — hold the look.
          lastPhraseIndex = null;
          lastSectionIndex = null;
          lastBarIndex = null;
          prevBeatCount = null;
        }
        cutFlash = Math.max(0, cutFlash - dt / 0.5);
        // Bar tick decays over roughly one bar (or ~2 s without a grid).
        const barDecayS = frame.beat && frame.beat.bpm ? Math.max(0.4, 240 / frame.beat.bpm) : 2;
        barTick = Math.max(0, barTick - dt / barDecayS);

        // Resolve the A/B accent slots from the current swap state (the flip is
        // an EXCHANGE, so total chroma content is constant — photosafe).
        const uAccentA = accentSwap > 0.5 ? accentB : accentA;
        const uAccentB = accentSwap > 0.5 ? accentA : accentB;

        // Arm drift (parent): one revolution per 64 beats when gridded.
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        // Ring charge (parent).
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        // Traveling ripple (parent).
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        const lift = Math.max(drop, 0.7 * sustained);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;

        // Star gain by discrete tier (0 sparse .. 2 dense).
        const tierGain = 0.35 + 0.55 * current.starTier;
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
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

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_hueRot: hueRot,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          u_rotStep:
            (0.05 + 0.5 * frame.bands.mid + 0.5 * buildup + 0.25 * sustained) *
            speed *
            dt *
            current.rotDir,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: current.paletteBank,
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (frame.params.stars ?? 1) *
              tierGain *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) *
              (frame.params.stars ?? 1) *
              tierGain *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          // --- The discrete look tuple (phrase-cut; some bar-cut).
          u_arms: current.armCount,
          u_ringOn: current.ringOn,
          u_streakOn: current.streakOn,
          u_lensDir: current.lensDir,
          u_starTier: current.starTier,
          u_precut: Math.min(1, precut),
          u_cutFlash: Math.min(1, cutFlash),
          // --- BEAT accent chroma flip + BAR medium-cut wave.
          u_accentA: uAccentA,
          u_accentB: uAccentB,
          u_barTick: Math.min(1, barTick),
        };
      },
    });
  },
};

export default g08HardcutBeatPreset;
