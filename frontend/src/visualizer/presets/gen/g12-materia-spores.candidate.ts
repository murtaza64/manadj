/**
 * g12-materia-spores (gen-12 DUST DIVERSITY, tweak of g03-materia-deep, leader).
 *
 * Dust is BACK by explicit human request — the materia screenshot showed a
 * monochrome interference-dust wash. This keeps the whole materia-deep engine
 * (spectrum sculpture, EQ region kills, trackId genome, bar/phrase/section
 * meter, spectral tempPalette) and ADDS three sculpture-born dust SPECIES,
 * each its own creature (distinct size/motion/hue, identifiable at a glance):
 *
 *  - SNARE = SPORES. On a snare hit, seeds BURST from the relief's loudest
 *    spectral region, DRIFT on the churn flow, glow briefly, then SETTLE BACK
 *    onto the surface as new material (visible lifecycle: emission -> drift ->
 *    deposit). Mid-warm slice of tempPalette.
 *  - LOWS = MAGMA DROPLETS. Few, LARGE, heavy luminous drops that ooze from
 *    the relief base and fall slowly (gravity). Hot end of tempPalette.
 *  - HIGHS = STATIC FILINGS. Fine iron-filing ticks that hover in short arcs
 *    OVER the currently-loud spectral regions (field-line alignment), vanish
 *    with the highs. Cool end of tempPalette.
 *
 * Species hues are drawn from the (now spectral) tempPalette at DISTINCT
 * temperatures/phases so they never collapse onto one another. The kick
 * pressure wave disturbs all three per their mass (droplets barely, spores
 * shove, filings scatter). Drop = the full ecosystem riding max(drop, energy).
 *
 * Motion smoothness: drift/hover rates ride the slow bands (u_lowSlow /
 * u_midSlow / u_highSlow); instantaneous bands/impulse drive only brightness,
 * bursts, and the pressure wave. Feedback contraction respected (decay < 1,
 * drama in the (1-decay) fresh term). Photosensitivity floor respected.
 */

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

const SPECTRUM_BANDS = 24;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;     // motion-grade low: magma ooze rate
uniform float u_mid;
uniform float u_midSlow;     // motion-grade mid: churn advection + spore drift
uniform float u_high;
uniform float u_highSlow;    // motion-grade high: filing hover rate
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;    // temperature 0 cold .. 1 hot
uniform float u_material;    // 0 liquid glass .. 1 granular sand
uniform float u_phrase;      // phrase growth 0 (start) .. 1 (boundary)
uniform float u_section;     // section-transform pulse 0..1 (decays)
uniform float u_flip;        // section regime sign (drifts -1..1 across sections)
uniform float u_drop;        // excitement with bass
uniform float u_buildup;     // excitement without bass
uniform float u_decay;
uniform float u_seed;
uniform float u_rippleAge;   // seconds since last strong kick
uniform float u_rippleAmp;   // that kick's strength
uniform float u_flow;        // liquid inner-flow phase
uniform float u_swell;       // sustained loudness, form size
uniform float u_grain;       // sand-grain gain slider
uniform float u_glass;       // glass-caustic gain slider
uniform float u_bar;         // bar pulse 0..1 (peaks on the downbeat)
uniform float u_rebirth;     // rebirth cross-fade 0..1 (1 = settled)
uniform float u_symmetry;    // genome: base lobe count bias 3..9
uniform float u_gSculpt;     // sculpt gain slider
uniform float u_eqLow;       // dominant deck EQ 0.5 = flat, 0 = kill
uniform float u_eqMid;
uniform float u_eqHigh;
uniform float u_specHue;     // spectral hue anchor (JS ~1s EMA of centroid) 0..1
uniform float u_hueAnchor;  // DUST FIX v3: per-song genome hue anchor 0..1 (full wheel)
uniform float u_spectrum[24];
uniform float u_loudBand;    // normalized index (0..1) of the loudest band
uniform float u_spore;       // snare spore emission envelope 0..1 (decays)
uniform float u_species;     // overall species population slider

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

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec3 tempPalette(float t, float temp) {
  // DUST FIX v3: full-wheel cold/hot FAMILIES. The per-song anchor picks
  // the cold family; +0.8*(specHue-0.5) travels it with spectral content;
  // hot stays the complement. Different songs = different cold/hot pair.
  float coldHue = fract(u_hueAnchor + (u_specHue - 0.5) * 0.8 + 0.5);
  float hotHue = fract(coldHue - 0.5);
  vec3 coldRip = vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hotRip = vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  float coldV = clamp(0.7 + (coldRip.r + coldRip.g + coldRip.b) * 0.33, 0.0, 1.3);
  float hotV = clamp(0.72 + (hotRip.r + hotRip.g + hotRip.b) * 0.33, 0.0, 1.3);
  vec3 cold = hsv2rgb(vec3(coldHue, 0.82, coldV));
  vec3 hot = hsv2rgb(vec3(hotHue, 0.88, hotV));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// ---- SPECIES 1: SPORES (SNARE). On a snare, seeds burst from the loudest
// spectral REGION (u_loudBand -> a launch angle), drift outward on the flow,
// glow, then settle back toward the surface. Lifecycle rides u_spore.
vec3 spores(vec2 c, float r, float ang, float formR, float temp) {
  vec3 col = vec3(0.0);
  float density = 14.0;
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.71) * 47.0, fract(u_seed * 0.37) * 29.0);
  float live = step(0.55 - 0.3 * u_species, hash(sc * 1.7 + 2.2));
  // Emission origin biased toward the loudest spectral angle.
  float loudAng = u_loudBand * 6.28318;
  float angBias = 0.5 + 0.5 * cos(ang - loudAng);
  // Drift phase rides SLOW mid; each spore drifts along the flow then settles.
  float drift = u_flow * 0.3 + u_time * (0.1 + 0.5 * u_midSlow) + hash(sc + 4.4) * 6.28;
  vec2 dir = vec2(cos(drift), sin(drift));
  // Position: launch outward while u_spore high, settle back as it decays.
  float rise = u_spore * (0.06 + 0.05 * hash(sc + 1.9));
  vec2 pos = vec2(0.5) + dir * rise + vec2(0.0, -0.04 * (1.0 - u_spore));
  vec2 f = fract(q) - pos;
  float d2 = dot(f, f);
  float seed = exp(-d2 * 160.0);
  // Glow while airborne (u_spore), settle luminance as it deposits.
  float glow = 0.4 + 0.6 * u_spore;
  vec3 hue = tempPalette(0.35 + u_specHue * 0.3, clamp(temp + 0.15, 0.0, 1.0));
  // Only near/above the surface annulus.
  float annulus = smoothstep(formR * 0.6, formR * 1.5, r) * exp(-max(0.0, r - formR) * 3.0);
  col += hue * seed * live * glow * angBias * annulus * (0.3 + 1.2 * u_snare + 0.8 * u_spore);
  return col * u_species;
}

