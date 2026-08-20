/**
 * g14-hardcut-dye (gen-14 DUST COLOR DYNAMISM tweak).
 *
 * Parent: g09-hardcut-listen (the "really cool" music-chooses-the-bank
 * hardcut; engine = g07-voyage-hardcut, 4/0-class winner). Everything the
 * parent does — six music-chosen banks, genome-driven structure cuts,
 * anticipation tick, drop-on-boundary slam — is copied verbatim. The tweak
 * answers ONE human note:
 *
 *   "i wish the red and blue 'dust' was a little more dynamic in color
 *    (in general for the voyage family)"
 *
 * Falsifiable question (brief): does making the dust hue actively TRAVEL —
 * a music-rate hue flow, a spatial tri-tone mask, and kick-ripple
 * re-dyeing — cure the two-color dust stasis without disturbing the loved
 * quantized grammar? Three changes, all confined to the dust/nebula layers:
 *
 *   1. HUE FLOW (u_hueFlow): the disk's palette phase is an ACCUMULATED
 *      flow whose rate rides bandsSlow.mid + max(drop, energy) — heavy mids
 *      sweep the dust through the bank's full hue range in ~8 s; quiet
 *      passages drift slowly. Rate on slow bands only (motion smoothness).
 *   2. TRI-TONE DUST: a slow spatial fbm mask splits the disk into three
 *      simultaneous palette slices (+0.33 / +0.66 phase) so the disk holds
 *      distinct hue regions drifting through the arms — never a wash.
 *   3. RIPPLE RE-DYE: the traveling kick wavefront doesn't just light the
 *      dust it passes — it RE-DYES it (phase shift toward the bank's far
 *      slice where rippleWave is high). Kicks visibly repaint the disk.
 *      The high nebula counter-flows (-0.6 * hueFlow) so mid dust and high
 *      wisps visibly diverge in color.
 *
 * ---- Parent doc (kept — all still true):
 *
 *   THE PALETTE BANK IS NO LONGER GENOME-SEQUENCED — THE MUSIC PICKS IT.
 *
 * Same song section played twice ⇒ same colors (deterministic from audio
 * character, not randomness).
 *
 * THE DECISION (music -> bank). Over each phrase (4 ladder-bars) we accumulate
 * a windowed spectral fingerprint (centroid mean, flatness mean). At the phrase
 * boundary the NEXT phrase's palette bank is quantized from the fingerprint of
 * the phrase we are LEAVING:
 *
 *   CENTROID TERCILE x FLATNESS HALF -> 6 BANKS (mean-luminance parity):
 *
 *                     | flatness LOW (tonal) | flatness HIGH (noisy)
 *     --------------- + -------------------- + --------------------
 *     centroid LOW    |  0 EMBER  (warm)     |  3 MOSS   (green/teal)
 *     centroid MID    |  1 NEBULA (violet)   |  4 AURORA (teal)
 *     centroid HIGH   |  2 SOLAR  (gold)     |  5 UV     (violet/white)
 *
 *   Tonal low-centroid music (deep basslines) lands EMBER; bright noisy sweeps
 *   land UV; a wide tonal mid lands NEBULA violet; etc. The two NEW banks the
 *   brief asked for are MOSS (green/teal) and one violet bank (NEBULA is the
 *   parent's; UV is the new saturated violet/white). All six banks are tuned to
 *   comparable mean luminance so cuts don't read as a periodic washout
 *   (FEEDBACK CONTRACTION RULE: bank mean luminance comparable across banks).
 *
 * STRUCTURE STAYS GENOME-DRIVEN. armCount, ringOn, streakOn, lensDir, starTier,
 * rotDir still come from the trackId-seeded genome and still HARD-CUT at phrase
 * boundaries (structure vs color separation — the brief's ask). Only the
 * palette bank is now audio-derived; the section stride/forced-bank-change is
 * kept for structure, but the bank itself is overridden by the music decision.
 *
 * Standing law: docs/visualizer-ga.md. Contraction: the whole-field grade is
 * capped at min(x, 0.99); drop drama lives in the fresh-injection term. Bright
 * saturated colors; chroma-preserving soft knee; cuts <=1 per 4 bars (photosafe).
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { PresetParam, VisualizerFrameData, VisualizerPreset } from '../types';

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
uniform float u_hueFlow;   // ACCUMULATED dust hue-travel phase (rate rides bandsSlow.mid)
uniform float u_dye;       // tri-tone dye contrast (param)
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
uniform float u_palette;    // palette bank 0..5 (MUSIC-CHOSEN; snaps on cut)
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven star burst gain
// --- QUANTIZED LOOK TUPLE (structure — still genome-driven; cut at phrases).
uniform float u_arms;       // spiral-arm count, integer {2,3,5,7}
uniform float u_ringOn;     // 0/1 charged horizon ring present
uniform float u_streakOn;   // 0/1 anamorphic streak present
uniform float u_lensDir;    // -1/+1 lens swirl chirality
uniform float u_starTier;   // 0/1/2 star/powder density tier
uniform float u_precut;     // 0..1 anticipation charge (final beat before a cut)
uniform float u_cutFlash;   // 0..1 drop-on-boundary slam (decays, rate-limited)

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

// iq cosine palettes. SIX banks now — the parent's four plus MOSS (green/teal)
// and UV (violet/white). Each is a whole-integer selection (no morph), so a
// phrase cut is a hard palette change. All six are tuned to comparable MEAN
// LUMINANCE (bias vec near 0.42-0.5, amp near 0.4) so cuts don't read as a
// periodic washout (FEEDBACK CONTRACTION RULE).
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }  // EMBER
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }   // NEBULA violet
vec3 pal2(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }   // SOLAR gold
vec3 pal3(float t) { return vec3(0.16, 0.44, 0.34) + vec3(0.22, 0.42, 0.36) * cos(6.28318 * (vec3(0.8, 1.0, 0.9) * t + vec3(0.35, 0.15, 0.4))); }  // MOSS green/teal
vec3 pal4(float t) { return vec3(0.18, 0.42, 0.44) + vec3(0.3, 0.42, 0.46) * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.15, 0.35, 0.55))); } // AURORA teal
vec3 pal5(float t) { return vec3(0.4, 0.26, 0.5) + vec3(0.42, 0.34, 0.48) * cos(6.28318 * (vec3(0.85, 0.7, 1.0) * t + vec3(0.5, 0.2, 0.0))); }     // UV violet/white

// DISCRETE palette select: choose the bank nearest u_palette. No mix between
// banks — the cut is the aesthetic. Bright, saturated (repo dislikes pastels).
vec3 palette(float t) {
  float b = floor(u_palette + 0.5);
  vec3 c = pal0(t);
  c = b > 0.5 ? pal1(t) : c;
  c = b > 1.5 ? pal2(t) : c;
  c = b > 2.5 ? pal3(t) : c;
  c = b > 3.5 ? pal4(t) : c;
  c = b > 4.5 ? pal5(t) : c;
  // Drops warm, buildups cool (parent idiom); the cut-flash SATURATES.
  c += vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
  c *= 1.0 + 0.25 * u_cutFlash;
  return c;
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
  // Star tint samples the OWN music-chosen bank palette at each star's hash
  // phase (wide span, spectral-hue biased) instead of a fixed cool/warm ramp.
  // Luminance unchanged (starShape * on * bright * gain).
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02 + u_specHue * 0.5);
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
  // Gravity ripple color: a warm slice of the OWN bank palette (spectral-hue
  // biased) instead of a fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = palette(0.05 + t * 0.015 + u_specHue * 0.5);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  // The event-horizon ring — GATED by the look's discrete ringOn.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring color: a warm bank-palette slice (spectral-hue biased) charging toward
  // a warmer accent then white-hot at high charge. Palette supplies hue; the
  // charge->white ramp and gains preserve luminance.
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * u_ringOn;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge) * u_ringOn;
  // Coal heart (always present — bass identity): a deep, low-luma slice of the
  // OWN bank palette (spectral-hue biased) instead of a fixed dark red. Kept
  // dark (0.55 floor); gains/kick-whiten preserve luminance.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  // Anamorphic lens streak — GATED by the look's discrete streakOn. Both ends
  // sample the OWN palette (a wide phase offset for the cool end, spectral-hue
  // biased) instead of a fixed steel-blue.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick) * u_streakOn;
  // The disk: spiral lanes — the ARM COUNT is the look's integer u_arms
  // (2/3/5/7). It never interpolates: a phrase cut snaps to a new polygon.
  float arm = sin(ang * u_arms + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // DYE: the dust phase is an accumulated hue FLOW (u_hueFlow, music-rate,
  // replaces the near-static t*0.012 drift) + the parent's spectral bias.
  float dyeBase = cloudField * 1.5 + r * 0.35 + ang * 0.1 + u_hueFlow + u_centroid * 0.4 + u_specHue * 0.8;
  // TRI-TONE DUST: a slow spatial mask splits the disk into three palette
  // slices — distinct hue regions drifting through the arms, never a wash.
  float dyeMask = fbm(vec2(ang * 3.0 + r * 2.0, r * 4.0 - u_hueFlow * 2.0));
  vec3 diskColor = palette(dyeBase);
  diskColor = mix(diskColor, palette(dyeBase + 0.33), smoothstep(0.32, 0.52, dyeMask) * u_dye);
  diskColor = mix(diskColor, palette(dyeBase + 0.66), smoothstep(0.58, 0.78, dyeMask) * u_dye);
  float reverb = 1.0 + 2.6 * rippleWave;
  // RIPPLE RE-DYE: the kick wavefront repaints the dust it passes — a hard
  // phase shift toward the bank's far slice where the wave is (legible
  // causality; luminance comes from the existing reverb lighting, not here).
  diskColor = mix(diskColor, palette(dyeBase + 0.5), clamp(rippleWave * 2.2, 0.0, 1.0) * 0.85);
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  // High nebula — COUNTER-FLOWS the dust dye so mid and high layers visibly
  // diverge in color instead of sharing one tint.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(palette(0.85 - 0.6 * u_hueFlow + u_specHue * 0.5), palette(0.6 - 0.6 * u_hueFlow + t * 0.03 + u_specHue * 0.5), 0.65);
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
    // Shockwave hue from the OWN bank palette (spectral-hue biased) mixed toward
    // a warm-white accent. Kick gain / drop scaling unchanged (luminance identical).
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * (u_arms + 1.0) + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  // ---- ANTICIPATION TICK: the final beat before a cut raises a faint charge
  // ring at the horizon (tension, no flash). Localized => photosafe.
  if (u_precut > 0.001) {
    float pre = exp(-pow((r - horizon * 1.6) * 14.0, 2.0));
    sky += mix(chargeColor, vec3(1.0), 0.4) * pre * u_precut * 0.35;
  }

  // Film grain.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade (whole frame leans toward the current bank's hue).
  // CONTRACTION: cap the whole-field grade multiplier at min(x, 0.99) so the
  // persistent field is never scaled by a sustained factor > 1.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  vec3 gradeMul = min(vec3(0.99), 0.4 + grade * 1.5);
  sky = mix(sky, sky * gradeMul, 0.24);
  // Buildups cool/dim, drops bloom (parent). The CUT-FLASH adds a moderate,
  // rate-limited brightness slam (<=1 per 4 bars — photosafe, not a strobe).
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
  { id: 'hueRate', label: 'hue flow rate', min: 0, max: 2.5, step: 0.05, default: 1 },
  { id: 'dye', label: 'dye contrast', min: 0, max: 1, step: 0.05, default: 0.8 },
];

// --- Song genome (JS-side, pattern g02-julia): a trackId hash seeds a stable
// look SEQUENCE. STRUCTURE (arms/ring/streak/lens/starTier/rot) stays genome-
// driven; only the palette bank is now MUSIC-CHOSEN (see decideBank).

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

/** A single discrete LOOK. Structure fields interpolate nothing — CUT to whole.
 * paletteBank is NO LONGER genome-derived; it is overridden by the music
 * decision each phrase (kept in the interface only for the section fallback). */
