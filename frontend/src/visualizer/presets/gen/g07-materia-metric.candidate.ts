/**
 * g07-materia-metric (gen-7 TWEAK: materia-deep engine + a QUANTIZED metric
 * growth grammar). Parents: g03-materia-deep (1072, leader — the engine) ×
 * g04-materia-arc (winner — read for its phrase-quantized growth STAGES; this
 * candidate QUANTIZES HARDER: bar-stepped strata, hard-cut materials).
 *
 * The human insight (same as g07-voyage-hardcut): smooth interpolation
 * between discrete structures reads as mush (the polygon-morphing complaint).
 * materia-arc EASED its stage steps (~0.6 s surge). This candidate does NOT
 * ease the metric growth — the quantization IS the aesthetic:
 *
 *   METRIC GROWTH GRAMMAR (the sculpture ASSEMBLES in bar-quantized steps):
 *     A phrase is 8 bars (retimed — see the human note by PHRASE_BARS). The
 *     first four bars each add one STRATUM to the 24-band relief:
 *       bar 0 : CORE          (the low lobes only — bare skeleton)
 *       bar 1 : EXPANSION      (mid shelves reveal)
 *       bar 2 : EXPANSION      (upper-mid shelves reveal)
 *       bar 3 : CREST          (fine high stipple + crest highlight)
 *       bars 4-7 : the completed sculpture HOLDS until the phrase cut.
 *     The stratum count STEPS ON the bar line — hard, no ease (u_strata is an
 *     integer 0..3 the shader reads directly; each band's reveal is a step()
 *     against u_strata, so a whole shelf of relief pops in on the downbeat).
 *
 *   PHRASE BOUNDARY = MATERIAL HARD CUT (the MINOR change, every 8 bars). The
 *   completed sculpture cuts to a new MATERIAL BANK + PALETTE on the exact
 *   downbeat (`ladderBarIndex ?? barIndex`) — one frame, no crossfade:
 *       0 GLASS        cold blue caustics, crisp, chromatic
 *       1 OBSIDIAN     near-black volcanic sheen, hard specular
 *       2 OPAL         iridescent pastel-free rainbow shimmer
 *       3 BASALT-LAVA  matte black crust with molten orange veins
 *     Each bank is a genuinely distinct hue family (bright, saturated). Then
 *     the strata reset to 0 and the sculpture regrows.
 *
 *   SECTION BOUNDARY = TECTONIC CLEAR (the MAJOR change, every 16 bars). The accumulated
 *   sculpture FRACTURES and subsides (fast, solid — a radial fold + collapse),
 *   a new epoch begins on a DISTANT material bank (bank stride, bigger delta).
 *
 *   CONTINUOUS AGAINST QUANTIZED. Deck EQ region kills carve the relief in
 *   REAL TIME (parent behavior, continuous), and the kick pressure wave is
 *   continuous — the contrast of that continuous response against the
 *   bar-quantized assembly is intentional. Each KICK also visibly advances
 *   the CURRENT bar's stratum assembly (stacks material). A DROP landing on a
 *   boundary completes the growth instantly + full internal luminosity (rides
 *   max(drop, energy)). A BUILDUP adds assembly urgency (faster stacking
 *   motion WITHIN the quantized steps, without changing the step count).
 *
 * Song genome (trackId, pattern g02-julia / materia-deep): base symmetry,
 * material lean, ripple/palette scalars, stable per song. Chroma-preserving
 * soft knee. Photosensitivity floor respected: cuts are ≤1 per 8 bars (phrase
 * retime), no saturated-red strobe, moderate luminance steps. u_spectrum
 * EXACTLY [24].
 */

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

const SPECTRUM_BANDS = 24;

