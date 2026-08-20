/**
 * g08-materia-eqmap (gen-8 TWEAK of g03-materia-deep, the pool leader 1072).
 *
 * A spectrum-mapping study: keeps materia-deep's engine WHOLESALE (spectrum
 * sculpture, deck EQ region kills, song genome, kick pressure wave, section
 * metamorphosis, chroma-preserving soft knee) and LAYERS a second, GLOBAL EQ
 * behavior on top of the parent's per-region kills. The two EQ mappings coexist
 * and each stays legible:
 *
 *   PARENT (per-region kills, unchanged): the dominant deck's low/mid/high EQ
 *   knobs gate WHICH bands of the 24-band relief contribute — killing low
 *   flattens the big lobes, killing mid the mid ripples, killing high the fine
 *   stipple. This CARVES the sculpture band-by-band.
 *
 *   NEW (strict global split, this candidate): the same three knobs ALSO drive
 *   three GLOBAL material PROPERTIES of the whole form, one property each —
 *     LOWS  -> RELIEF MASS. Bass energy (band low, scaled by eqLow) sets the
 *              form's height scale + base thickness. Kill low and the sculpture
 *              visibly DEFLATES to a flat bas-relief; heavy bass extrudes it
 *              into a tall massive body.
 *     MIDS  -> SURFACE COLOR. Mid content (band mid, scaled by eqMid) drives the
 *              palette hue travel + warmth. Kill mid and the surface goes GRAY
 *              STONE (desaturated); rich mids give a saturated, warm-shifted hue.
 *     HIGHS -> MICRO-TEXTURE. Treble (band high, scaled by eqHigh) drives grain
 *              density, sparkle, and facet crispness. Kill high and the surface
 *              becomes POLISHED SMOOTH; rich highs stipple it with crisp glints.
 *   These are GLOBAL scalars applied to the whole form, distinct from the
 *   band-selective region kills — a low kill both flattens the low lobes (parent)
 *   AND deflates the whole mass (new); both readable at once.
 *
 * Kick pressure wave + drop luminosity ride max(drop, energy) as in the parent.
 * Beat: a soft integer counter tips the primary light direction ONE notch per
 * beat (readable, cheap) — the specular/rim highlight walks around the form on
 * the grid; between beats it eases toward the current notch, never interpolating
 * the notch itself.
 *
 * Photosensitivity floor respected (no saturated-red strobe, gated flashes,
 * localized pulses). u_spectrum EXACTLY length 24, in lockstep with the parent.
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
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign (drifts -1..1 across sections)
uniform float u_drop;       // excitement with bass
uniform float u_buildup;    // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;  // seconds since last strong kick
uniform float u_rippleAmp;  // that kick's strength
uniform float u_flow;       // liquid inner-flow phase
uniform float u_swell;      // sustained loudness, form size
uniform float u_grain;      // sand-grain gain slider
uniform float u_glass;      // glass-caustic gain slider
uniform float u_bar;        // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;    // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;   // genome: base lobe count bias 3..9
uniform float u_gSculpt;    // sculpt gain slider
uniform float u_eqLow;      // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
// --- STRICT GLOBAL SPLIT (this candidate; layered on the region kills).
uniform float u_massLow;    // 0..1 global RELIEF MASS from lows (height + base)
uniform float u_colorMid;   // 0..1 global SURFACE COLOR richness from mids
uniform float u_textHigh;   // 0..1 global MICRO-TEXTURE from highs
uniform float u_lightAng;   // eased primary-light angle (walks one notch/beat)
uniform float u_spectrum[24];

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

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed (0.0), 1 = boosted.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE (parent): sum the 24 bands as angular harmonics, low bins
// = few large lobes, high bins = many fine ripples, each region-gated by the
// deck EQ (WHICH bands survive). The GLOBAL relief MASS (u_massLow) then scales
// the whole displacement field — lows drive overall height on top of the kills.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float order = u_symmetry + fb * 0.75;
    // Region gate: low third -> eqLow, mid third -> eqMid, top third -> eqHigh.
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    float fall = 1.0 / (1.0 + fb * 0.35);
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * sin(ang * order + ph);
  }
  // GLOBAL RELIEF MASS: lows extrude the whole field; a low kill deflates it to
  // a shallow bas-relief (never fully zero so the silhouette survives).
  return disp * (0.28 + 1.35 * u_massLow);
}

// Temperature palette (parent): cold indigo/teal .. hot amber/white, wide-phase
// cosine so the tint TRAVELS with the surface field.
vec3 tempPalette(float t, float temp) {
  vec3 cold = vec3(0.18, 0.5, 0.95) + vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hot = vec3(1.0, 0.62, 0.18) + vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// SURFACE COLOR from mids (this candidate): mids drive palette hue TRAVEL +
// warmth; a mid kill collapses toward GRAY STONE (luminance-preserving desat).
vec3 midColor(float f, float temp) {
  // Mids widen the palette's phase span (hue travels farther) and warm-shift it.
  float travel = f * (0.6 + 0.9 * u_colorMid);
  float warm = clamp(temp + 0.35 * u_colorMid, 0.0, 1.0);
  vec3 col = tempPalette(travel, warm);
  // Mid kill -> gray stone: fold toward luminance. Rich mids keep full chroma.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 stone = mix(vec3(lum), vec3(0.34, 0.33, 0.31) + 0.4 * lum, 0.5);
  return mix(stone, col, clamp(0.15 + 0.95 * u_colorMid, 0.0, 1.0));
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

  // ---- Warp / advection of the accumulated material.
  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_mid);

  // Localized lens swirl inside the core radius — glass refraction hint.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — a solid displacement front that lights.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section transform: a violent radial inversion pulse — space folds.
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass chromatic split; sand dry. Unsharp tap.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_glass; // fringe amount rides the dust param (human note)
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
  // MICRO-TEXTURE from highs also sharpens the feedback tap (facet crispness):
  // polished-smooth when highs are killed, crisp/embossed when highs are rich.
  float sharp = mix(1.4, 1.12, mat) + 0.25 * u_textHigh;
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form.
  // GLOBAL RELIEF MASS (lows): base thickness of the body grows with u_massLow;
  // a low kill shrinks the base so the form reads as a thin bas-relief.
  float baseThick = 0.16 + 0.14 * u_massLow;
  float formR = baseThick + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.6 + 0.7 * u_phrase);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  // SPECTRUM SCULPTURE: the 24-band displacement field (mass-scaled by lows).
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * u_phrase);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // BEAT-STEPPED LIGHTING: the primary light direction is u_lightAng (walks one
  // notch/beat). Faces of the relief pointing toward the light catch more.
  vec2 lightDir = vec2(cos(u_lightAng), sin(u_lightAng));
  float facing = 0.5 + 0.5 * dot(dir, lightDir);

  // SURFACE COLOR from mids (hue + warmth; gray stone on a mid kill).
  vec3 baseCol = midColor(surf * 1.2 + r * 0.4 + t * 0.03, temp);

  // GLASS look: caustic web + wet specular rim. Weighted by (1-mat).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  fresh += baseCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  // Rim specular is steered by the beat light direction (readable walk).
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick) * (0.5 + 0.9 * facing);
  // Sculpted ridges catch extra rim light where displacement is steep.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high) * (0.5 + 0.7 * facing);

  // SAND look: granular scatter, dry matte. MICRO-TEXTURE from highs governs
  // grain density (polished when highs killed, gritty when highs rich).
  float matW = mat * u_grain;
  float grainFreq = mix(60.0, 240.0, u_textHigh);
  float g1 = hash(floor(c * grainFreq + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * (grainFreq * 0.6 + 20.0) + u_flow * 3.0 + 7.3));
  float grainRaw = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  // High kill -> polished smooth: fade the grain amplitude toward zero.
  float grain = grainRaw * (0.12 + 0.95 * u_textHigh);
  fresh += baseCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  fresh += baseCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += baseCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat) * (0.2 + 0.9 * u_textHigh);

  // SPARKLE (micro-texture, both regimes): crisp glints on the relief crests,
  // gated hard by highs so a high kill leaves the surface glint-free.
  float sparkleN = hash(floor(c * (grainFreq * 1.3) + fract(t * 7.0) * 97.0));
  float sparkle = step(0.985 - 0.05 * u_textHigh, sparkleN) * u_textHigh;
  fresh += mix(specCol, vec3(1.0), 0.5) * sparkle * (body + interior) * (0.6 + 0.9 * facing) * (0.4 + 0.8 * u_high);

  // Core glow common to both regimes — the heart, hottest at high centroid,
  // pumped by the bar pulse.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  // Section-transform bloom: on the pulse the whole form ERUPTS.
  vec3 burstCol = mix(midColor(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += midColor(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Rebirth dissolve during a track change.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += baseCol * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses.
  float reverb = 2.4 * rippleWave;
  fresh += baseCol * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // Snare stamp: a mid-transient ring crossing the surface (localized).
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(vec3(0.8, 0.9, 1.0), midColor(0.3, temp), 0.5) * sarc * u_snare * 0.8;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Temperature grade (color richness folded through the mid-driven palette).
  vec3 grade = midColor(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Buildups saturate + energize (tense AND vibrant).
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 16;

/** splitmix32-style scalar hash → stable [0,1). Same trackId ⇒ same look. */
function splitmix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) / 4294967296;
}