interface Look {
  paletteBank: number; // 0..5 (music-chosen; genome value is a fallback seed)
  armCount: number; // 2/3/5/7
  ringOn: number; // 0/1
  streakOn: number; // 0/1
  lensDir: number; // -1/+1
  starTier: number; // 0/1/2
  rotDir: number; // -1/+1
}

/** Derive a look's STRUCTURE from a per-index generator (stable given seed). */
function lookFrom(next: () => number): Look {
  return {
    paletteBank: Math.floor(next() * 6), // fallback only; music overrides
    armCount: ARM_CHOICES[Math.floor(next() * ARM_CHOICES.length)],
    ringOn: next() > 0.28 ? 1 : 0,
    streakOn: next() > 0.5 ? 1 : 0,
    lensDir: next() > 0.5 ? 1 : -1,
    starTier: Math.floor(next() * 3),
    rotDir: next() > 0.5 ? 1 : -1,
  };
}

/** The look STRUCTURE at a sequence index for a given seed. */
function lookAt(seed: number, index: number): Look {
  const next = splitmix(((Math.round(seed) | 0) ^ Math.imul(index | 0, 0x9e3779b9)) >>> 0);
  return lookFrom(next);
}

/**
 * THE MUSIC CHOOSES THE BANK. Quantize a phrase's windowed spectral fingerprint
 * into a 0..5 bank index: centroid TERCILE (0/1/2) x flatness HALF (0/1).
 *
 *   bank = tercile * 2 + flatHalf
 *     tercile 0 (dark)  flat 0 -> 0 EMBER   | flat 1 -> 3 MOSS
 *     tercile 1 (mid)   flat 0 -> 1 NEBULA  | flat 1 -> 4 AURORA (bank 4? see map)
 *     tercile 2 (bright)flat 0 -> 2 SOLAR   | flat 1 -> 5 UV
 *
 * The pal* order in the shader is EMBER,NEBULA,SOLAR,MOSS,AURORA,UV, so the
 * table below maps (tercile,flatHalf) -> the shader bank index for the intended
 * character. Deterministic: same fingerprint => same bank.
 */