// No backticks inside this GLSL string (GLSL ES 1.0).
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_midSlow;    // motion: slow bands (erratic-motion law) — churn advection rate
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand (surface feel)
uniform float u_phrase;     // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;    // section-transform pulse 0..1 (decays)
uniform float u_flip;       // section regime sign
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
// --- METRIC GROWTH (quantized).
uniform float u_strata;     // integer 0..3: how many strata have assembled
uniform float u_stackKick;  // 0..1 current-bar stack advance from kicks (decays)
uniform float u_matBank;    // integer 0..3 material bank (HARD CUT per phrase)
uniform float u_matCut;     // 0..1 fresh material-cut flash (decays, photosafe)
uniform float u_fracture;   // 0..1 section tectonic fracture/subside (decays)
uniform float u_dropFull;   // 0..1 drop-on-boundary full-relief luminosity
uniform float u_urgency;    // buildup assembly urgency (faster within-step motion)
uniform float u_specHue;    // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)
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

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed, 1 = boosted.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE with QUANTIZED STRATUM REVEAL. Band index maps to
// harmonic order (low = few big lobes, high = many fine ripples). Each band
// belongs to a stratum (0 core .. 3 crest); a band only contributes once its
// stratum has assembled — the reveal is a hard step() against u_strata, so a
// whole shelf of relief pops in ON the bar line (no ease). Kick stacking and
// buildup urgency add sub-step motion WITHIN the current stratum only.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float order = u_symmetry + fb * 0.75;
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    g = eqGate(g);
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Stratum of this band: 0 core (bins 0..5), 1..2 shelves, 3 crest.
    float stratum = floor(fb / 6.0); // 0,1,2,3
    // HARD reveal: present only when its stratum has assembled. The CURRENT
    // stratum (== u_strata during a bar) fades in via kick-stack + urgency,
    // but earlier strata are fully, discretely present.
    float assembled = step(stratum + 0.5, u_strata + 0.5); // 1 if fully in
    float isCurrent = 1.0 - step(stratum + 0.5, u_strata - 0.5) - assembled;
    isCurrent = clamp(isCurrent, 0.0, 1.0);
    float partial = clamp(0.2 + 0.5 * u_stackKick + 0.4 * u_urgency, 0.0, 1.0);
    float reveal = assembled + isCurrent * partial;
    float ph = t * (0.15 + fb * 0.03) * (1.0 + 0.6 * u_urgency)
      + u_seed * (0.11 + fb * 0.017) + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * reveal * sin(ang * order + ph);
  }
  return disp;
}

// HSV round-trip for a value-preserving hue rotation. Used to re-anchor the
// material banks' hue families to spectral content (u_specHue) so the palette
// is not a hardcoded blue<->red axis. Value (brightness) is untouched, so the
// change is chroma-only.
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
// Rotate a color's hue by the spectral anchor (chroma-only: value preserved).
vec3 specAnchor(vec3 col) {
  vec3 h = rgb2hsv(col);
  // DUST FIX v3: full-wheel per-song anchor + widened spectral travel, so
  // different songs land the bank family on genuinely different hues.
  h.x = fract(h.x + u_hueAnchor + (u_specHue - 0.5) * 0.8);
  return hsv2rgb(h);
}

// ---- MATERIAL BANKS (hue families; HARD CUT per phrase). Bright, saturated
// (repo dislikes pastels). Each returns a base color from a field coordinate.
vec3 matGlass(float f, float temp) {
  vec3 col = vec3(0.2, 0.55, 1.0) + vec3(0.25, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * f + vec3(0.55, 0.42, 0.3)));
  return mix(col, vec3(0.5, 0.85, 1.0), 0.3 * temp);
}
vec3 matObsidian(float f, float temp) {
  // Near-black volcanic glass with a cold violet sheen.
  vec3 sheen = vec3(0.35, 0.15, 0.55) + vec3(0.3, 0.2, 0.35)
    * cos(6.28318 * (vec3(1.0, 0.8, 1.0) * f + vec3(0.1, 0.4, 0.7)));
  return sheen * (0.25 + 0.9 * pow(f, 2.0)) + vec3(0.05, 0.02, 0.08);
}
vec3 matOpal(float f, float temp) {
  // Iridescent — the hue TRAVELS wide across the field (rainbow shimmer).
  return vec3(0.5) + vec3(0.5, 0.5, 0.5)
    * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * (f * 2.0) + vec3(0.0, 0.33, 0.67)));
}
vec3 matLava(float f, float temp) {
  // Matte black basalt with molten orange veins in the deep field.
  vec3 crust = vec3(0.08, 0.05, 0.05);
  vec3 molten = vec3(1.0, 0.45, 0.08) + vec3(0.0, 0.3, 0.15)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * f + vec3(0.0, 0.1, 0.2)));
  float vein = pow(f, 3.0);
  return mix(crust, molten, clamp(vein + 0.3 * temp, 0.0, 1.0));
}

