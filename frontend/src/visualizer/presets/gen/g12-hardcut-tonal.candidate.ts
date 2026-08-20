/**
 * g12-hardcut-tonal (gen-12 RESPONSIVENESS tweak of g09-hardcut-listen).
 *
 * Parent copied wholesale (post-sweep): the voyage-derived engine, the
 * QUANTIZED look grammar, the MUSIC-CHOSEN palette bank (centroid tercile x
 * flatness half -> 6 luminance-parity banks), the anticipation tick and the
 * drop-on-boundary slam. STRUCTURE stays genome-driven; the bank stays
 * audio-derived. What gen-12 adds is a TONALITY AXIS that changes the band's
 * whole CHARACTER — color breadth AND cut hardness follow what the music IS:
 *
 *   TONALITY DERIVATION (chameleon probe, verbatim mechanic): tonalEMA is a
 *   ~750ms EMA of (1 - flatness); we subtract a rolling percussive-transient
 *   density (impulse.low/mid rising-edge counted in a ~1s ring window),
 *   then a second ~0.6s slew so the pole never snaps -> u_tonal (0 perc .. 1
 *   tonal).
 *
 *   TONAL phrases (u_tonal -> 1): the bank draws from WIDE multi-hue families
 *   (the bank palette phase span opens up — several hue families on screen)
 *   and cuts arrive as FAST CROSSFADES (~250ms, still quantized to the phrase
 *   downbeat, slightly soft). u_cutMorph runs 0..1 over ~250ms on a cut so
 *   the palette blends between the outgoing and incoming bank.
 *
 *   PERCUSSIVE phrases (u_tonal -> 0): the bank collapses to MONOCHROME
 *   (single hue + black/white), cuts are SINGLE-FRAME HARD (no morph), and a
 *   1-BEAT ACCENT FLIP CASCADE runs: on each beat the monochrome tint
 *   inverts light<->dark in a stepping cascade across the frame (u_flipPhase
 *   steps per beat, u_flipAccent decays), so the percussive pole reads as a
 *   hard kinetic strobe of value, not a color show. The flip is a localized
 *   value swap on already-drawn structure (photosafe; not a full-field
 *   luminance strobe — rate-limited, and the mean luminance is preserved).
 *
 * Anticipation tick + drop slam stay (parent). Dust is BACK, diversified by
 * the music-chosen bank hue + per-star hash phase (parent already varies it).
 *
 * Standing law: docs/visualizer-ga.md — taste calibration, photosensitivity
 * floor, feedback contraction (whole-field grade capped at min(x,0.99); drop
 * drama in the fresh-injection term), MOTION SMOOTHNESS (rates ride
 * frame.bandsSlow ?? frame.bands), luminance-parity palettes. Phrase/section
 * via beat.ladderBarIndex ?? beat.barIndex.
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
uniform float u_centroid;
uniform float u_specHue;
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_dust;
uniform float u_palette;    // CURRENT (incoming) bank 0..5, music-chosen
uniform float u_palettePrev;// OUTGOING bank 0..5 (for the tonal crossfade)
uniform float u_charge;
uniform float u_spawnSnare;
uniform float u_arms;
uniform float u_ringOn;
uniform float u_streakOn;
uniform float u_lensDir;
uniform float u_starTier;
uniform float u_precut;
uniform float u_cutFlash;
// --- gen-12 tonality axis ---
uniform float u_tonal;      // 0 percussive/monochrome .. 1 tonal/multi-hue (slewed)
uniform float u_cutMorph;   // 0..1 tonal crossfade progress on a cut (fast, ~250ms)
uniform float u_monoHue;    // percussive-pole single tint hue
uniform float u_flipPhase;  // per-beat accent-flip cascade phase (perc pole)
uniform float u_flipAccent; // accent-flip strength (decays across the beat)

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

// The parent's SIX luminance-parity banks (music-chosen). Kept verbatim.
vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }  // EMBER
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }   // NEBULA violet
vec3 pal2(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }   // SOLAR gold
vec3 pal3(float t) { return vec3(0.16, 0.44, 0.34) + vec3(0.22, 0.42, 0.36) * cos(6.28318 * (vec3(0.8, 1.0, 0.9) * t + vec3(0.35, 0.15, 0.4))); }  // MOSS green/teal
vec3 pal4(float t) { return vec3(0.18, 0.42, 0.44) + vec3(0.3, 0.42, 0.46) * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * t + vec3(0.15, 0.35, 0.55))); } // AURORA teal
vec3 pal5(float t) { return vec3(0.4, 0.26, 0.5) + vec3(0.42, 0.34, 0.48) * cos(6.28318 * (vec3(0.85, 0.7, 1.0) * t + vec3(0.5, 0.2, 0.0))); }     // UV violet/white

vec3 bankColor(float b, float t) {
  float bb = floor(b + 0.5);
  vec3 c = pal0(t);
  c = bb > 0.5 ? pal1(t) : c;
  c = bb > 1.5 ? pal2(t) : c;
  c = bb > 2.5 ? pal3(t) : c;
  c = bb > 3.5 ? pal4(t) : c;
  c = bb > 4.5 ? pal5(t) : c;
  return c;
}

// PERCUSSIVE-POLE monochrome: one hue + black/white only. Highlights lean
// only partway to white so the pole never reads as white. Mean luminance
// comparable to the tonal banks (luminance-parity rule).
vec3 monoColor(float t, float hue) {
  // Value from the palette-travel coordinate so structure still reads.
  float lum = 0.42 + 0.34 * (0.5 + 0.5 * cos(6.28318 * (t + 0.15)));
  vec3 tint = 0.5 + 0.5 * cos(6.28318 * (vec3(1.0) * hue + vec3(0.0, 0.33, 0.67)));
  tint = mix(vec3(0.72), tint, 0.5);
  tint = mix(tint, vec3(1.0), 0.28 * pow(clamp(lum, 0.0, 1.0), 2.0));
  return tint * clamp(lum, 0.0, 1.0);
}

// THE PALETTE. At the tonal pole it is the music-chosen bank, crossfaded from
// the outgoing bank over u_cutMorph (fast soft cut). At the percussive pole it
// collapses to the monochrome tint. u_tonal blends the two poles (never a
// hard flip of the CHARACTER; the CUT is hard only at the perc pole via zero
// morph). WIDTH: the tonal bank sees a wider phase span (multi-hue) than the
// mono pole, achieved by the t coordinate passed by callers.
vec3 palette(float t) {
  // Tonal: crossfade outgoing->incoming bank (soft ~250ms cut).
  vec3 tonalCol = mix(bankColor(u_palettePrev, t), bankColor(u_palette, t), clamp(u_cutMorph, 0.0, 1.0));
  // Percussive: monochrome tint (hard cut = u_cutMorph pinned to 1 in JS).
  vec3 monoCol = monoColor(t, u_monoHue);
  vec3 c = mix(monoCol, tonalCol, clamp(u_tonal, 0.0, 1.0));
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
  // Distinct per-star hue phase (diversified dust) + the tonal-widened span.
  vec3 tint = palette(hash(sc.yx + 29.3) * (0.8 + 1.6 * u_tonal) + u_time * 0.02 + u_specHue * 0.5);
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

  // ---- Warp (parent, unchanged).
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
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12 * u_lensDir;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_cutFlash)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers (parent, palette() now carries the tonal character).
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
  vec3 gravityColor = palette(0.05 + t * 0.015 + u_specHue * 0.5);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * u_ringOn;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge) * u_ringOn;
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick) * u_streakOn;
  float arm = sin(ang * u_arms + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // Dust palette span WIDENS with tonality (multi-hue dust when tonal).
  vec3 diskColor = palette(cloudField * (0.6 + 1.5 * u_tonal) + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(palette(0.85 + u_specHue * 0.5), palette(0.6 + t * 0.03 + u_specHue * 0.5), 0.65);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
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

  if (u_precut > 0.001) {
    float pre = exp(-pow((r - horizon * 1.6) * 14.0, 2.0));
    sky += mix(chargeColor, vec3(1.0), 0.4) * pre * u_precut * 0.35;
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade (whole frame leans toward the current character's hue).
  // CONTRACTION: cap the whole-field grade multiplier at min(x, 0.99).
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  vec3 gradeMul = min(vec3(0.99), 0.4 + grade * 1.5);
  sky = mix(sky, sky * gradeMul, 0.24);
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup + 0.35 * u_cutFlash;

  // ---- PERCUSSIVE-POLE 1-BEAT ACCENT FLIP CASCADE. On each beat the value of
  // already-drawn structure inverts light<->dark in a cascade stepping across
  // the frame (u_flipPhase steps per beat). Localized VALUE swap (a spatial
  // mask, mean-preserving), gated by the percussive pole + decaying accent, so
  // it reads as a hard kinetic strobe of contrast — not a full-field luminance
  // flash (photosafe). Only meaningful when u_tonal is low.
  float percW = 1.0 - clamp(u_tonal, 0.0, 1.0);
  if (percW * u_flipAccent > 0.001) {
    // Cascade front sweeps radially outward as the beat's flip phase advances.
    float front = fract(u_flipPhase);
    float band = smoothstep(0.14, 0.0, abs(r - front * 1.5));
    float luma = dot(sky, vec3(0.299, 0.587, 0.114));
    vec3 mono = monoColor(0.5 + 0.5 * sin(ang * 3.0 + u_flipPhase), u_monoHue);
    // Inverted value target (light<->dark swap), tinted mono so it stays in
    // the percussive palette. Mix bounded by the accent + band mask.
    vec3 flipped = mono * (1.0 - clamp(luma * 1.4, 0.0, 1.0)) + sky * clamp(luma, 0.0, 1.0) * 0.3;
    sky = mix(sky, flipped, band * percW * clamp(u_flipAccent, 0.0, 0.85));
  }

  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const params: PresetParam[] = [
  { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  { id: 'tonalBias', label: 'tonality bias (perc↔tonal)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
  { id: 'cutStrength', label: 'cut drama', min: 0, max: 2, step: 0.05, default: 1 },
];

// --- Song genome (parent): trackId -> stable STRUCTURE sequence.
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

interface Look {
  paletteBank: number;
  armCount: number;
  ringOn: number;
  streakOn: number;
  lensDir: number;
  starTier: number;
  rotDir: number;
}

function lookFrom(next: () => number): Look {
  return {
    paletteBank: Math.floor(next() * 6),
    armCount: ARM_CHOICES[Math.floor(next() * ARM_CHOICES.length)],
    ringOn: next() > 0.28 ? 1 : 0,
    streakOn: next() > 0.5 ? 1 : 0,
    lensDir: next() > 0.5 ? 1 : -1,
    starTier: Math.floor(next() * 3),
    rotDir: next() > 0.5 ? 1 : -1,
  };
}

function lookAt(seed: number, index: number): Look {
  const next = splitmix(((Math.round(seed) | 0) ^ Math.imul(index | 0, 0x9e3779b9)) >>> 0);
  return lookFrom(next);
}

/** MUSIC CHOOSES THE BANK (parent): centroid tercile x flatness half -> 0..5. */
function decideBank(centroidMean: number, flatnessMean: number): number {
  const tercile = centroidMean < 1 / 3 ? 0 : centroidMean < 2 / 3 ? 1 : 2;
  const flatHalf = flatnessMean >= 0.5 ? 1 : 0;
  const MAP = [
    [0, 3],
    [1, 4],
    [2, 5],
  ];
  return MAP[tercile][flatHalf];
}

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

