/**
 * g12-shards-tonal (gen-12 tweak of g09-shards-prism — the human's own idea).
 *
 * Human note (verbatim): "very cool colors and patterns! could be cool with
 * spectrum reactiveness (more tonality = more colors?)".
 *
 * Parent copied wholesale (post-sweep): one central organic form whose
 * MATERIAL is the spectral shape, 24-band spectrum sculpture, deck EQ region
 * kills, trackId song genome, phrase growth, section metamorphosis, solid kick
 * pressure waves, prismatic glass-shard snare ejection, drop full-spectrum
 * fan, u_spectrum[24] in lockstep. The near-monochrome stone surface stays.
 *
 * ONE thing is added: TONALITY -> SHARD COLOR-COUNT (a color BUDGET), quantized
 * on BAR boundaries so the change reads musically:
 *
 *   TONALITY DERIVATION (chameleon probe, verbatim mechanic): tonalEMA is a
 *   ~750ms EMA of (1 - flatness) minus a rolling ~1s impulse-density window
 *   (impulse.low/mid rising-edge counted), + a ~0.6s slew. tonality 0..1.
 *
 *   COLOR BUDGET (quantized steps, latched on bar boundaries):
 *     tonality  0.00..~ : 1  -> ALL shards MONOCHROME (one steel hue)
 *               rising  : 2 -> 4 -> 8 -> 24 (full spectrum)
 *   The budget only CHANGES on a bar boundary (beat.ladderBarIndex ?? barIndex)
 *   so it steps musically, never mid-bar flicker.
 *
 *   SHARD HUE QUANTIZATION: a snare volley's hue (the loudest band's fixed
 *   hue) is SNAPPED to the nearest of `budget` evenly-spaced hues (at budget 1
 *   it snaps to the single steel hue). The drop FAN honors the same budget:
 *   each of the 24 blades' hue is snapped to the budget, so at budget 1 the
 *   fan is a monochrome steel fan and at budget 24 it is the full parent
 *   rainbow. Chromatic dispersion within a shard is scaled DOWN toward the
 *   monochrome pole (a steel shard doesn't split into a prism).
 *
 * Standing law: docs/visualizer-ga.md — photosensitivity floor, feedback
 * contraction (fresh injection bounded by (1 - decay); whole-field grades not
 * used > 1), MOTION SMOOTHNESS (churn rides bandsSlow.mid), luminance-parity.
 * Chroma-preserving soft knee. Phrase/section via ladderBarIndex ?? barIndex.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

// fringe fix: deterministic per-track hue anchor (dust-v3 idiom). splitmix64
// style bit mix folded to [0,1) so track ids land on distinct hues.
const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};


const SPECTRUM_BANDS = 24;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;
uniform float u_material;
uniform float u_phrase;
uniform float u_section;
uniform float u_flip;
uniform float u_drop;
uniform float u_buildup;
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_flow;
uniform float u_swell;
uniform float u_grain;
uniform float u_glass;
uniform float u_bar;
uniform float u_rebirth;
uniform float u_symmetry;
uniform float u_gSculpt;
uniform float u_eqLow;
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_shardAge;
uniform float u_shardAmp;
uniform float u_shardAng;
uniform float u_shardHue;    // snare volley hue, ALREADY snapped to the budget (JS)
uniform float u_shards;
uniform float u_fan;
uniform float u_spectrum[24];
// --- gen-12 tonality -> color budget ---
uniform float u_budget;      // integer color count {1,2,4,8,24}, latched on bars
uniform float u_steelHue;    // the single monochrome hue (percussive pole)
uniform float u_tonal;       // 0 percussive .. 1 tonal (for dispersion scaling)

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
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.02 + vec2(19.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

float bandHue(float fb) {
  return 0.02 + (fb / 23.0) * 0.83;
}

// COLOR-BUDGET quantizer: snap a hue to one of u_budget evenly-spaced hues. At
// budget 1 EVERYTHING collapses to the steel hue (monochrome pole). At budget
// 24 it is (near) continuous — the parent rainbow. Between, discrete palettes.
float quantHue(float hue) {
  float b = max(1.0, floor(u_budget + 0.5));
  if (b <= 1.5) return u_steelHue;
  float idx = floor(fract(hue) * b + 0.5);
  return fract(idx / b);
}

// Saturation follows the budget too: monochrome pole is near-gray steel.
float budgetSat(float base) {
  float b = max(1.0, floor(u_budget + 0.5));
  float tonalW = clamp((b - 1.0) / 23.0, 0.0, 1.0);
  // Steel = low saturation; more colors = more saturation.
  return mix(0.12, base, clamp(0.25 + 0.75 * tonalW + 0.4 * u_tonal, 0.0, 1.0));
}

float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float order = u_symmetry + fb * 0.75;
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    float fall = 1.0 / (1.0 + fb * 0.35);
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * sin(ang * order + ph);
  }
  return disp;
}

vec3 stonePalette(float shade, float temp) {
  vec3 cool = vec3(0.30, 0.34, 0.40);
  vec3 warm = vec3(0.42, 0.37, 0.31);
  vec3 base = mix(cool, warm, clamp(temp, 0.0, 1.0));
  return base * (0.35 + 0.65 * shade);
}

uniform float u_hueRot; // fringe fix: per-song hue anchor + slow spectral travel, TURNS 0..1

// fringe fix: value-preserving hue ROTATION in YIQ chroma-plane (dust-v3
// idiom). rot is in TURNS; luminance (Y) is untouched by construction.
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

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);

  float mat = clamp(u_material, 0.0, 1.0);

  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_midSlow);

  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_gSculpt; // fringe amount rides the dust param (human note)
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
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.6 + 0.7 * u_phrase);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * u_phrase);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // NEAR-MONOCHROME STONE SURFACE (parent, unchanged).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = stonePalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.72, 0.76, 0.82), vec3(0.86, 0.82, 0.74), temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = stonePalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.55, 0.6, 0.68), vec3(0.9, 0.85, 0.7), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  vec3 burstCol = mix(stonePalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += stonePalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // ---- PRISMATIC GLASS SHARDS (snare volley). The shard hue is ALREADY
  // snapped to the color budget (u_shardHue, JS-side). Chromatic dispersion
  // is scaled DOWN toward the monochrome pole (u_tonal) so a steel shard does
  // not split into a prism; a tonal shard fans into its budgeted spectrum.
  float shardGate = clamp(0.35 * u_mid + 0.65 * u_high, 0.0, 1.0);
  if (u_shardAmp * shardGate > 0.02) {
    float travel = u_shardAge * 0.9;
    float settle = exp(-u_shardAge * 2.4);
    float ejectR = formR * 1.05 + travel * settle * 1.6;
    float rel = ang - u_shardAng;
    float facets = pow(0.5 + 0.5 * cos(rel * (9.0 + 14.0 * u_high)), 6.0);
    float fan = exp(-pow(rel, 2.0) * 1.6);
    float radPos = clamp((r - ejectR) * 22.0, -1.5, 1.5);
    float shell = exp(-radPos * radPos);
    float shard = shell * facets * (0.35 + 0.65 * fan);
    // Dispersion span scales with tonality (0 at the monochrome pole).
    float dispSpan = 0.12 * clamp(0.15 + 0.85 * u_tonal, 0.0, 1.0);
    // Keep the dispersed edges inside the SAME budget by re-quantizing.
    float dispHue = quantHue(u_shardHue + radPos * dispSpan + 1.0);
    float grit = hash(gl_FragCoord.xy + fract(u_shardAge * 7.0) * 173.0);
    float shardSat = budgetSat(clamp(0.75 + 0.2 * u_high, 0.0, 0.99));
    vec3 shardCol = hsv2rgb(vec3(dispHue, shardSat, 0.55 + 0.45 * shell))
      * (mat > 0.5 ? (0.4 + 0.6 * grit) : 1.0);
    float shardE = u_shardAmp * shardGate * u_shards * settle;
    field += shardCol * shard * shardE * 1.5;
  }

  // ---- DROP FULL-SPECTRUM FAN — honors the CURRENT COLOR BUDGET. Each blade's
  // hue is snapped to the budget, so at budget 1 the fan is a monochrome steel
  // fan and at budget 24 it is the full parent rainbow. Envelope bounded by
  // (1 - decay) (contraction).
  if (u_fan > 0.05) {
    float phase0 = fract(u_seed * 0.01) * 6.28318;
    float fanR = formR * 1.08 + u_fan * 0.35 + 0.06 * sin(t * 2.0);
    vec3 fanCol = vec3(0.0);
    for (int b = 0; b < 24; b++) {
      float fb = float(b);
      float bAng = (fb / 24.0) * 6.28318 + phase0;
      float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
      float gate = clamp(g, 0.0, 1.0);
      float loud = u_spectrum[b] * gate;
      float relB = ang - bAng;
      relB = relB - 6.28318 * floor(relB / 6.28318 + 0.5);
      float blade = exp(-relB * relB * 60.0);
      float shell = exp(-pow((r - fanR) * 16.0, 2.0));
      float hue = quantHue(bandHue(fb));      // budget-quantized blade hue
      float sat = budgetSat(0.95);
      fanCol += hsv2rgb(vec3(hue, sat, 1.0)) * blade * shell * (0.2 + 0.9 * loud);
    }
    field += fanCol * u_fan * (1.0 - u_decay) * (2.5 + 1.5 * u_drop) * u_shards;
  }

  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;
  field *= 0.82 + 0.36 * max(u_drop, u_swell) + 0.12 * u_buildup;

  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 16;

function splitmix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) / 4294967296;
}

function genomeOf(seed: number): [number, number, number, number] {
  let s = Math.floor(seed) | 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x6d2b79f5) | 0;
    out.push(splitmix(s + i * 0x2545f491));
  }
  return [out[0], out[1], out[2], out[3]];
}

function bandHue(bandIdx: number): number {
  return 0.02 + (bandIdx / 23) * 0.83;
}

// Tonality -> color budget (quantized steps). 1 -> 2 -> 4 -> 8 -> 24.
function budgetFor(tonality: number): number {
  if (tonality < 0.2) return 1;
  if (tonality < 0.4) return 2;
  if (tonality < 0.6) return 4;
  if (tonality < 0.8) return 8;
  return 24;
}

// Snap a hue to one of `budget` evenly-spaced hues (JS mirror of quantHue).
function quantHue(hue: number, budget: number, steelHue: number): number {
  if (budget <= 1) return steelHue;
  const h = ((hue % 1) + 1) % 1;
  const idx = Math.round(h * budget) % budget;
  return idx / budget;
}

export const g12ShardsTonalPreset: VisualizerPreset = {
  id: 'g12-shards-tonal',
  name: 'g12 shards-tonal',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'shards', label: 'prism shards', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'tonalBias', label: 'tonality bias (perc↔tonal)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'growth', label: 'phrase growth', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    // fringe fix: per-song hue anchor state (dust-v3 idiom) for u_hueRot.
    let fringeCentroid = 0.5;
    let fringeAnchor = 0;
    let fringeAnchorTarget = 0;
    let fringeAnchorTrack: number | null = null;
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let flow = 0;
    let smoothMaterial = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSwell = 0;
    let section = 0;
    let flip = 0;
    let lastPhraseIndex = -1;
    let shardAge = 999;
    let shardAmp = 0;
    let shardAng = 0;
    let shardHue = 0;
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1;
    let seeded = false;
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    // --- gen-12 tonality axis (chameleon probe) + latched color budget.
    let tonalEMA = 0.5;
    let tonality = 0.5;
    const HITS = 24;
    const hitTimes: number[] = [];
    let prevKick = 0;
    let prevSnare = 0;
    // Color budget, latched on bar boundaries. Steel hue = the single mono hue.
    let colorBudget = 1;
    let lastBudgetBar: number | null = null;
    const STEEL_HUE = 0.58; // cool steel/slate

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const grow = frame.params.growth ?? 1;
        const bias = frame.params.material ?? 0;
        const tonalBias = frame.params.tonalBias ?? 0;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        let dom: (typeof frame.decks)[number] | null =
          frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        if (dom === null) {
          for (const d of frame.decks) {
            if (d.playing && (dom === null || d.level > dom.level)) dom = d;
          }
        }

        const rawMaterial = Math.min(
          1,
          Math.max(0, 0.6 * frame.flatness + 0.4 * frame.spread + bias + (genome[1] - 0.5) * 0.3)
        );
        smoothMaterial += (rawMaterial - smoothMaterial) * smoothAlpha;

        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const swellTarget = Math.min(1, (frame.bands.low + frame.bands.mid) * 0.7 + smoothDrop * 0.4);
        smoothSwell += (swellTarget - smoothSwell) * (1 - Math.exp(-dt / 0.5));

        // --- TONALITY (chameleon): EMA(~750ms) of (1 - flatness) minus a
        // rolling ~1s impulse-density window, + a ~0.6s slew.
        const emaAlpha = 1 - Math.exp(-dt / 0.75);
        tonalEMA += ((1 - frame.flatness) - tonalEMA) * emaAlpha;
        const kickI = frame.impulse.low;
        const snareI = frame.impulse.mid;
        if (kickI > 0.32 && prevKick <= 0.32) hitTimes.push(frame.time);
        if (snareI > 0.28 && prevSnare <= 0.28) hitTimes.push(frame.time);
        prevKick = kickI;
        prevSnare = snareI;
        while (hitTimes.length && frame.time - hitTimes[0] > 1.0) hitTimes.shift();
        while (hitTimes.length > HITS) hitTimes.shift();
        const density = Math.min(1, hitTimes.length / 6);
        const tonalTarget = Math.min(1, Math.max(0, tonalEMA - density * 0.55 + tonalBias));
        tonality += (tonalTarget - tonality) * (1 - Math.exp(-dt / 0.6));

        const flowSpeed = frame.beat?.bpm
          ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8
          : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * smoothMaterial);

        let phrase = 0;
        let phraseIndex = lastPhraseIndex;
        let bar = 0;
        // Bar ordinal for BOTH phrase growth and the budget latch.
        let barOrdinal: number | null = null;
        if (frame.beat) {
          const tierBar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          barOrdinal = tierBar;
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          bar = Math.pow(1 - frame.beat.barPhase, 2.4);
        } else {
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
          bar = 0.5 - 0.5 * Math.cos(frame.time * 1.4);
        }
        phrase = Math.min(1, phrase * grow);

        // --- COLOR BUDGET latched on BAR boundaries (steps musically).
        if (barOrdinal !== null) {
          if (lastBudgetBar === null || barOrdinal !== lastBudgetBar) {
            colorBudget = budgetFor(tonality);
            lastBudgetBar = barOrdinal;
          }
        } else {
          // Gridless: update budget slowly so it still tracks tonality.
          colorBudget = budgetFor(tonality);
        }

        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          section = 1;
          flip = -flip || 1;
        }
        lastPhraseIndex = phraseIndex;
        section = Math.max(0, section - dt / 1.1);

        const trackId = dom?.trackId ?? null;
        const seedKey =
          trackId !== null
            ? trackId
            : Math.floor(
                (frame.centroid * 331 + frame.spread * 271 + frame.flatness * 197) * 101
              );
        if (!seeded) {
          currentSeed = seedKey;
          genome = genomeOf(seedKey);
          rebirth = 1;
          seeded = true;
        } else if (seedKey !== currentSeed) {
          currentSeed = seedKey;
          genome = genomeOf(seedKey);
          rebirth = 0;
        }
        rebirth = Math.min(1, rebirth + dt / 2.0);

        const eqAlpha = 1 - Math.exp(-dt / 0.15);
        eqLow += ((dom?.eq.low ?? 0.5) - eqLow) * eqAlpha;
        eqMid += ((dom?.eq.mid ?? 0.5) - eqMid) * eqAlpha;
        eqHigh += ((dom?.eq.high ?? 0.5) - eqHigh) * eqAlpha;

        const srcSpec = frame.spectrum;
        let loudIdx = 0;
        let loudVal = -1;
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const v = i < srcSpec.length ? Math.min(1, Math.max(0, srcSpec[i])) : 0;
          spectrum[i] = v;
          if (v > loudVal) {
            loudVal = v;
            loudIdx = i;
          }
        }

        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        shardAge += dt;
        const shardTrig = Math.max(frame.impulse.mid, frame.impulse.high * 0.85);
        if (shardTrig > 0.12 && shardAge > 0.09) {
          shardAge = 0;
          shardAmp = Math.min(1, shardTrig * 1.3);
          const phase0 = ((genome[3] * 100 * 0.01) % 1) * Math.PI * 2;
          shardAng = (loudIdx / SPECTRUM_BANDS) * Math.PI * 2 + phase0;
          // SNAP the volley hue to the current color budget (JS mirror).
          shardHue = quantHue(bandHue(loudIdx), colorBudget, STEEL_HUE);
        }

        const symmetry = 3 + Math.floor(genome[0] * 7);

        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.99 - 0.008 * energy - 0.006 * smoothBuildup - 0.004 * smoothMaterial;

        const fanDrive = Math.min(1, Math.max(smoothDrop, energy));

        // fringe fix: per-song hue anchor (splitmix of the dominant deck
        // trackId, ~2s eased) + slow spectral travel -- steers the feedback
        // fringe hue (see hueRotate in the fragment).
        fringeCentroid += (frame.centroid - fringeCentroid) * (1 - Math.exp(-dt / 1.0));
        let fringeDomTrack: number | null = null;
        let fringeDomLevel = -1;
        for (const d of frame.decks) {
          if (d.level > fringeDomLevel) {
            fringeDomLevel = d.level;
            fringeDomTrack = d.trackId;
          }
        }
        if (fringeDomTrack !== null && fringeDomTrack !== fringeAnchorTrack) {
          fringeAnchorTrack = fringeDomTrack;
          fringeAnchorTarget = splitmix01(fringeDomTrack);
        }
        fringeAnchor += (fringeAnchorTarget - fringeAnchor) * (1 - Math.exp(-dt / 2.0));
        const fringeHueRot = (((fringeAnchor + (fringeCentroid - 0.5) * 0.8) % 1) + 1) % 1;
        return {
          u_hueRot: fringeHueRot,
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_midSlow: (frame.bandsSlow ?? frame.bands).mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_material: smoothMaterial,
          u_phrase: phrase,
          u_section: Math.max(0, Math.min(1, section)),
          u_flip: flip || 1,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_decay: Math.min(0.997, 1 - (1 - baseDecay)),
          u_seed: genome[3] * 100,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_flow: flow,
          u_swell: smoothSwell,
          u_grain: 1,
          u_glass: 1,
          u_bar: bar,
          u_rebirth: rebirth,
          u_symmetry: symmetry,
          u_gSculpt: (frame.params.sculpt ?? 1) * (0.6 + 0.8 * genome[2]),
          u_eqLow: eqLow,
          u_eqMid: eqMid,
          u_eqHigh: eqHigh,
          u_shardAge: shardAge,
          u_shardAmp: shardAmp,
          u_shardAng: shardAng,
          u_shardHue: shardHue,
          u_shards: frame.params.shards ?? 1,
          u_fan: fanDrive,
          u_spectrum: spectrum,
          u_budget: colorBudget,
          u_steelHue: STEEL_HUE,
          u_tonal: tonality,
        };
      },
    });
  },
};

export default g12ShardsTonalPreset;