// ---- SPECIES 2: MAGMA DROPLETS (LOWS). Few LARGE hot drops that ooze from
// the relief base and fall slowly (gravity). Coarse lattice, per-cell clock.
vec3 magma(vec2 c, float r, float formR, float temp) {
  vec3 col = vec3(0.0);
  float density = 5.0;                       // coarse -> few & large
  vec2 q = c * density;
  vec2 base = floor(q);
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cell = base + vec2(float(ox), float(oy));
      vec2 sc = cell + vec2(fract(u_seed * 0.53) * 61.0, fract(u_seed * 0.31) * 43.0);
      float live = step(0.7 - 0.25 * (u_species + u_low), hash(sc * 1.3 + 8.8));
      float period = 3.0 + 3.0 * hash(sc.yx + 5.5);
      float age = mod(u_time + hash(sc + 2.2) * period, period);
      // Ooze from base (bottom) then fall; rate rides SLOW low.
      float fall = 0.5 * (0.6 + 0.8 * u_lowSlow) * age * age;
      vec2 pos = vec2(hash(sc + 1.1), 0.9 - fall);
      vec2 target = pos * density - cell;
      vec2 f = (q - base) - target;
      float d2 = dot(f, f);
      float size = 0.2 + 0.12 * hash(sc + 6.3);
      float body = exp(-d2 / (size * size));
      float coreHot = exp(-d2 / (size * size * 0.25));
      float envlp = smoothstep(0.0, 0.1, age / period) * (1.0 - smoothstep(0.6, 1.0, age / period));
      vec3 hue = mix(tempPalette(0.1, 1.0), vec3(1.0, 0.6, 0.25), 0.4);
      col += hue * (body + coreHot * 0.7) * live * envlp * (0.4 + 0.8 * u_low);
    }
  }
  // Confine to the outer form region (they leave the base).
  float region = smoothstep(formR * 0.5, formR * 1.6, r);
  return col * region * u_species;
}

