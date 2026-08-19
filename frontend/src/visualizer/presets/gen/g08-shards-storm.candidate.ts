/**
 * g08-shards-storm (gen-8 TWEAK of g05-materia-shards — beat-scheduled volley).
 *
 * Copied wholesale from materia-shards: one central organic form whose
 * MATERIAL is the spectral shape (tonal+narrow = liquid glass, noisy+wide =
 * granular sand), 24-band spectrum sculpture, deck EQ region kills, trackId
 * song genome, phrase growth, section metamorphosis, solid kick pressure
 * waves, chroma-preserving soft knee. The ONE upgraded system:
 *
 *   THE SHARD SYSTEM BECOMES A BEAT-SCHEDULED VOLLEY ENGINE. In the parent
 *   a snare impulse cracked the relief and ejected a burst of shards. Here
 *   shards no longer fire on raw snare — they fire in VOLLEYS quantized to
 *   beat subdivisions, and HIGH-BAND ENERGY CHOOSES THE SUBDIVISION DENSITY:
 *
 *     quiet highs  -> one volley per BAR       (sparse, deliberate)
 *     rising highs -> half / quarter notes     (a steady patter)
 *     busy highs   -> EIGHTH-note volleys      (a fast rattle)
 *
 *   Highs choose the RHYTHM of the effect, not its size (the alt-high ask —
 *   deliberately NOT powder). Each grid crossing FIRES one volley: a fresh
 *   crack at the current loudest spectral region ejects a faceted shard
 *   fan. Volley DIRECTION ROTATES PER BAR (quantized to the ladder bar
 *   index) so successive bars throw shards to new quadrants. Shard volume
 *   still inherits the material (glassy splinters vs gritty scatter).
 *
 *   KICK = parent pressure wave PLUS a flash-refraction: every airborne
 *   shard in the wavefront catches the kick and glints.
 *
 *   DROP = the quantization dissolves into a CONTINUOUS shard storm riding
 *   max(drop, energy): shards spawn every frame from a rotating crack,
 *   filling the field (quantized -> continuous contrast).
 *
 *   EQ (parent language, sharpened): MID KILL drains shard color toward
 *   clear glass; LOW KILL calms the surface they erupt from (already the
 *   parent's eqLow gate on the low spectral third).
 *
 * Everything else — spectrum sculpture, EQ kills, genome, kick pump — is
 * parent. Photosensitivity floor (gated non-red flashes), bright saturated
 * colors preserved from the family.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const SPECTRUM_BANDS = 24;
const PHRASE_BARS = 16;
const MAX_SHARDS = 6; // concurrent airborne volleys tracked

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
uniform float u_shards;     // glass-shard gain slider
uniform float u_spectrum[24];
// ---- BEAT-SCHEDULED VOLLEY uniforms ----
uniform float u_storm;      // 0 quantized volleys .. 1 continuous storm (drop)
uniform float u_stormPhase; // continuous crack azimuth during the storm
uniform float u_subGlint;   // subdivision density 0..1 (highs chose the RHYTHM) -> facet fineness cue
uniform float u_vAge[6];    // per-volley age (seconds since it fired)
uniform float u_vAmp[6];    // per-volley strength (all similar; size is NOT high-driven)
uniform float u_vAng[6];    // per-volley crack azimuth (rotates per bar)
uniform float u_vMat[6];    // per-volley material at fire time (glass..sand)

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

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics.
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

vec3 tempPalette(float t, float temp) {
  vec3 cold = vec3(0.18, 0.5, 0.95) + vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hot = vec3(1.0, 0.62, 0.18) + vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
}

// A single faceted shard fan at azimuth ejAng, eject age ejAge, strength amp,
// material mat. Returns two channels: x = shard body, y = "hot" (glint) mass.
// Shared by the quantized volleys and the continuous storm.
vec2 shardFan(float ang, float r, float formR, float ejAng, float ejAge,
              float amp, float mat, float facetFine, vec2 fc) {
  float travel = ejAge * 0.9;
  float settle = exp(-ejAge * 2.4);
  float ejectR = formR * 1.05 + travel * settle * 1.6;
  float rel = ang - ejAng;
  rel = mod(rel + 3.14159265, 6.28318530) - 3.14159265;
  // Facet fineness follows subdivision density: denser volleys = finer facets.
  float facets = pow(0.5 + 0.5 * cos(rel * (9.0 + 14.0 * facetFine)), 6.0);
  float fan = exp(-pow(rel, 2.0) * 1.6);
  float shell = exp(-pow((r - ejectR) * 22.0, 2.0));
  float shard = shell * facets * (0.35 + 0.65 * fan);
  float grit = hash(fc + fract(ejAge * 7.0) * 173.0);
  float glassy = shard * (1.0 - mat);
  float gritty = shard * mat * (0.4 + 0.6 * grit);
  float body = (glassy * 1.3 + gritty * 1.1) * amp * settle;
  float hot = shard * amp * settle;
  return vec2(body, hot);
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

  // GLASS look.
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.6 + 1.4 * u_mid + 0.8 * u_swell);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += specCol * rim * glassW * (0.5 + 1.0 * u_high + 0.6 * u_kick);
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND look.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.7 + 1.2 * u_high + 0.9 * u_mid);
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.12 + 0.5 * u_high) * (0.5 + 0.5 * mat);

  // Core glow.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.5 + 1.4 * u_low + 1.6 * u_kick + 0.6 * u_bar);

  // Section-transform bloom.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.4 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // Rebirth dissolve.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses.
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  field += fresh * (1.0 - u_decay) * (3.0 + 1.6 * u_swell + 1.0 * u_drop);

  // ---- BEAT-SCHEDULED SHARD VOLLEYS (the upgraded system).
  // Each armed slot is a volley fired at a grid crossing: a faceted shard
  // fan cracks the relief at u_vAng and ejects outward. Mid-kill drains the
  // shard color to clear glass; kick flash-refracts airborne shards.
  // Facet fineness is a legibility cue for the subdivision the highs chose.
  float shardColW = clamp(0.35 + 0.65 * eqGate(u_eqMid) / 1.7, 0.2, 1.0);
  vec3 shardTint = mix(
    mix(vec3(0.8, 0.92, 1.0), specCol, 0.5),  // cold refractive splinter
    sandCol,                                   // inherits sand tint
    mat
  );
  // Mid kill: pull the tint toward clear glass (colorless, high-key).
  vec3 clearGlass = vec3(0.85, 0.93, 1.0);
  shardTint = mix(clearGlass, shardTint, shardColW);

  float shardMass = 0.0;
  float glintMass = 0.0;
  for (int i = 0; i < 6; i++) {
    float amp = u_vAmp[i];
    if (amp <= 0.001) continue;
    vec2 s = shardFan(ang, r, formR, u_vAng[i], u_vAge[i], amp, u_vMat[i],
                      u_subGlint, gl_FragCoord.xy + float(i) * 91.7);
    shardMass += s.x;
    glintMass += s.y;
  }

  // ---- CONTINUOUS SHARD STORM (drop). Quantization dissolves: shards spawn
  // every frame from a sweeping crack, riding max(drop, energy). This is the
  // quantized->continuous contrast. Several concurrent phase-offset fans.
  if (u_storm > 0.02) {
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float ejAng = u_stormPhase + fk * 1.5708 + 0.7 * sin(t * (1.3 + fk));
      float ejAge = fract(t * (1.4 + 0.3 * fk) + fk * 0.25) * 0.5; // rolling ages
      vec2 s = shardFan(ang, r, formR, ejAng, ejAge, u_storm, mat,
                        u_subGlint, gl_FragCoord.xy + fk * 57.3);
      shardMass += s.x * 0.8;
      glintMass += s.y * 0.8;
    }
  }

  // Kick FLASH-REFRACTION: airborne shards catch the kick wavefront + downbeat
  // and glint white-hot. Localized to the shard mass (not a full-field flash).
  float glint = glintMass * (0.5 + 1.6 * u_kick + 0.8 * u_bar);
  field += shardTint * shardMass * u_shards * 1.4;
  field += mix(shardTint, vec3(1.0, 0.98, 0.92), 0.6) * glint * u_shards * 0.9;

  // Whole-frame kick + bar punch.
  field *= 1.0 + 0.1 * u_kick + 0.05 * u_bar;

  // Temperature grade.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  field *= 0.78 + 0.42 * max(u_drop, u_swell) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

/** splitmix32-style scalar hash → stable [0,1). */
function splitmix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) / 4294967296;
}

