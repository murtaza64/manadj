/**
 * g09-shards-prism (gen-9 TWEAK of g05-materia-shards, #2 at 1062).
 *
 * Wholesale copy of materia-shards — one central organic form whose MATERIAL
 * is the spectral shape, 24-band spectrum sculpture, deck EQ region kills,
 * trackId song genome, phrase growth, section metamorphosis, solid kick
 * pressure waves, glass-shard snare ejection, u_spectrum[24] in lockstep —
 * EXCEPT the shards become PRISMATIC and the surface goes near-monochrome:
 *
 *   PRISMATIC SHARDS. Each shard is tinted by the HUE of the spectral band
 *   region it erupted from (band index -> hue wheel, lows warm -> highs cool,
 *   ONE full turn, same mapping as g09-materia-chroma). It refracts a
 *   hue-shifted copy of itself — CHROMATIC DISPERSION: the leading (outer)
 *   edge shifts +hue, the trailing (inner) edge shifts -hue, so each splinter
 *   fans into a tiny spectrum like light through a prism.
 *
 *   NEAR-MONOCHROME SURFACE. The central form is drained to a desaturated
 *   stone tone (a faint temperature bias only) so the colored shards READ
 *   against it — contrast is the point. The kick pump and heart stay
 *   achromatic-ish light.
 *
 *   SNARE VOLLEY -> the LOUDEST region's hue dominates that volley (u_shardHue
 *   is the loudest band's hue at crack time).
 *
 *   DROP = FULL-SPECTRUM FAN. On a drop (riding max(drop, energy)) shards
 *   erupt from ALL 24 regions in HUE ORDER around the circle — a visible
 *   rainbow ordered by frequency (low/warm near band-0 azimuth, high/cool
 *   sweeping around). EQ kill = that hue family vanishes from the air (each
 *   fan blade is gated by its band's EQ region).
 *
 * Chroma-preserving soft knee, photosensitivity floor (gated non-red
 * flashes), bright saturated shard colors on the dark monochrome stone.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const SPECTRUM_BANDS = 24;

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
uniform float u_centroid;   // temperature 0 cold .. 1 hot (faint stone bias)
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
uniform float u_shardAge;   // seconds since last snare crack (ejection age)
uniform float u_shardAmp;   // that snare's strength (ejection energy)
uniform float u_shardAng;   // angle of the loudest spectral region (crack site)
uniform float u_shardHue;   // hue of the loudest band at crack time (volley tint)
uniform float u_shards;     // glass-shard gain slider
uniform float u_fan;        // drop full-spectrum fan drive 0..1 (max(drop,energy))
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

// HSV -> RGB. Bright saturated prism shards on dark monochrome stone.
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Fixed band hue: band 0 -> 0.02 (warm red), band 23 -> ~0.85 (violet). ONE
// full turn of the wheel, lows warm to highs cool. Same map as materia-chroma.
float bandHue(float fb) {
  return 0.02 + (fb / 23.0) * 0.83;
}

// EQ region gate: knob 0.5 = flat (1.0 gain), 0 = killed (0.0), 1 = boosted
// (up to ~1.6). A kill deletes that band's contribution to the surface.
float eqGate(float knob) {
  return clamp((knob - 0.5) * 2.0 + 1.0, 0.0, 1.7);
}

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics. Band index maps
// to harmonic order — low bins are few large lobes, high bins many fine
// ripples. Each band is region-gated by the deck EQ. Constant-loop lookup.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    // Harmonic order: base symmetry + band index (low = big lobes).
    float order = u_symmetry + fb * 0.75;
    // Region gate: low third -> eqLow, mid third -> eqMid, top third -> eqHigh.
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    // Amplitude falls with harmonic order (bass lobes dominate the silhouette).
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Slow phase drift per band (seed-mixed) so the sculpture breathes.
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * sin(ang * order + ph);
  }
  return disp;
}

// Near-monochrome stone tint: a faint temperature bias only. Cool slate at low
// centroid, warm sandstone at high — but heavily desaturated so the prismatic
// shards READ against it.
vec3 stonePalette(float shade, float temp) {
  vec3 cool = vec3(0.30, 0.34, 0.40);
  vec3 warm = vec3(0.42, 0.37, 0.31);
  vec3 base = mix(cool, warm, clamp(temp, 0.0, 1.0));
  return base * (0.35 + 0.65 * shade);
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

  // ---- The central organic form.
  // Radius grows with phrase, swells with loudness, PULSES with the bar.
  float formR = 0.2 + 0.11 * u_phrase + 0.07 * u_swell + 0.05 * u_low
    + 0.03 * u_bar;
  float surfFreq = mix(3.0, 11.0, mat) * (1.0 + 0.6 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.6 + 0.7 * u_phrase);
  // Base fbm surface (texture floor; also caustic/grain source).
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat)));
  // SPECTRUM SCULPTURE: the 24-band displacement field is the dominant
  // shape driver — low bands push large lobes, high bands fine ripples.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.09 + 0.05 * u_phrase);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  // Edge softness is a material cue: glass crisp, sand dusty.
  float edge = mix(0.02, 0.09, mat) + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // NEAR-MONOCHROME SURFACE: the form is drained to desaturated stone so the
  // prismatic shards read against it.
  // GLASS look: caustic web + wet specular rim, stone-toned.
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = stonePalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.72, 0.76, 0.82), vec3(0.86, 0.82, 0.74), temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  // Sculpted ridges catch extra rim light where spectrum displacement is
  // steep — the spectrum sculpture reads as embossed relief on the stone.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND look: granular scatter, dry matte, stone-toned.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = stonePalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  // Sculpted crust: high-band ripples pile grain along the relief crests.
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow common to both regimes — the heart, achromatic-ish light.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.55, 0.6, 0.68), vec3(0.9, 0.85, 0.7), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  // Section-transform bloom: on the pulse the whole form ERUPTS (stone light).
  vec3 burstCol = mix(stonePalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += stonePalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Rebirth dissolve: while a track change re-genesises the form, the surface
  // scatters and re-coheres (u_rebirth 0 -> 1). Bright stone dust during transit.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses (achromatic).
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay); buildups tense-but-alive, drops bloom.
  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // ---- PRISMATIC GLASS SHARDS (snare volley, tinted by the loudest band's
  // hue, with chromatic dispersion). A snare impulse CRACKS the relief at the
  // loudest spectral region (u_shardAng) and ejects angular refractive shards
  // outward. The shard body is tinted by that region's band hue (u_shardHue);
  // it refracts a hue-shifted copy — leading (outer) edge +hue, trailing
  // (inner) edge -hue — so each splinter fans into a tiny spectrum.
  float shardGate = clamp(0.35 * u_mid + 0.65 * u_high, 0.0, 1.0);
  if (u_shardAmp * shardGate > 0.02) {
    float travel = u_shardAge * 0.9;
    float settle = exp(-u_shardAge * 2.4);            // ejection energy decay
    float ejectR = formR * 1.05 + travel * settle * 1.6;
    float rel = ang - u_shardAng;
    float facets = pow(0.5 + 0.5 * cos(rel * (9.0 + 14.0 * u_high)), 6.0);
    float fan = exp(-pow(rel, 2.0) * 1.6);
    // Radial position within the shard shell: -1 (trailing/inner) .. +1
    // (leading/outer). Drives the chromatic dispersion hue shift.
    float radPos = clamp((r - ejectR) * 22.0, -1.5, 1.5);
    float shell = exp(-radPos * radPos);
    float shard = shell * facets * (0.35 + 0.65 * fan);
    // Chromatic dispersion: leading edge +hue, trailing -hue (prism spread).
    float dispHue = fract(u_shardHue + radPos * 0.12 + 1.0);
    float grit = hash(gl_FragCoord.xy + fract(u_shardAge * 7.0) * 173.0);
    // Prismatic shard color: the band hue, blazing saturated; grit breaks it
    // up on sandy material.
    float shardSat = clamp(0.75 + 0.2 * u_high, 0.0, 0.99);
    vec3 shardCol = hsv2rgb(vec3(dispHue, shardSat, 0.55 + 0.45 * shell))
      * (mat > 0.5 ? (0.4 + 0.6 * grit) : 1.0);
    float shardE = u_shardAmp * shardGate * u_shards * settle;
    field += shardCol * shard * shardE * 1.5;
  }

  // ---- DROP FULL-SPECTRUM FAN. On a drop (u_fan = max(drop, energy)) shards
  // erupt from ALL 24 regions in HUE ORDER around the circle — a visible
  // rainbow ordered by frequency. Each blade sits at its band's azimuth (band
  // index -> angle, seed-mixed to match the crack mapping), is gated by that
  // band's EQ region (kill = that hue family vanishes), and tinted by its
  // fixed band hue. Rides max(drop, energy); envelope returns to zero so the
  // additive term stays contractive.
  if (u_fan > 0.05) {
    float phase0 = fract(u_seed * 0.01) * 6.28318; // seed phase (matches crack)
    float fanR = formR * 1.08 + u_fan * 0.35 + 0.06 * sin(t * 2.0);
    vec3 fanCol = vec3(0.0);
    for (int b = 0; b < 24; b++) {
      float fb = float(b);
      // Band azimuth around the circle (hue order == frequency order).
      float bAng = (fb / 24.0) * 6.28318 + phase0;
      float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
      float gate = clamp(g, 0.0, 1.0);         // EQ kill removes this hue family
      float loud = u_spectrum[b] * gate;
      float relB = ang - bAng;
      // Wrap the angular difference into -pi..pi.
      relB = relB - 6.28318 * floor(relB / 6.28318 + 0.5);
      float blade = exp(-relB * relB * 60.0);   // thin radial blade at bAng
      float shell = exp(-pow((r - fanR) * 16.0, 2.0));
      float hue = bandHue(fb);
      fanCol += hsv2rgb(vec3(hue, 0.95, 1.0)) * blade * shell * (0.2 + 0.9 * loud);
    }
    // Envelope: u_fan-scaled AND normalized by (1 - decay) so this per-frame
    // additive term cannot accumulate to a peg (contraction rule).
    field += fanCol * u_fan * (1.0 - u_decay) * (2.5 + 1.5 * u_drop) * u_shards;
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Buildups energize (tense AND vibrant).
  field *= 0.82 + 0.36 * max(u_drop, u_swell) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 16;

/** splitmix32-style scalar hash -> stable [0,1). Same trackId => same look. */
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