// ---- SPECIES 3: STATIC FILINGS (HIGHS). Fine iron-filing ticks aligned
// along field lines (short arcs) hovering OVER the loud spectral regions.
// Vanish with the highs; cool tempPalette end.
vec3 filings(vec2 c, float r, float ang, float temp) {
  vec3 col = vec3(0.0);
  float density = 30.0;                      // fine
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.47) * 33.0, fract(u_seed * 0.23) * 57.0);
  float live = step(0.5 - 0.35 * u_species, hash(sc * 2.3 + 6.1));
  // Field line orientation: radial + slow swirl; hover jitter rides SLOW high.
  float lineAng = ang + 1.5708 + 0.4 * sin(r * 8.0 + u_time * (0.5 + 0.8 * u_highSlow));
  vec2 tang = vec2(cos(lineAng), sin(lineAng));
  // Position hops a short arc along the field line.
  float hop = 0.3 * sin(u_time * (3.0 + 4.0 * u_highSlow) + hash(sc + 1.7) * 6.28);
  vec2 pos = vec2(0.5) + tang * hop;
  vec2 f = fract(q) - pos;
  // Elongated tick along the field line (anisotropic gaussian).
  float along = dot(f, tang);
  float across = dot(f, vec2(-tang.y, tang.x));
  float tick = exp(-(along * along * 90.0 + across * across * 700.0));
  // Bias toward the currently-loud spectral angle (u_loudBand).
  float loudAng = u_loudBand * 6.28318;
  float angBias = 0.4 + 0.6 * pow(0.5 + 0.5 * cos(ang - loudAng), 2.0);
  vec3 hue = tempPalette(0.6 + u_specHue * 0.3, clamp(temp - 0.25, 0.0, 1.0));
  col += hue * tick * live * angBias * (0.05 + 1.5 * u_high);
  return col * smoothstep(0.1, 0.35, r) * u_species;
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

  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // ---- THE ECOSYSTEM: three sculpture-born species. Kick pressure wave
  // (reverb) shoves the light ones; magma barely reacts (heavy).
  fresh += spores(c, r, ang, formR, temp) * (1.0 + 1.5 * rippleWave);
  fresh += magma(c, r, formR, temp);
  fresh += filings(c, r, ang, temp) * (1.0 + 2.0 * rippleWave);

  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(tempPalette(0.15, temp), tempPalette(0.3, temp), 0.5) * sarc * u_snare * 0.8;
  }

  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup;

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

export const g12MateriaSporesPreset: VisualizerPreset = {
  id: 'g12-materia-spores',
  name: 'g12 materia-spores',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'species', label: 'dust population (spores/magma/filings)', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'growth', label: 'phrase growth', min: 0, max: 2, step: 0.05, default: 1 },
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
    let smoothSpecHue = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of dominant deck trackId),
    // eased over ~2s so track changes sweep the full wheel; the GLSL adds the
    // slow spectral travel around it, so different songs get different families.
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;
    let section = 0;
    let flip = 0;
    let lastPhraseIndex = -1;
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1;
    let seeded = false;
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    let spore = 0;
    let smoothLoudBand = 0.5;
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
        const species = frame.params.species ?? 1;
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);
        const motion = frame.bandsSlow ?? frame.bands;

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

        const flowSpeed = frame.beat?.bpm
          ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8
          : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * smoothMaterial);

        // Phrase growth + bar pulse via the ladder tier.
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

        // Fill 24-band spectrum + track the loudest band (spore emission
        // origin + filing alignment target).
        const src = frame.spectrum;
        let loudIdx = 0;
        let loudVal = -1;
        for (let i = 0; i < SPECTRUM_BANDS; i++) {
          const v = i < src.length ? Math.min(1, Math.max(0, src[i])) : 0;
          spectrum[i] = v;
          if (v > loudVal) {
            loudVal = v;
            loudIdx = i;
          }
        }
        const loudBandTarget = loudIdx / (SPECTRUM_BANDS - 1);
        smoothLoudBand += (loudBandTarget - smoothLoudBand) * (1 - Math.exp(-dt / 0.4));

        // Spore emission: snare hits pump it, decays over ~0.8s (lifecycle).
        spore = Math.max(0, spore * Math.exp(-dt / 0.8));
        if (frame.impulse.mid > 0.3) {
          spore = Math.min(1, spore + frame.impulse.mid);
        }

        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        const symmetry = 3 + Math.floor(genome[0] * 7);

        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.99 - 0.008 * energy - 0.006 * smoothBuildup - 0.004 * smoothMaterial;

        // Species population rides max(drop, energy) so a drop fills the scene.
        const popScale = species * (0.5 + 0.6 * Math.max(smoothDrop, energy));

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
          u_specHue: smoothSpecHue,
          u_hueAnchor: hueAnchor,
          u_spectrum: spectrum,
          u_loudBand: smoothLoudBand,
          u_spore: spore,
          u_species: Math.min(1.6, popScale),
        };
      },
    });
  },
};

export default g12MateriaSporesPreset;
