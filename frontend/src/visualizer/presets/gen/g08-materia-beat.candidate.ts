/**
 * g08-materia-beat (gen-8 TWEAK: materia-deep engine + a BEAT-LOCKED percussion
 * surface). Parents: g03-materia-deep (1072, pool leader — the engine copied
 * wholesale) × g07-materia-metric (1015 — its bar-quantized growth read well;
 * this candidate reuses metric's MATERIAL BANKS: glass/obsidian/opal/basalt-lava).
 *
 * The ask: more beat responsiveness on the leader. A FACET-FLASH STAMP advances
 * around the sculpture per beat, so the bar position is READABLE off the lit
 * facet, and the meter tiers punctuate hard:
 *
 *   BEAT  -> the stamp ADVANCES one facet. beatsPerBar facets ring the form; the
 *            currently-stamped facet is a lit angular wedge. Its angular POSITION
 *            reads the beat-in-bar directly (facet 0 = downbeat). The stamp is an
 *            INTEGER slot (`beatInBar`), never interpolated — it jumps on the grid.
 *   KICK  -> the parent pressure wave AND the current stamp SLAMS: the lit facet
 *            punches solid (a sharp radial front + brightness spike, localized).
 *   SNARE -> a shard-glint BURST at the lit region ONLY (angular window around the
 *            current facet) — crisp glints, NO powder (dust-fatigue law).
 *   BAR   -> the whole sculpture ROTATES one quantized notch (integer step off the
 *            downbeat via `ladderBarIndex ?? barIndex`) — never a smooth spin.
 *   PHRASE-> PALETTE BANK HARD CUT (metric's banks): glass -> obsidian -> opal ->
 *            basalt-lava, one frame on the exact downbeat, no crossfade.
 *   DROP  -> ALL facets light at once + internal luminosity riding max(drop,
 *            energy). BUILDUP -> stamps SHARPEN (tighter wedge) and WARM.
 *
 * Kick pressure wave, spectrum sculpture, deck EQ region kills, song genome and
 * chroma-preserving soft knee are the parent's, unchanged. Photosensitivity
 * floor respected: stamps/bursts are LOCALIZED (angular windows, exempt); the
 * only full-field lift is the palette-cut flash, rate-limited ≤1 per phrase and
 * moderate. u_spectrum EXACTLY length 24, in lockstep with the parent.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

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
// --- BEAT GRAMMAR (this candidate).
uniform float u_barRot;     // bar-quantized rotation of the whole sculpture (rad)
uniform float u_facetAng;   // angular center of the CURRENT stamped facet (rad)
uniform float u_facetWidth; // half-width of the lit wedge (rad; buildup sharpens)
uniform float u_beatsPerBar;// facets around the ring
uniform float u_stampSlam;  // 0..1 kick-slam on the current facet (decays)
uniform float u_snareGlint; // 0..1 snare shard-glint at the lit region (decays)
uniform float u_beatWarm;   // 0..1 buildup warmth added to the stamp
uniform float u_allLit;     // 0..1 drop: all facets lit + full luminosity
uniform float u_matBank;    // integer 0..3 material bank (HARD CUT per phrase)
uniform float u_matCut;     // 0..1 fresh palette-cut flash (decays, photosafe)
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

// SPECTRUM SCULPTURE (parent, unchanged): 24 bands as angular harmonics,
// region-gated by the deck EQ. Low = few big lobes, high = many fine ripples.
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

// Temperature palette (parent base color source).
vec3 tempPalette(float t, float temp) {
  vec3 cold = vec3(0.18, 0.5, 0.95) + vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hot = vec3(1.0, 0.62, 0.18) + vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// --- MATERIAL BANKS (reused from g07-materia-metric; HARD CUT per phrase).
// Bright, saturated (repo dislikes pastels).
vec3 matGlass(float f, float temp) {
  vec3 col = vec3(0.2, 0.55, 1.0) + vec3(0.25, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.85) * f + vec3(0.55, 0.42, 0.3)));
  return mix(col, vec3(0.5, 0.85, 1.0), 0.3 * temp);
}
vec3 matObsidian(float f, float temp) {
  vec3 sheen = vec3(0.35, 0.15, 0.55) + vec3(0.3, 0.2, 0.35)
    * cos(6.28318 * (vec3(1.0, 0.8, 1.0) * f + vec3(0.1, 0.4, 0.7)));
  return sheen * (0.25 + 0.9 * pow(f, 2.0)) + vec3(0.05, 0.02, 0.08);
}
vec3 matOpal(float f, float temp) {
  // Darker base than the naive 0.5+0.5cos rainbow: opal's mean luminance was
  // ~2x the other banks', so opal phrases pumped the feedback loop into the
  // knee and washed the frame pink (human note).
  return vec3(0.18) + vec3(0.42, 0.4, 0.44)
    * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * (f * 2.0) + vec3(0.0, 0.33, 0.67)));
}
vec3 matLava(float f, float temp) {
  vec3 crust = vec3(0.08, 0.05, 0.05);
  vec3 molten = vec3(1.0, 0.45, 0.08) + vec3(0.0, 0.3, 0.15)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * f + vec3(0.0, 0.1, 0.2)));
  float vein = pow(f, 3.0);
  return mix(crust, molten, clamp(vein + 0.3 * temp, 0.0, 1.0));
}
vec3 material(float f, float temp) {
  float b = floor(u_matBank + 0.5);
  vec3 c = matGlass(f, temp);
  c = b > 0.5 ? matObsidian(f, temp) : c;
  c = b > 1.5 ? matOpal(f, temp) : c;
  c = b > 2.5 ? matLava(f, temp) : c;
  c *= 1.0 + 0.3 * u_matCut; // fresh-cut flash brightens (moderate).
  return c;
}

// Shortest angular distance to the current facet center (handles wrap).
float facetDist(float ang) {
  float d = ang - u_facetAng;
  d = mod(d + 3.14159265, 6.28318530) - 3.14159265;
  return abs(d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  // BAR-QUANTIZED ROTATION: the whole sculpture is sampled in a rotated frame
  // that steps one notch per bar (integer; never a smooth spin).
  float rc = cos(u_barRot);
  float rs = sin(u_barRot);
  vec2 cr = mat2(rc, -rs, rs, rc) * c;
  float ang = atan(cr.y, cr.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dir = r > 1e-4 ? c / r : vec2(0.0);
  vec2 dirR = r > 1e-4 ? cr / r : vec2(0.0);

  float mat = clamp(u_material, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  float churnScale = mix(2.4, 7.5, mat);
  float churnSpeed = mix(0.08, 0.9, mat);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (1.0 + 0.7 * u_mid);

  // Localized lens swirl inside the core radius.
  float core = 0.16 + 0.12 * u_low + 0.05 * u_swell;
  float lens = (0.3 * u_low + 1.2 * u_kick) * exp(-pow(r / core, 2.0) * 1.5) * (1.0 - 0.6 * mat);
  float dcs = cos(lens * 0.4);
  float dsn = sin(lens * 0.4);
  vec2 w = mat2(dcs, -dsn, dsn, dcs) * c;

  // Traveling kick pressure wave (parent).
  float waveFront = 0.1 + u_rippleAge * 0.85;
  float rippleWave = exp(-pow((r - waveFront) * 10.0, 2.0)) * exp(-u_rippleAge * 2.2) * u_rippleAmp;
  vec2 ripple = dir * rippleWave * 0.04;

  // Section transform fold (parent).
  float fold = u_section * 0.06 * sin(r * 20.0 - t * 6.0) * u_flip;
  vec2 src = (w + churn + ripple + dir * fold) / vec2(aspect, 1.0) + 0.5;

  // Sample previous frame. Glass chromatic split; sand dry. Unsharp tap.
  vec2 ab = dir * (0.0016 + 0.006 * u_drop + 0.01 * rippleWave + 0.006 * u_matCut) * (1.0 - mat)
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
  float sharp = mix(1.4, 1.12, mat);
  vec3 field = max(vec3(0.0), sampled * sharp - blur * (sharp - 1.0)) * u_decay;

  // ---- The central organic form (parent geometry, rotated frame).
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar + 0.04 * u_allLit;
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

  // Material-bank base color (hard cut per phrase).
  float f = clamp(surf * 1.1 + r * 0.4 + t * 0.03, 0.0, 4.0);
  vec3 matCol = material(f, temp);

  // ---- BEAT FACET STAMP. A lit angular wedge marks the current beat-in-bar.
  // fd = angular distance to the facet center; a soft wedge of half-width
  // u_facetWidth (buildup sharpens -> tighter). The lit facet reads position.
  float fd = facetDist(ang);
  float wedge = 1.0 - smoothstep(0.0, u_facetWidth, fd);
  // Drop lights ALL facets: fall back to full-ring illumination.
  float litRegion = max(wedge, u_allLit);

  // GLASS look: caustic web + wet specular rim (parent).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  fresh += matCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(matCol, vec3(1.0, 0.97, 0.9), 0.4 + 0.4 * temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND look: granular scatter (parent).
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  fresh += matCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  fresh += matCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += matCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // FACET STAMP light: the lit wedge glows across the body (localized). Buildup
  // WARMS the stamp toward amber; drop broadens it to the whole ring.
  vec3 stampCol = mix(specCol, vec3(1.0, 0.72, 0.35), 0.55 * u_beatWarm);
  fresh += stampCol * litRegion * (body * 0.7 + interior * 1.1)
    * (0.7 + 0.9 * u_swell + 1.2 * u_allLit);

  // KICK SLAM on the current facet: a sharp solid radial front punches the lit
  // wedge (localized, photosafe). Rides the pressure-wave amplitude too.
  float slamFront = exp(-pow((rr - formR * 0.9) * 22.0, 2.0));
  fresh += mix(stampCol, vec3(1.0), 0.4) * slamFront * wedge * u_stampSlam * 2.0;
  fresh += stampCol * wedge * u_stampSlam * interior * 1.4;

  // SNARE shard-glint burst at the lit region ONLY (crisp glints, no powder).
  // Sparse high-frequency glints windowed to the current facet.
  float glintN = hash(floor(cr * mix(120.0, 300.0, u_high) + fract(t * 9.0) * 131.0));
  float glint = step(0.97, glintN);
  fresh += mix(vec3(1.0), specCol, 0.3) * glint * wedge * u_snareGlint
    * (body + interior * 0.5) * 2.2;

  // Core glow (parent), pumped by the bar pulse. Drop lights the whole interior.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick + 0.5 * u_allLit);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar + 1.4 * u_allLit);
  fresh += matCol * interior * u_allLit * 1.2;

  // Section-transform bloom (parent).
  vec3 burstCol = mix(matCol, vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);

  // PALETTE-CUT flash: brief moderate expanding shell on the phrase hard cut
  // (rate-limited ≤1 per phrase — photosafe).
  float cutR = 0.08 + (1.0 - u_matCut) * 0.45;
  float cutShell = exp(-pow((r - cutR) * 6.0, 2.0)) * u_matCut;
  fresh += matCol * cutShell * 1.3;

  // Rebirth dissolve during a track change (parent).
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += matCol * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses (parent).
  float reverb = 2.4 * rippleWave;
  fresh += matCol * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop + 1.2 * u_allLit);

  // Whole-frame grade. CRITICAL: field is the PERSISTENT feedback state —
  // any sustained multiplier > 1 compounds exponentially frame-over-frame
  // until the soft knee pegs the whole screen (the periodic pink washout,
  // human note: worst on the bright opal bank during drop plateaus/cuts).
  // Cap the grade below 1 so the loop stays contractive; drop/cut drama
  // still arrives through the fresh-injection scaling above.
  float lift = 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup + 0.28 * u_matCut;
  lift *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;
  field *= min(lift, 0.99);

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 4;
/** Material banks: glass / obsidian / opal / basalt-lava. */
const MATERIAL_BANKS = 4;

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