/** Four stable genome scalars in [0,1] from a seed. */
function genomeOf(seed: number): [number, number, number, number] {
  let s = Math.floor(seed) | 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x6d2b79f5) | 0;
    out.push(splitmix(s + i * 0x2545f491));
  }
  return [out[0], out[1], out[2], out[3]];
}

export const g08ShardsStormPreset: VisualizerPreset = {
  id: 'g08-shards-storm',
  name: 'g08 shards-storm',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'grain', label: 'sand grain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'glass', label: 'glass caustics', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'shards', label: 'glass shards', min: 0, max: 2, step: 0.05, default: 1 },
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
    // Song genome + rebirth cross-fade.
    let currentSeed = -1;
    let genome: [number, number, number, number] = genomeOf(0);
    let rebirth = 1;
    let seeded = false;
    // Smoothed dominant-deck EQ.
    let eqLow = 0.5;
    let eqMid = 0.5;
    let eqHigh = 0.5;
    // Persistent 24-band spectrum buffer.
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    // ---- BEAT-SCHEDULED VOLLEY state.
    // Ring of concurrent airborne volleys. Each grid crossing fires one.
    const vAge = new Float32Array(MAX_SHARDS).fill(999);
    const vAmp = new Float32Array(MAX_SHARDS);
    const vAng = new Float32Array(MAX_SHARDS);
    const vMat = new Float32Array(MAX_SHARDS);
    let vNext = 0;
    // Fractional grid position we last fired a volley at (integer step count).
    // The subdivision density (steps per bar) is chosen by high-band energy.
    let lastVolleyStep = -1;
    let smoothHigh = 0;   // smoothed high band -> chooses the RHYTHM
    let stormPhase = 0;   // continuous crack azimuth during the drop storm
    let smoothStorm = 0;  // eased 0 (quantized) .. 1 (continuous storm)
    // Free-running fallback clock when no grid is present.
    let freeStep = 0;

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

        // Dominant audible deck.
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

        // Excitement split by bass presence; smoothed.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const swellTarget = Math.min(1, (frame.bands.low + frame.bands.mid) * 0.7 + smoothDrop * 0.4);
        smoothSwell += (swellTarget - smoothSwell) * (1 - Math.exp(-dt / 0.5));

        // Inner-flow phase.
        const flowSpeed = frame.beat?.bpm
          ? ((frame.beat.bpm / 60) * Math.PI * 2) / 8
          : 0.35;
        flow += dt * flowSpeed * (0.6 + 0.9 * smoothMaterial);

        // Phrase growth + bar pulse (ladderBarIndex ?? barIndex).
        let phrase = 0;
        let phraseIndex = lastPhraseIndex;
        let bar = 0;
        const beat = frame.beat;
        let tierBar: number | null = null;
        let barPhase = 0;
        if (beat) {
          tierBar = beat.ladderBarIndex ?? beat.barIndex;
          barPhase = beat.barPhase;
          const barInPhrase = ((tierBar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + barPhase) / PHRASE_BARS;
          phraseIndex = Math.floor(tierBar / PHRASE_BARS);
          bar = Math.pow(1 - barPhase, 2.4);
        } else {
          phrase = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
          bar = 0.5 - 0.5 * Math.cos(frame.time * 1.4);
        }
        phrase = Math.min(1, phrase * grow);

        // Section transformation.
        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          section = 1;
          flip = -flip || 1;
        }
        lastPhraseIndex = phraseIndex;
        section = Math.max(0, section - dt / 1.1);

        // SONG GENOME.
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

        // Deck EQ kills.
        const eqAlpha = 1 - Math.exp(-dt / 0.15);
        const targetLow = dom?.eq.low ?? 0.5;
        const targetMid = dom?.eq.mid ?? 0.5;
        const targetHigh = dom?.eq.high ?? 0.5;
        eqLow += (targetLow - eqLow) * eqAlpha;
        eqMid += (targetMid - eqMid) * eqAlpha;
        eqHigh += (targetHigh - eqHigh) * eqAlpha;

        // Fill the 24-band spectrum; track loudest band → crack azimuth.
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

        // Traveling kick pressure wave.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.25);
        }

        // ---- BEAT-SCHEDULED VOLLEY SCHEDULER ----
        // Highs choose the RHYTHM: quiet highs = 1 volley/bar, busy highs =
        // eighth-note volleys. Density is quantized to musical subdivisions
        // {1, 2, 4, 8} steps per bar so hits land exactly on the grid.
        smoothHigh += (frame.bands.high - smoothHigh) * (1 - Math.exp(-dt / 0.25));
        const highDrive = Math.min(1, smoothHigh * 1.4);
        const DENSITIES = [1, 2, 4, 8];
        // Map high energy → an index into DENSITIES (integer, never interpolated).
        const dIdx = Math.min(
          DENSITIES.length - 1,
          Math.max(0, Math.floor(highDrive * DENSITIES.length))
        );
        const stepsPerBar = DENSITIES[dIdx];
        // subGlint: normalized density cue for facet fineness in the shader.
        const subGlint = dIdx / (DENSITIES.length - 1);

        // Age all airborne volleys.
        for (let i = 0; i < MAX_SHARDS; i++) {
          vAge[i] += dt;
          // Decay strength so old volleys free their slot for GLSL skips.
          vAmp[i] *= Math.exp(-dt * 1.9);
          if (vAmp[i] < 0.01) vAmp[i] = 0;
        }

        // Current integer grid step (steps advance stepsPerBar times per bar).
        let stepNow: number;
        let barForDir: number;
        if (beat && tierBar !== null) {
          const barFloat = tierBar + barPhase;
          stepNow = Math.floor(barFloat * stepsPerBar);
          barForDir = tierBar;
        } else {
          // Free clock: advance by bpm (or 120) at the chosen density.
          const bpm = beat?.bpm ?? 120;
          freeStep += dt * (bpm / 60 / 4) * stepsPerBar; // 4 beats/bar assumed
          stepNow = Math.floor(freeStep);
          barForDir = Math.floor(freeStep / stepsPerBar);
        }

        // Fire one volley per new grid step. Gate on mid/high presence so it
        // stays shrapnel, not silence-triggered. Size is NOT high-driven.
        const shardGate = Math.min(1, 0.35 * frame.bands.mid + 0.65 * frame.bands.high);
        if (stepNow !== lastVolleyStep && lastVolleyStep >= 0 && shardGate > 0.06) {
          // Volley DIRECTION rotates per bar (quantized to the bar index) so
          // successive bars throw to new quadrants; within a bar the crack
          // still tracks the loudest spectral region for variety.
          const seedPhase = (genome[3] % 1) * Math.PI * 2;
          const barRot = (((barForDir % 4) + 4) % 4) * (Math.PI / 2);
          const specAng = (loudIdx / SPECTRUM_BANDS) * Math.PI * 2;
          vAng[vNext] = barRot + seedPhase + specAng * 0.5;
          vAge[vNext] = 0;
          // Uniform-ish strength — the schedule (not size) is the high response.
          vAmp[vNext] = Math.min(1, 0.55 + 0.35 * shardGate);
          vMat[vNext] = smoothMaterial;
          vNext = (vNext + 1) % MAX_SHARDS;
        }
        if (stepNow !== lastVolleyStep) lastVolleyStep = stepNow;

        // ---- CONTINUOUS STORM (drop). Ride max(drop, energy); ease so the
        // quantized->continuous flip is a swell, not a snap.
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const stormTarget = Math.min(1, Math.max(0, (Math.max(smoothDrop, energy) - 0.45) / 0.4));
        smoothStorm += (stormTarget - smoothStorm) * (1 - Math.exp(-dt / 0.35));
        // Storm crack sweeps continuously (bpm-locked when gridded).
        const stormSpin = beat?.bpm ? (beat.bpm / 60) * Math.PI * 0.5 : 1.1;
        stormPhase = (stormPhase + dt * stormSpin) % (Math.PI * 2);

        // Genome symmetry.
        const symmetry = 3 + Math.floor(genome[0] * 7);

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
          u_shards: frame.params.shards ?? 1,
          u_spectrum: spectrum,
          // Volley uniforms.
          u_storm: smoothStorm,
          u_stormPhase: stormPhase,
          u_subGlint: subGlint,
          u_vAge: vAge,
          u_vAmp: vAmp,
          u_vAng: vAng,
          u_vMat: vMat,
        };
      },
    });
  },
};

export default g08ShardsStormPreset;