export const g12HardcutTonalPreset: VisualizerPreset = {
  id: 'g12-hardcut-tonal',
  name: 'g12 hardcut-tonal',
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
    let slowCentroid = 0.5;

    let seedKey: number | null = null;
    let lookIndex = 0;
    let current: Look = lookAt(1, 0);
    let lastPhraseIndex: number | null = null;
    let lastSectionIndex: number | null = null;
    let cutFlash = 0;
    let lastFlashPhrase = -999;

    let paletteBank = 0;
    let palettePrev = 0;
    let accCentroid = 0;
    let accFlatness = 0;
    let accCount = 0;

    // --- gen-12 tonality axis (chameleon probe mechanic).
    let tonalEMA = 0.5;
    let tonality = 0.5;
    const HITS = 24;
    const hitTimes: number[] = [];
    let prevKick = 0;
    let prevSnare = 0;

    // --- cut morph: TONAL cuts crossfade over ~250ms; PERCUSSIVE cuts are
    // single-frame hard (morph pinned to 1 instantly).
    let cutMorph = 1;
    let monoHue = Math.random();

    // --- percussive-pole 1-beat accent flip cascade.
    let prevBeatInBar: number | null = null;
    let flipPhase = 0;
    let flipAccent = 0;
    let freeBeatPhase = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const slow = frame.bandsSlow ?? frame.bands;
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const cutStrength = frame.params.cutStrength ?? 1;
        const tonalBias = frame.params.tonalBias ?? 0;

        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);

        // --- TONALITY (chameleon): EMA(~750ms) of (1 - flatness) minus a
        // rolling ~1s impulse-density window (rising-edge counted), + a second
        // ~0.6s slew so the pole never snaps.
        const emaAlpha = 1 - Math.exp(-dt / 0.75);
        tonalEMA += ((1 - frame.flatness) - tonalEMA) * emaAlpha;
        const kick = frame.impulse.low;
        const snare = frame.impulse.mid;
        if (kick > 0.32 && prevKick <= 0.32) hitTimes.push(frame.time);
        if (snare > 0.28 && prevSnare <= 0.28) hitTimes.push(frame.time);
        prevKick = kick;
        prevSnare = snare;
        while (hitTimes.length && frame.time - hitTimes[0] > 1.0) hitTimes.shift();
        while (hitTimes.length > HITS) hitTimes.shift();
        const density = Math.min(1, hitTimes.length / 6);
        const tonalTarget = Math.min(1, Math.max(0, tonalEMA - density * 0.55 + tonalBias));
        tonality += (tonalTarget - tonality) * (1 - Math.exp(-dt / 0.6));

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

        accCentroid += frame.centroid;
        accFlatness += frame.flatness ?? 0;
        accCount += 1;

        const tierBar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        const barPhase = frame.beat ? frame.beat.barPhase : 0;
        let precut = 0;

        if (tierBar !== null) {
          const phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          const sectionIndex = Math.floor(tierBar / SECTION_BARS);

          if (lastPhraseIndex !== null && phraseIndex !== lastPhraseIndex) {
            const sectionCut = lastSectionIndex !== null && sectionIndex !== lastSectionIndex;
            if (sectionCut) {
              lookIndex += 3 + (Math.abs(sectionIndex) % 3);
            } else {
              lookIndex += 1;
            }
            current = lookAt(seedKey, lookIndex);

            const cm = accCount > 0 ? accCentroid / accCount : 0.5;
            const fm = accCount > 0 ? accFlatness / accCount : 0.5;
            palettePrev = paletteBank;
            paletteBank = decideBank(cm, fm);
            accCentroid = 0;
            accFlatness = 0;
            accCount = 0;
            // Also re-roll the percussive monochrome tint on the cut.
            monoHue = Math.random();

            // TONAL cut = fast soft crossfade (~250ms). PERCUSSIVE cut =
            // single-frame HARD (morph starts and stays at 1).
            cutMorph = tonality > 0.45 ? 0 : 1;

            const landing = Math.max(drop, 0.6 * sustained);
            if (landing > 0.25 && phraseIndex - lastFlashPhrase >= 1) {
              cutFlash = Math.min(1, landing) * cutStrength;
              lastFlashPhrase = phraseIndex;
            }
          }
          lastPhraseIndex = phraseIndex;
          lastSectionIndex = sectionIndex;

          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          if (barInPhrase === PHRASE_BARS - 1) {
            precut = Math.max(0, (barPhase - 0.75) / 0.25) * cutStrength;
          }
        } else {
          lastPhraseIndex = null;
          lastSectionIndex = null;
        }
        // Fast crossfade progress (~250ms). Hard cuts leave it pinned at 1.
        cutMorph = Math.min(1, cutMorph + dt / 0.25);
        cutFlash = Math.max(0, cutFlash - dt / 0.5);

        // --- PERCUSSIVE-POLE 1-BEAT ACCENT FLIP CASCADE. Advance the cascade
        // phase every beat; the accent kicks to 1 on the beat and decays over
        // the beat (rate-limited by beat spacing => photosafe).
        let beatCrossed = false;
        let beatInBar = 0;
        if (frame.beat) {
          beatInBar = frame.beat.beatInBar;
          if (prevBeatInBar !== null && beatInBar !== prevBeatInBar) beatCrossed = true;
          prevBeatInBar = beatInBar;
        } else {
          const prev = freeBeatPhase;
          freeBeatPhase += dt * (120 / 60);
          if (Math.floor(freeBeatPhase) !== Math.floor(prev)) beatCrossed = true;
        }
        if (beatCrossed) {
          flipPhase += 1;
          // Only meaningful at the percussive pole; strength scales with kick.
          flipAccent = Math.min(0.85, (0.5 + 0.5 * kick)) * (1 - tonality);
        }
        // Cascade sweeps across the beat; accent decays.
        flipPhase += dt * 1.2;
        flipAccent = Math.max(0, flipAccent - dt / 0.28);

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
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));

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
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          u_rotStep:
            (0.05 + 0.5 * slow.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt * current.rotDir,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_palette: paletteBank,
          u_palettePrev: palettePrev,
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              tierGain *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) *
              tierGain *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_arms: current.armCount,
          u_ringOn: current.ringOn,
          u_streakOn: current.streakOn,
          u_lensDir: current.lensDir,
          u_starTier: current.starTier,
          u_precut: Math.min(1, precut),
          u_cutFlash: Math.min(1, cutFlash),
          u_tonal: tonality,
          u_cutMorph: cutMorph,
          u_monoHue: monoHue,
          u_flipPhase: flipPhase,
          u_flipAccent: flipAccent,
        };
      },
    });
  },
};

export default g12HardcutTonalPreset;