function decideBank(centroidMean: number, flatnessMean: number): number {
  const tercile = centroidMean < 1 / 3 ? 0 : centroidMean < 2 / 3 ? 1 : 2;
  const flatHalf = flatnessMean >= 0.5 ? 1 : 0;
  // (tercile, flatHalf) -> shader bank index.
  //   dark/tonal -> EMBER(0), dark/noisy -> MOSS(3)
  //   mid/tonal  -> NEBULA(1), mid/noisy -> AURORA(4)
  //   bright/tonal -> SOLAR(2), bright/noisy -> UV(5)
  const MAP = [
    [0, 3], // dark
    [1, 4], // mid
    [2, 5], // bright
  ];
  return MAP[tercile][flatHalf];
}

/** Dominant audible deck's trackId (highest master-audible level); null when
 * unknown — then the slow spectral character is frozen as a pseudo-seed. */
function dominantTrackId(frame: VisualizerFrameData): number | null {
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

export const g14HardcutDyePreset: VisualizerPreset = {
  id: 'g14-hardcut-dye',
  name: 'g14 hardcut-dye',
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
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase so
    // dust hue follows spectral content without jerking on transients.
    let slowCentroid = 0.5;

    // --- QUANTIZED look grammar state (STRUCTURE is genome-driven).
    let seedKey: number | null = null;
    let lookIndex = 0;
    let current: Look = lookAt(1, 0);
    let lastPhraseIndex: number | null = null;
    let lastSectionIndex: number | null = null;
    let cutFlash = 0;
    let lastFlashPhrase = -999;

    // --- DYE state: accumulated hue-travel phase. RATE rides bandsSlow.mid
    // (+ a drop/energy kicker) — never instantaneous bands (motion law).
    let hueFlow = 0;

    // --- MUSIC-CHOSEN palette bank. Accumulate the CURRENT phrase's spectral
    // window; on a phrase boundary the just-completed window decides the bank
    // for the phrase we are entering. paletteBank holds the live (cut) value.
    let paletteBank = 0;
    let accCentroid = 0;
    let accFlatness = 0;
    let accCount = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        // motion: slow bands (erratic-motion law)
        const slow = frame.bandsSlow ?? frame.bands;
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

        // --- Identity: dominant trackId seeds the STRUCTURE sequence. Same song
        // = same structure sequence. No trackId => freeze slow spectral char.
        const trackId = dominantTrackId(frame);
        const key =
          trackId != null
            ? trackId
            : Math.round((frame.centroid * 331 + frame.spread * 271 + frame.flatness * 197) * 101);
        if (seedKey == null || key !== seedKey) {
          seedKey = key;
          const tb0 = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
          lookIndex = Math.floor(tb0 / PHRASE_BARS);
          current = lookAt(seedKey, lookIndex);
        }

        // --- Accumulate the CURRENT phrase's spectral fingerprint every frame.
        accCentroid += frame.centroid;
        accFlatness += frame.flatness ?? 0;
        accCount += 1;

        // --- CUT TIMING: ladder tier is primary (ladderBarIndex ?? barIndex).
        const tierBar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        const barPhase = frame.beat ? frame.beat.barPhase : 0;
        let precut = 0;

        if (tierBar !== null) {
          const phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          const sectionIndex = Math.floor(tierBar / SECTION_BARS);

          // HARD CUT on the exact downbeat of a new phrase — one frame, no ease.
          if (lastPhraseIndex !== null && phraseIndex !== lastPhraseIndex) {
            const sectionCut = lastSectionIndex !== null && sectionIndex !== lastSectionIndex;
            if (sectionCut) {
              // Section boundary: STRIDE the STRUCTURE sequence to a distant look.
              lookIndex += 3 + (Math.abs(sectionIndex) % 3);
            } else {
              lookIndex += 1;
            }
            current = lookAt(seedKey, lookIndex);

            // MUSIC CHOOSES THE BANK: quantize the PREVIOUS phrase's window.
            // Deterministic — same fingerprint => same bank.
            const cm = accCount > 0 ? accCentroid / accCount : 0.5;
            const fm = accCount > 0 ? accFlatness / accCount : 0.5;
            paletteBank = decideBank(cm, fm);
            // Reset the window for the phrase we now enter.
            accCentroid = 0;
            accFlatness = 0;
            accCount = 0;

            // DROP-ON-BOUNDARY SLAM (rate-limited to <=1 per phrase; photosafe).
            const landing = Math.max(drop, 0.6 * sustained);
            if (landing > 0.25 && phraseIndex - lastFlashPhrase >= 1) {
              cutFlash = Math.min(1, landing) * cutStrength;
              lastFlashPhrase = phraseIndex;
            }
          }
          lastPhraseIndex = phraseIndex;
          lastSectionIndex = sectionIndex;

          // Anticipation: the final beat of the phrase's last bar charges up.
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          if (barInPhrase === PHRASE_BARS - 1) {
            precut = Math.max(0, (barPhase - 0.75) / 0.25) * cutStrength;
          }
        } else {
          // Gridless: no hard cuts — hold the look and the last chosen bank.
          lastPhraseIndex = null;
          lastSectionIndex = null;
        }
        cutFlash = Math.max(0, cutFlash - dt / 0.5);

        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
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
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        // HUE FLOW: heavy mids sweep a full palette period in ~8 s; quiet
        // drifts ~60 s/period. Rate rides SLOW bands + max(drop, energy) —
        // motion smoothness law (no per-frame speed discontinuities).
        hueFlow +=
          dt *
          (0.015 + 0.1 * slow.mid + 0.05 * Math.max(drop, sustained)) *
          (frame.params.hueRate ?? 1);

        const tierGain = 0.35 + 0.55 * current.starTier;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_hueFlow: hueFlow,
          u_dye: frame.params.dye ?? 0.8,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          // rotation RATE on slow bands (erratic-motion law)
          u_rotStep:
            (0.05 + 0.5 * slow.mid + 0.5 * buildup + 0.25 * sustained) *
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
          // MUSIC-CHOSEN palette bank — integer, snaps on the phrase cut.
          u_palette: paletteBank,
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
          // --- The discrete STRUCTURE tuple (all snap on the cut).
          u_arms: current.armCount,
          u_ringOn: current.ringOn,
          u_streakOn: current.streakOn,
          u_lensDir: current.lensDir,
          u_starTier: current.starTier,
          u_precut: Math.min(1, precut),
          u_cutFlash: Math.min(1, cutFlash),
        };
      },
    });
  },
};

export default g14HardcutDyePreset;