// DISCRETE material select: choose the bank == u_matBank (no blend between
// banks — the cut is the aesthetic).
vec3 material(float f, float temp) {
  float b = floor(u_matBank + 0.5);
  vec3 c = matGlass(f, temp);
  c = b > 0.5 ? matObsidian(f, temp) : c;
  c = b > 1.5 ? matOpal(f, temp) : c;
  c = b > 2.5 ? matLava(f, temp) : c;
  // Re-anchor the bank hue family to spectral content (chroma only) so the
  // banks are not a fixed blue<->red axis feeding red/blue feedback dust.
  c = specAnchor(c);
  c *= 1.0 + 0.3 * u_matCut; // the fresh-cut flash brightens (moderate).
  return c;
}

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
  float churnSpeed = mix(0.08, 0.9, mat) * (1.0 + 0.8 * u_urgency);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_midSlow); // motion: slow bands (erratic-motion law)

  // Localized lens swirl (glass refraction hint), continuous.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave — continuous, solid, lights the medium.
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section TECTONIC fracture: a violent radial fold + collapse (fast, solid).
  float fracFold = u_fracture * 0.09 * sin(r * 24.0 - t * 8.0) * u_flip;
  float subside = -u_fracture * 0.05 * (1.0 - smoothstep(0.0, 0.5, r));
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip + fracFold;
  vec2 src = (w + churn + ripple + dir * (fold + subside)) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass chromatic split; sand dry. Unsharp tap.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave + 0.006 * u_matCut) * (1.0 - mat)
    / vec2(aspect, 1.0);
  ab *= u_glass; // fringe amount rides the dust param (human note)
  // fringe fix: hue-steerable fringes -- rotate the field to the anchor
  // frame, split channels there, rotate back. Clamped >= 0 (hueRotate can
  // go slightly negative) so the unsharp feedback loop stays stable.
  float fringeRot = u_hueAnchor + (u_specHue - 0.5) * 0.8;
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

  // ---- The central organic form.
  // Radius grows with strata (quantized: each stratum widens the shelf),
  // swells with loudness, pulses with the bar.
  float strataN = u_strata / 3.0;
  float formR = 0.16 + 0.11 * strataN + 0.04 * u_phrase + 0.07 * u_swell
    + 0.05 * u_low + 0.03 * u_bar + 0.05 * u_dropFull;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * strataN);
  float surfAmp = mix(0.045, 0.11, mat) * (0.5 + 0.7 * strataN);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  // The QUANTIZED spectrum sculpture is the dominant shape driver.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * strataN);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // Field coordinate feeding the material bank.
  float f = clamp(surf * 1.1 + r * 0.4 + t * 0.03, 0.0, 4.0);
  vec3 matCol = material(f, temp);

  // GLASS-style caustic web + wet specular rim (weighted by surface feel).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  fresh += matCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(matCol, vec3(1.0, 0.97, 0.9), 0.4 + 0.4 * temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  // Sculpted ridges catch extra rim light — embossed QUANTIZED relief.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND-style granular scatter.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  fresh += matCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  fresh += matCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += matCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow — the heart, pumped by the bar pulse. Full-relief luminosity on
  // a drop-on-boundary (rides max(drop, energy) JS-side).
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick + 0.5 * u_dropFull);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar + 1.4 * u_dropFull);
  // Drop-full internal luminosity: the whole interior lights up.
  fresh += matCol * interior * u_dropFull * 1.2;

  // Section-transform bloom (continuous section pulse).
  vec3 burstCol = mix(matCol, vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);

  // TECTONIC fracture shell: a fast crack network expanding as the sculpture
  // subsides — a solid, bright ring marking the section clear.
  float fracR = 0.1 + (1.0 - u_fracture) * 0.6;
  float fracShell = exp(-pow((r - fracR) * 7.0, 2.0)) * u_fracture;
  float crackNet = pow(abs(sin(ang * 9.0 + fbm(c * 8.0) * 6.28318)), 12.0);
  fresh += mix(matCol, vec3(1.0, 0.9, 0.8), 0.4) * fracShell * (1.0 + crackNet) * (1.2 + 1.0 * u_drop);

  // MATERIAL-CUT flash: a brief, moderate expanding shell marking the phrase
  // hard cut to the new material (rate-limited ≤1 per 8-bar phrase — photosafe).
  float cutR = 0.08 + (1.0 - u_matCut) * 0.45;
  float cutShell = exp(-pow((r - cutR) * 6.0, 2.0)) * u_matCut;
  fresh += matCol * cutShell * 1.3;

  // Rebirth dissolve during a track change.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += matCol * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses (continuous).
  float reverb = 2.4 * rippleWave;
  fresh += matCol * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop + 1.2 * u_dropFull);

  // Snare stamp: a mid-transient ring crossing the surface.
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(vec3(0.9, 0.95, 1.0), matCol, 0.5) * sarc * u_snare * 0.8;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Buildups saturate + energize (tense AND vibrant). Cut/fracture add a
  // moderate, rate-limited lift (photosafe, no strobe).
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup + 0.28 * u_matCut + 0.25 * u_fracture;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