export const g08MateriaBeatPreset: VisualizerPreset = {
  id: 'g08-materia-beat',
  name: 'g08 materia-beat',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'grain', label: 'sand grain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'glass', label: 'glass caustics', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'stamp', label: 'beat stamp drama', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
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
    // Song genome + rebirth.
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1;
    let seeded = false;
    // Smoothed dominant-deck EQ (region kills, parent behavior).
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    // Persistent 24-band spectrum buffer (EXACTLY length 24, reused; lockstep).
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    // --- BEAT GRAMMAR state.
    let barRot = 0; // accumulated bar-quantized rotation (integer notches)
    let facetAng = 0; // eased angle of the current facet center
    let matBank = 0; // 0..3, hard cut per phrase
    let matCut = 0; // decays after a phrase palette cut
    let stampSlam = 0; // decays after a kick slam
    let snareGlint = 0; // decays after a snare burst
    let allLit = 0; // decays after a drop (all facets lit)
    let lastBeatIndex: number | null = null;
    let lastBarIndex: number | null = null;
    let lastPhraseIndex: number | null = null;
    let lastCutPhrase = -999;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const bias = frame.params.material ?? 0;
        const stampDrama = frame.params.stamp ?? 1;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        // Dominant audible deck = highest master-audible level.
        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
        }

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
        const energyNow = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);

        // Inner-flow phase: BPM-locked when gridded, slow drift otherwise.
        const flowSpeed = frame.beat?.bpm
          ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8
          : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * smoothMaterial);

        // Bar pulse (continuous within the bar).
        let bar = 0;
        if (frame.beat) {
          bar = Math.pow(1 - frame.beat.barPhase, 2.4);
        } else {
          bar = 0.5 - 0.5 * Math.cos(frame.time * 1.4);
        }

        // ---- BEAT GRAMMAR: everything integer-quantizes off the grid.
        const beatsPerBar = frame.beat?.beatsPerBar || 4;
        let phrase = 0;
        if (frame.beat) {
          const tierBar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          const phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          const beatIndex = tierBar * beatsPerBar + frame.beat.beatInBar;

          // BEAT: the stamp advances one facet. facetSlot = beatInBar (integer).
          if (beatIndex !== lastBeatIndex) {
            lastBeatIndex = beatIndex;
          }

          // BAR: rotate the whole sculpture one quantized notch (integer step).
          if (lastBarIndex === null) {
            lastBarIndex = tierBar;
          } else if (tierBar !== lastBarIndex) {
            const steps = tierBar - lastBarIndex;
            // One notch per bar; notch = a fraction of a full turn keyed to meter.
            barRot += steps * ((Math.PI * 2) / (beatsPerBar * 2));
            lastBarIndex = tierBar;
          }

          // PHRASE: palette bank HARD CUT on the exact downbeat.
          if (lastPhraseIndex !== null && phraseIndex !== lastPhraseIndex) {
            matBank = (matBank + 1) % MATERIAL_BANKS;
            section = 1;
            flip = -flip || 1;
            if (phraseIndex - lastCutPhrase >= 1) {
              matCut = 1;
              lastCutPhrase = phraseIndex;
            }
          }
          lastPhraseIndex = phraseIndex;
        } else {
          // Gridless: soft synthetic phrase, slow facet walk, hold the bank.
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
          lastBeatIndex = null;
          lastBarIndex = null;
          lastPhraseIndex = null;
        }

        // FACET target angle: the current beat-in-bar slot around the ring.
        // Integer slot (never interpolated); the angle EASES toward it fast so
        // it reads as a snap, but the slot itself lands on the grid.
        const facetSlot = frame.beat ? frame.beat.beatInBar : Math.floor(frame.time * 2) % beatsPerBar;
        const targetFacet = (facetSlot / beatsPerBar) * Math.PI * 2;
        let d = targetFacet - facetAng;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        facetAng += d * (1 - Math.exp(-dt / 0.05));

        // Decay the transient beat signals.
        section = Math.max(0, section - dt / 1.1);
        matCut = Math.max(0, matCut - dt / 0.5);
        stampSlam = Math.max(0, stampSlam - dt / 0.28);
        snareGlint = Math.max(0, snareGlint - dt / 0.32);
        allLit = Math.max(0, allLit - dt / 1.3);

        // DROP: all facets lit + full luminosity riding max(drop, energy).
        const landing = Math.max(smoothDrop, 0.55 * Math.min(1, energyNow * 1.4));
        if (landing > allLit) allLit = landing;

        // KICK: parent pressure wave AND the current stamp SLAMS solid.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
          stampSlam = Math.min(1, frame.impulse.low * 1.2 * stampDrama);
        }

        // SNARE: shard-glint burst at the lit region only.
        if (frame.impulse.mid > 0.08) {
          snareGlint = Math.max(snareGlint, Math.min(1, frame.impulse.mid * 1.3 * stampDrama));
        }

        // BUILDUP: stamps sharpen (tighter wedge) and warm.
        const facetWidth = (Math.PI / beatsPerBar) * (0.85 - 0.45 * smoothBuildup);
        const beatWarm = Math.min(1, smoothBuildup);

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

        // Deck EQ kills: smooth the dominant deck's knobs (region carve, parent).
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
          // --- Beat grammar uniforms.
          u_barRot: barRot,
          u_facetAng: facetAng,
          u_facetWidth: facetWidth,
          u_beatsPerBar: beatsPerBar,
          u_stampSlam: Math.min(1, stampSlam),
          u_snareGlint: Math.min(1, snareGlint),
          u_beatWarm: beatWarm,
          u_allLit: Math.min(1, allLit),
          u_matBank: matBank,
          u_matCut: Math.min(1, matCut),
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g08MateriaBeatPreset;