/** Fixed band hue (JS mirror of GLSL bandHue): lows warm -> highs cool. */
function bandHue(bandIdx: number): number {
  return 0.02 + (bandIdx / 23) * 0.83;
}

export const g09ShardsPrismPreset: VisualizerPreset = {
  id: 'g09-shards-prism',
  name: 'g09 shards-prism',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'grain', label: 'sand grain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'glass', label: 'glass caustics', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'shards', label: 'prism shards', min: 0, max: 2, step: 0.05, default: 1 },
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
    let section = 0;
    let flip = 0;
    let lastPhraseIndex = -1;
    // Prismatic glass-shard ejection state.
    let shardAge = 999;
    let shardAmp = 0;
    let shardAng = 0;
    let shardHue = 0;
    // Song genome (structure family from trackId) + rebirth cross-fade.
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1; // 1 = settled
    let seeded = false;
    // Smoothed dominant-deck EQ (avoid pops on knob jumps / deck switches).
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    // Persistent 24-band spectrum buffer (EXACTLY length 24, reused).
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
        const smoothAlpha = 1 - Math.exp(-dt / 0.3);

        // Dominant audible deck = highest master-audible level.
        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
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

        // Phrase growth + bar pulse. Phrase tiers use the ladder bar index
        // when available (ladderBarIndex ?? barIndex).
        let phrase = 0;
        let phraseIndex = lastPhraseIndex;
        let bar = 0;
        if (frame.beat) {
          const tierBar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          // Bar pulse: sharp attack on the downbeat, decays across the bar.
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

        // SONG GENOME: dominant trackId -> structure family. Track change =
        // rebirth (visible re-genesis). No trackId => freeze slow stats as a
        // pseudo-seed so the form still has a stable skeleton.
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
          rebirth = 0; // dissolve, then re-cohere
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

        // Fill the 24-band spectrum buffer (EXACTLY length 24; clamp source).
        // Track the loudest band index -> the crack azimuth AND hue for shards.
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

        // Traveling kick pressure wave: retrigger on strong kicks.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        // PRISMATIC SHARDS: a snare impulse cracks the relief at the loudest
        // spectral region and ejects hue-tinted shards. Gated on mid/high.
        shardAge += dt;
        const shardTrig = Math.max(frame.impulse.mid, frame.impulse.high * 0.85);
        if (shardTrig > 0.12 && shardAge > 0.09) {
          shardAge = 0;
          shardAmp = Math.min(1, shardTrig * 1.3);
          // Crack site = azimuth of the loudest 24-band region (matches the
          // fan's band azimuth mapping). Volley hue = that band's fixed hue.
          const phase0 = ((genome[3] * 100 * 0.01) % 1) * Math.PI * 2;
          shardAng = (loudIdx / SPECTRUM_BANDS) * Math.PI * 2 + phase0;
          shardHue = bandHue(loudIdx);
        }

        // Genome: base symmetry (lobe count bias) 3..9, ripple/palette scalars.
        const symmetry = 3 + Math.floor(genome[0] * 7); // 3..9

        // Gentle energy-tied decay; sand scatters a touch faster than glass.
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.99 - 0.008 * energy - 0.006 * smoothBuildup - 0.004 * smoothMaterial;

        // Drop full-spectrum fan drive: ride max(drop, energy). Bounded 0..1;
        // GLSL scales it into the fresh (1 - decay) injection (contraction).
        const fanDrive = Math.min(1, Math.max(smoothDrop, energy));

        return {
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
          u_shardAge: shardAge,
          u_shardAmp: shardAmp,
          u_shardAng: shardAng,
          u_shardHue: shardHue,
          u_shards: frame.params.shards ?? 1,
          u_fan: fanDrive,
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g09ShardsPrismPreset;