/** Four stable genome scalars in [0,1] from a seed (trackId or pseudo-seed). */
function genomeOf(seed: number): [number, number, number, number] {
  let s = Math.floor(seed) | 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x6d2b79f5) | 0;
    out.push(splitmix(s + i * 0x2545f491));
  }
  return [out[0], out[1], out[2], out[3]];
}

export const g08MateriaEqmapPreset: VisualizerPreset = {
  id: 'g08-materia-eqmap',
  name: 'g08 materia-eqmap',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'grain', label: 'sand grain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'glass', label: 'glass caustics', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'growth', label: 'phrase growth', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'eqDrama', label: 'global EQ drama', min: 0, max: 2, step: 0.05, default: 1 },
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
    // Song genome (structure family from trackId) + rebirth cross-fade.
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1; // 1 = settled
    let seeded = false;
    // Smoothed dominant-deck EQ (avoid pops on knob jumps / deck switches).
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    // STRICT GLOBAL SPLIT: smoothed per-property drivers (band * eq gate).
    let massLow = 0;
    let colorMid = 0;
    let textHigh = 0;
    // Beat-stepped light: integer notch counter + eased angle.
    let lastBeatIndex: number | null = null;
    let lightNotch = 0;
    let lightAng = 0;
    const LIGHT_NOTCHES = 8; // eight readable light positions around the form
    // Persistent 24-band spectrum buffer (EXACTLY length 24, reused; lockstep).
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const grow = frame.params.growth ?? 1;
        const bias = frame.params.material ?? 0;
        const eqDrama = frame.params.eqDrama ?? 1;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        // Dominant audible deck = highest master-audible level.
        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        let dom: (typeof frame.decks)[number] | null =
          frame.decks.find((d) => d.channel === frame.dominantChannel) ?? null;
        if (dom === null) {
          for (const d of frame.decks) {
            if (d.playing && (dom === null || d.level > dom.level)) dom = d;
          }
        }

        // MATERIAL = spectral shape, nudged by the genome's material lean.
        const rawMaterial = Math.min(
          1,
          Math.max(0, 0.6 * frame.flatness + 0.4 * frame.spread + bias + (genome[1] - 0.5) * 0.3)
        );
        smoothMaterial += (rawMaterial - smoothMaterial) * smoothAlpha;

        // Excitement split by bass presence (voyage idiom); smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const swellTarget = Math.min(1, (frame.bands.low + frame.bands.mid) * 0.7 + smoothDrop * 0.4);
        smoothSwell += (swellTarget - smoothSwell) * (1 - Math.exp(-dt / 0.5));

        // Inner-flow phase: BPM-locked when gridded, slow drift otherwise.
        const flowSpeed = frame.beat?.bpm
          ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8
          : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * smoothMaterial);

        // Phrase growth + bar pulse.
        let phrase = 0;
        let phraseIndex = lastPhraseIndex;
        let bar = 0;
        if (frame.beat) {
          const tierBar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          bar = Math.pow(1 - frame.beat.barPhase, 2.4);
        } else {
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
          bar = 0.5 - 0.5 * Math.cos(frame.time * 1.4);
        }
        phrase = Math.min(1, phrase * grow);

        // Section transformation: fire on each new phrase, flip regime sign.
        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          section = 1;
          flip = -flip || 1;
        }
        lastPhraseIndex = phraseIndex;
        section = Math.max(0, section - dt / 1.1);

        // BEAT-STEPPED LIGHT: tip the primary light direction one notch per beat
        // (readable, cheap). The notch is an INTEGER; the angle eases toward it
        // but the step itself never interpolates (lands on the grid).
        if (frame.beat) {
          const beatIndex = frame.beat.barIndex * frame.beat.beatsPerBar + frame.beat.beatInBar;
          if (lastBeatIndex === null) {
            lightNotch = ((beatIndex % LIGHT_NOTCHES) + LIGHT_NOTCHES) % LIGHT_NOTCHES;
          } else if (beatIndex !== lastBeatIndex) {
            lightNotch = (lightNotch + 1) % LIGHT_NOTCHES;
          }
          lastBeatIndex = beatIndex;
        } else {
          // Gridless: slow synthetic notch walk so the highlight still moves.
          lastBeatIndex = null;
          lightNotch = Math.floor(frame.time * 1.5) % LIGHT_NOTCHES;
        }
        const targetAng = (lightNotch / LIGHT_NOTCHES) * Math.PI * 2;
        // Ease toward the notch on the shortest arc (never past the target notch).
        let d = targetAng - lightAng;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        lightAng += d * (1 - Math.exp(-dt / 0.09));

        // SONG GENOME: dominant trackId → structure family; track change = rebirth.
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

        // Deck EQ kills: smooth the dominant deck's knobs (0.5 = flat).
        const eqAlpha = 1 - Math.exp(-dt / 0.15);
        const targetLow = dom?.eq.low ?? 0.5;
        const targetMid = dom?.eq.mid ?? 0.5;
        const targetHigh = dom?.eq.high ?? 0.5;
        eqLow += (targetLow - eqLow) * eqAlpha;
        eqMid += (targetMid - eqMid) * eqAlpha;
        eqHigh += (targetHigh - eqHigh) * eqAlpha;

        // STRICT GLOBAL SPLIT drivers: band energy scaled by the same EQ gate
        // (knob 0.5 = 1.0, 0 = 0.0), so a kill both carves bands (region) AND
        // collapses the global property (mass/color/texture). Smoothed.
        const gate = (knob: number) => Math.min(1.7, Math.max(0, (knob - 0.5) * 2 + 1));
        const massTarget = Math.min(1, frame.bands.low * gate(eqLow) * eqDrama);
        const colorTarget = Math.min(1, frame.bands.mid * gate(eqMid) * eqDrama);
        const textTarget = Math.min(1, frame.bands.high * gate(eqHigh) * eqDrama);
        const propAlpha = 1 - Math.exp(-dt / 0.18);
        massLow += (massTarget - massLow) * propAlpha;
        colorMid += (colorTarget - colorMid) * propAlpha;
        textHigh += (textTarget - textHigh) * propAlpha;

        // Fill the 24-band spectrum buffer (EXACTLY length 24; clamp source).
        const src = frame.spectrum;
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const v = i < src.length ? src[i] : 0;
          spectrum[i] = Math.min(1, Math.max(0, v));
        }

        // Traveling kick pressure wave: retrigger on strong kicks.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        // Genome: base symmetry (lobe count bias) 3..9.
        const symmetry = 3 + Math.floor(genome[0] * 7);

        // Gentle energy-tied decay; sand scatters a touch faster than glass.
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.99 - 0.008 * energy - 0.006 * smoothBuildup - 0.004 * smoothMaterial;

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
          u_decay: Math.min(0.997, 1 - (1 - baseDecay) / persistence),
          u_seed: genome[3] * 100,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_flow: flow,
          u_swell: smoothSwell,
          u_grain: frame.params.grain ?? 1,
          u_glass: frame.params.glass ?? 1,
          u_bar: bar,
          u_rebirth: rebirth,
          u_symmetry: symmetry,
          u_gSculpt: (frame.params.sculpt ?? 1) * (0.6 + 0.8 * genome[2]),
          u_eqLow: eqLow,
          u_eqMid: eqMid,
          u_eqHigh: eqHigh,
          u_massLow: Math.min(1, massLow),
          u_colorMid: Math.min(1, colorMid),
          u_textHigh: Math.min(1, textHigh),
          u_lightAng: lightAng,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g08MateriaEqmapPreset;