// RETIME (human note "changes one tier too frequent, try to change every 8
// bars (minor change) or 16 bars (major change)"): the PHRASE material/palette
// cut (the minor change) moves from every 4 bars to every 8. The SECTION
// tectonic clear (the major change) stays at 16. Strata still step per bar and
// assemble the sculpture over the first STRATA bars, then hold until the 8-bar
// phrase cut.
const PHRASE_BARS = 8;
const SECTION_BARS = 16;
/** Strata assembled over the first STRATA bars of a phrase: bar 0 core .. bar 3
 *  crest, then the completed sculpture holds until the 8-bar phrase cut. */
const STRATA = 4;
/** Material banks: glass / obsidian / opal / basalt-lava. */
const MATERIAL_BANKS = 4;

const params: PresetParam[] = [
  { id: 'material', label: 'surface feel (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
  { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'grain', label: 'grain', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'glass', label: 'caustics', min: 0, max: 2, step: 0.05, default: 1 },
  { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
  { id: 'cutStrength', label: 'cut drama', min: 0, max: 2, step: 0.05, default: 1 },
];

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

/** Dominant audible deck (highest master-audible level); null when unknown. */
function dominantDeck(frame: VisualizerFrameData): VisualizerFrameData['decks'][number] | null {
  // dominant: smoothed frame.dominantChannel (layering jitter fix)
  const smoothed = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (smoothed) return smoothed;
  let dom: VisualizerFrameData['decks'][number] | null = null;
  for (const d of frame.decks) {
    if (d.playing && (dom === null || d.level > dom.level)) dom = d;
  }
  return dom;
}

export const g07MateriaMetricPreset: VisualizerPreset = {
  id: 'g07-materia-metric',
  name: 'g07 materia-metric',
  hiRes: true,
  params,
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let flow = 0;
    let smoothMaterial = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSwell = 0;
    let smoothSpecHue = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of dominant deck trackId),
    // eased over ~2s so track changes sweep the full wheel; GLSL adds travel.
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;
    let section = 0;
    let flip = 0;
    // Song genome + rebirth.
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1;
    let seeded = false;
    // Smoothed dominant-deck EQ (continuous kills).
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    // Persistent 24-band spectrum buffer (EXACTLY length 24, reused).
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    // --- QUANTIZED metric growth state.
    let strata = 0; // 0..STRATA-1, steps on each bar line
    let matBank = 0; // 0..MATERIAL_BANKS-1, hard-cuts per phrase
    let matCut = 0; // decays after a phrase material cut
    let fracture = 0; // decays after a section tectonic clear
    let dropFull = 0; // decays after a drop-on-boundary full-relief
    let stackKick = 0; // decays after each kick (current-bar stack advance)
    let lastBarIndex: number | null = null;
    let lastPhraseIndex: number | null = null;
    let lastSectionIndex: number | null = null;
    let lastCutPhrase = -999; // rate-limit: ≤1 material-cut flash per phrase

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const bias = frame.params.material ?? 0;
        const cutStrength = frame.params.cutStrength ?? 1;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        const dom = dominantDeck(frame);

        // MATERIAL surface feel = spectral shape, nudged by the genome lean.
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
        const energyNow = Math.min(
          1,
          (frame.bands.low + frame.bands.mid + frame.bands.high) / 2
        );
        const sustained = Math.min(1, energyNow * 1.4);

        // Spectral hue anchor: ~1s EMA of centroid; re-anchors the material
        // banks' hue family so the palette is not a fixed blue<->red axis.
        smoothSpecHue += (frame.centroid - smoothSpecHue) * (1 - Math.exp(-dt / 1.0));
        // DUST FIX v3: dominant deck = argmax audible level; its trackId anchors
        // a stable per-song hue family, eased over ~2s.
        let domTrack: number | null = null;
        let domLevel = -1;
        for (const dk of frame.decks) {
          if (dk.level > domLevel) {
            domLevel = dk.level;
            domTrack = dk.trackId;
          }
        }
        if (domTrack !== null && domTrack !== lastAnchorTrack) {
          lastAnchorTrack = domTrack;
          hueAnchorTarget = splitmix01(domTrack);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));

        // Inner-flow phase: BPM-locked when gridded, slow drift otherwise.
        const flowSpeed = frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8 : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * smoothMaterial + 0.6 * smoothBuildup);

        // --- Bar pulse (continuous within the bar).
        let bar = 0;
        if (frame.beat) {
          bar = Math.pow(1 - frame.beat.barPhase, 2.4);
        } else {
          bar = 0.5 - 0.5 * Math.cos(frame.time * 1.4);
        }

        // --- QUANTIZED METRIC GROWTH: cut timing off the ladder tier.
        const tierBar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        let phrase = 0;

        if (tierBar !== null) {
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + (frame.beat ? frame.beat.barPhase : 0)) / PHRASE_BARS;
          const phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          const sectionIndex = Math.floor(tierBar / SECTION_BARS);

          // Bar line crossed: STEP the stratum assembly (hard, no ease). Within
          // a phrase the strata index == the bar-in-phrase (0..3).
          if (lastBarIndex === null || tierBar !== lastBarIndex) {
            strata = Math.min(STRATA - 1, barInPhrase);
            stackKick = 0; // reset the current-bar stack advance
          }

          // Phrase boundary: HARD CUT to a new material bank + palette, reset
          // strata to core (0), regrow.
          if (lastPhraseIndex !== null && phraseIndex !== lastPhraseIndex) {
            const sectionCut = lastSectionIndex !== null && sectionIndex !== lastSectionIndex;
            if (sectionCut) {
              // Section: tectonic clear + DISTANT material bank (bigger stride).
              fracture = 1;
              flip = -flip || 1;
              matBank = (matBank + 2 + (Math.abs(sectionIndex) % 2)) % MATERIAL_BANKS;
            } else {
              // Phrase: step to the next material bank.
              matBank = (matBank + 1) % MATERIAL_BANKS;
              section = 1;
              flip = -flip || 1;
            }
            strata = 0; // regrow from the core
            // Material-cut flash — rate-limited to ≤1 per phrase (photosafe).
            if (phraseIndex - lastCutPhrase >= 1) {
              matCut = cutStrength;
              lastCutPhrase = phraseIndex;
            }
            // DROP-ON-BOUNDARY: growth completes instantly + full luminosity
            // (rides max(drop, energy)).
            const landing = Math.max(smoothDrop, 0.6 * sustained);
            if (landing > 0.25) {
              strata = STRATA - 1; // instant complete
              dropFull = Math.min(1, landing);
            }
          }
          lastBarIndex = tierBar;
          lastPhraseIndex = phraseIndex;
          lastSectionIndex = sectionIndex;
        } else {
          // Gridless: soft synthetic phrase, hold the material bank (no cuts).
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
          strata = Math.min(STRATA - 1, Math.floor((phrase * PHRASE_BARS) % STRATA));
          lastBarIndex = null;
          lastPhraseIndex = null;
          lastSectionIndex = null;
        }

        // Decay the transient growth signals.
        section = Math.max(0, section - dt / 1.1);
        fracture = Math.max(0, fracture - dt / 0.7); // fast, solid
        matCut = Math.max(0, matCut - dt / 0.5);
        dropFull = Math.max(0, dropFull - dt / 1.4);

        // KICK stacks material into the CURRENT bar's stratum (visible advance).
        stackKick = Math.max(0, stackKick - dt / 0.6);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
          stackKick = Math.min(1, stackKick + frame.impulse.low * 0.7);
        }

        // SONG GENOME (trackId → structure family); track change = rebirth.
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

        // Deck EQ kills: smooth the dominant deck's knobs (continuous carve).
        const eqAlpha = 1 - Math.exp(-dt / 0.15);
        eqLow += ((dom?.eq.low ?? 0.5) - eqLow) * eqAlpha;
        eqMid += ((dom?.eq.mid ?? 0.5) - eqMid) * eqAlpha;
        eqHigh += ((dom?.eq.high ?? 0.5) - eqHigh) * eqAlpha;

        // Fill the 24-band spectrum buffer (EXACTLY length 24; clamp source).
        const src = frame.spectrum;
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const v = i < src.length ? src[i] : 0;
          spectrum[i] = Math.min(1, Math.max(0, v));
        }

        // Genome: base symmetry (lobe count bias) 3..9.
        const symmetry = 3 + Math.floor(genome[0] * 7);

        // Energy-tied decay.
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.99 - 0.008 * energy - 0.006 * smoothBuildup - 0.004 * smoothMaterial;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          // motion: slow bands (erratic-motion law) — churn advection rate
          u_midSlow: (frame.bandsSlow ?? frame.bands).mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_material: smoothMaterial,
          u_phrase: Math.min(1, phrase),
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
          // --- Quantized metric growth uniforms.
          u_strata: strata,
          u_stackKick: Math.min(1, stackKick),
          u_matBank: matBank,
          u_matCut: Math.min(1, matCut),
          u_fracture: Math.min(1, fracture),
          u_dropFull: Math.min(1, dropFull),
          u_urgency: Math.min(1, smoothBuildup),
          u_specHue: smoothSpecHue,
          u_hueAnchor: hueAnchor,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g07MateriaMetricPreset;
