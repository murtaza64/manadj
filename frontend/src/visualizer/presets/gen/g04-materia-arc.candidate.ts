/**
 * g04-materia-arc (gen-4 TWEAK of g03-materia-deep, #3-rated).
 *
 * Keeps materia-deep's feel intact — one central organic form whose MATERIAL
 * is the spectral shape, spectrum-sculpture surface, deck EQ region kills,
 * song genome, kick pressure waves, chroma-preserving soft knee. The tweak
 * grafts a full DYNAMIC-RANGE ARC on top, phrase-quantized:
 *
 *   GROWTH STAGES. The form has a discrete growth STAGE (0..STAGES-1):
 *     stage 0 = seed-crystal (small, dark, slow, near-still),
 *     top stage = molten drop-form (huge, bright, fast, churning).
 *   The stage TARGET tracks demanded energy (drop/swell/loudness), but the
 *   COMMITTED stage only steps at PHRASE BOUNDARIES — the form upgrades or
 *   sheds a stage on the downbeat of a new phrase, never mid-phrase. In the
 *   LAST BAR of a phrase the pending change is TEASED (a partial preview:
 *   the seed cracks / the drop-form flares) so the boundary lands as payoff.
 *
 *   TRUE DYNAMIC RANGE. `u_range` = eased committed stage in [0,1]. It drives
 *   form radius, surface complexity, churn speed, feedback injection, heart
 *   brightness AND a global brightness/decay floor: when quiet the whole
 *   frame goes small, dark and slow (restrained, never flat-flashing); when
 *   the music goes hard it blooms to maximal. Restraint at the bottom is the
 *   point — the top only reads as huge because the floor got quiet.
 *
 * Photosensitivity floor respected (gated flashes, chroma soft knee, no
 * saturated-red strobe). Stage steps are eased (~0.6 s) so upgrades surge
 * rather than snap.
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
uniform float u_centroid;   // temperature 0 cold .. 1 hot
uniform float u_material;   // 0 liquid glass .. 1 granular sand
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
uniform float u_range;      // ARC: eased committed growth stage 0..1
uniform float u_tease;      // ARC: last-bar preview of a pending stage change 0..1
uniform float u_teaseDir;   // ARC: +1 upgrade pending, -1 shed pending, 0 none
uniform float u_stageStep;  // ARC: fresh-commit surge 0..1 (decays)
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

// SPECTRUM SCULPTURE: sum the 24 bands as angular harmonics. Band index maps
// to harmonic order — low bins few large lobes, high bins many fine ripples.
// ARC: high-order (fine) ripple bands are muted at low range and revealed as
// the form grows, so the seed-crystal reads clean and the drop-form crusty.
float sculpt(float ang, float r, float t) {
  float disp = 0.0;
  for (int b = 0; b < 24; b++) {
    float fb = float(b);
    float order = u_symmetry + fb * 0.75;
    float g = fb < 8.0 ? u_eqLow : (fb < 16.0 ? u_eqMid : u_eqHigh);
    g = eqGate(g);
    float fall = 1.0 / (1.0 + fb * 0.35);
    // Range reveal: low bands always present; fine bands fade in with growth.
    float reveal = clamp(u_range * 1.4 - fb * 0.03, 0.15, 1.0);
    float ph = t * (0.15 + fb * 0.03) + u_seed * (0.11 + fb * 0.017)
      + r * (2.0 + fb * 0.6);
    disp += u_spectrum[b] * g * fall * reveal * sin(ang * order + ph);
  }
  return disp;
}

// Temperature palette: cold indigo/teal at low centroid, hot amber/white at
// high — wide-phase cosine so the tint TRAVELS with the surface field.
vec3 tempPalette(float t, float temp) {
  vec3 cold = vec3(0.18, 0.5, 0.95) + vec3(0.2, 0.35, 0.3)
    * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.55, 0.42, 0.3)));
  vec3 hot = vec3(1.0, 0.62, 0.18) + vec3(0.4, 0.35, 0.2)
    * cos(6.28318 * (vec3(1.0, 0.9, 0.7) * t + vec3(0.0, 0.1, 0.2)));
  return mix(cold, hot, clamp(temp, 0.0, 1.0));
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
  // ARC master: eased committed stage, plus a partial tease of what's coming.
  float rng = clamp(u_range + u_tease * u_teaseDir * 0.22, 0.0, 1.0);

  // ---- Warp / advection of the accumulated material.
  // Churn scales with the arc: seed is near-still, drop-form churns hard.
  float churnScale = mix(2.4, 7.5, mat) * (0.7 + 0.6 * rng);
  float churnSpeed = mix(0.08, 0.9, mat) * (0.25 + 1.4 * rng);
  vec2 churn = (vec2(
    fbm(c * churnScale + u_flow + t * churnSpeed),
    fbm(c * churnScale + vec2(9.1, 4.7) - u_flow - t * churnSpeed)
  ) - 0.5) * mix(0.006, 0.02, mat) * (0.3 + 1.4 * rng) * (1.0 + 0.7 * u_mid);

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

  // Section transform: a violent radial inversion pulse — space folds. The
  // stage-commit surge borrows this fold so an upgrade physically ERUPTS.
  float stageFold = u_stageStep * u_teaseDir;
  float fold = (u_section + 0.5 * u_stageStep) * 0.06 * sin(r * 20.0 - t * 6.0)
    * (u_flip + stageFold);
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
  // Radius spans a WIDE arc: seed-crystal tiny, drop-form huge. Still pulses
  // with the bar and swells with loudness, but the arc sets the envelope.
  float formR = mix(0.075, 0.34, rng) + 0.05 * u_phrase * rng
    + 0.06 * u_swell + 0.05 * u_low + 0.03 * u_bar + 0.04 * u_stageStep;
  float surfFreq = mix(3.0, 11.0, mat) * (0.6 + 0.9 * rng) * (1.0 + 0.5 * u_phrase);
  float surfAmp = mix(0.045, 0.11, mat) * (0.35 + 0.9 * rng);
  float surf = fbm(vec2(ang * surfFreq * 0.5 + u_flow * 0.5, r * surfFreq + t * mix(0.1, 1.4, mat) * (0.3 + rng)));
  // SPECTRUM SCULPTURE displacement scales up along the arc.
  float spec = sculpt(ang, r, t) * u_gSculpt * (0.05 + 0.09 * rng);
  float rr = r + (surf - 0.5) * surfAmp - spec * u_rebirth;
  // Edge: seed-crystal crisp/faceted, drop-form molten-soft.
  float edge = mix(0.015, 0.09, mat) + 0.05 * rng + 0.03 * u_buildup;
  float body = smoothstep(formR + edge, formR - edge, rr);
  float interior = smoothstep(formR, 0.0, rr);

  float temp = clamp(u_centroid, 0.0, 1.0);
  vec3 fresh = vec3(0.0);

  // GLASS look: caustic web + wet specular rim. Weighted by (1-mat).
  float glassW = (1.0 - mat) * u_glass;
  float caustic = pow(abs(sin((surf + fbm(c * 5.0 + u_flow)) * 6.28318 + t * 0.8)), 8.0);
  vec3 glassCol = tempPalette(surf * 1.2 + r * 0.4 + t * 0.03, temp);
  fresh += glassCol * caustic * interior * glassW * (0.4 + 1.4 * u_mid + 0.8 * u_swell) * (0.4 + 0.9 * rng);
  float rim = exp(-pow((rr - formR) * 60.0, 2.0));
  vec3 specCol = mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.95, 0.85), temp);
  fresh += specCol * rim * glassW * (0.4 + 1.0 * u_high + 0.6 * u_kick);
  // Sculpted ridges catch extra rim light — embossed spectrum relief.
  fresh += specCol * rim * glassW * abs(spec) * 6.0 * (0.4 + 0.8 * u_high);

  // SAND look: granular scatter, dry matte, temperature-tinted.
  float matW = mat * u_grain;
  float g1 = hash(floor(c * mix(90.0, 240.0, u_high) + vec2(fract(u_seed * 0.7131) * 53.0, fract(u_seed * 0.3719) * 37.0)));
  float g2 = hash(floor(c * 150.0 + u_flow * 3.0 + 7.3));
  float grain = pow(max(g1, g2) * (0.4 + 0.6 * surf), 2.2);
  vec3 sandCol = tempPalette(surf * 0.8 + grain * 0.5 + t * 0.02, temp);
  fresh += sandCol * grain * body * matW * (0.5 + 1.2 * u_high + 0.9 * u_mid) * (0.4 + 0.9 * rng);
  fresh += sandCol * grain * body * matW * abs(spec) * 5.0 * (0.5 + 0.9 * u_high);
  float staticN = hash(gl_FragCoord.xy + fract(t * 3.0) * 211.0);
  fresh += sandCol * staticN * body * matW * (0.1 + 0.5 * u_high) * (0.5 + 0.5 * mat) * (0.3 + rng);

  // Core glow — the heart. Seed-crystal keeps a faint cold ember; drop-form
  // burns bright. Pumped by the bar pulse and the stage-commit surge.
  float heart = exp(-rr * rr * (12.0 - 6.0 * u_kick) / max(formR, 0.05));
  vec3 heartCol = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.75, 0.4), temp);
  heartCol = mix(heartCol, vec3(1.0, 0.97, 0.9), 0.5 * u_kick);
  fresh += heartCol * heart * (0.18 + 0.3 * rng + (0.9 + 1.4 * rng) * u_low
    + (1.0 + 1.2 * rng) * u_kick + 0.6 * u_bar + 1.1 * u_stageStep);

  // Section-transform bloom: on the pulse the whole form ERUPTS.
  vec3 burstCol = mix(tempPalette(t * 0.05, temp), vec3(1.0), 0.4 * u_section);
  float burst = exp(-pow((r - (0.15 + u_section * 0.5)) * 5.0, 2.0));
  fresh += burstCol * burst * u_section * (1.2 + 1.2 * u_drop);
  fresh += tempPalette(0.5 + t * 0.04, 1.0 - temp) * interior * u_section * 0.6;

  // STAGE-COMMIT eruption: a bright expanding shell on the phrase boundary
  // where the form steps up (or a collapsing implosion when it sheds).
  float stageFrontR = 0.1 + (1.0 - u_stageStep) * 0.55;
  float stageShell = exp(-pow((r - stageFrontR) * 6.0, 2.0)) * u_stageStep;
  vec3 stageCol = mix(sandCol, glassCol, 1.0 - mat);
  fresh += stageCol * stageShell * (0.9 + 1.3 * rng) * (0.7 + 0.5 * u_teaseDir);

  // Rebirth dissolve during a track change.
  float rebirthGlow = (1.0 - u_rebirth) * exp(-pow((r - 0.3) * 4.0, 2.0));
  fresh += mix(glassCol, sandCol, mat) * rebirthGlow * (1.0 + u_swell);

  // Kick pressure wave LIGHTS the material it crosses.
  float reverb = 2.4 * rippleWave;
  fresh += mix(glassCol, sandCol, mat) * reverb * (0.6 + 0.6 * u_swell) * (body * 0.4 + interior);

  // Inject fresh at (1 - decay). Injection scales with the arc so the seed is
  // dim and restrained while the drop-form blooms — the dynamic-range floor.
  field += fresh * (1.0 - u_decay) * (1.1 + 2.4 * rng + 1.6 * u_swell * rng + 1.0 * u_drop);

  // Snare stamp: a mid-transient ring crossing the surface (kept at all stages).
  if (u_snare > 0.03) {
    float sarc = exp(-pow((r - formR * 1.15) * 26.0, 2.0))
      * pow(0.5 + 0.5 * sin(ang * 4.0 + u_seed), 2.0);
    field += mix(vec3(0.8, 0.9, 1.0), tempPalette(0.3, temp), 0.5) * sarc * u_snare * (0.5 + 0.5 * rng);
  }

  // Whole-frame kick + bar punch — the low-end lands everywhere, solid.
  field *= 1.0 + (0.06 + 0.1 * rng) * u_kick + 0.05 * u_bar;

  // Temperature grade.
  vec3 grade = tempPalette(0.35, temp);
  field = mix(field, field * (0.45 + grade * 1.4), 0.2);
  // Global brightness floor rides the arc: quiet = dark & restrained, hard =
  // vibrant. Buildups still saturate (tense AND alive), gated by the arc.
  field *= 0.32 + 0.66 * rng + 0.4 * max(u_drop, u_swell) * (0.4 + rng) + 0.12 * u_buildup;

  // Chroma-preserving soft knee (never per-channel clamp).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.82) {
    field *= (0.82 + 0.18 * (1.0 - exp(-(m - 0.82) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const PHRASE_BARS = 16;
/** Discrete growth stages, seed-crystal (0) → molten drop-form (STAGES-1). */
const STAGES = 5;

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

/** smoothstep-style ease, 0..1. */
function ease(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

export const g04MateriaArcPreset: VisualizerPreset = {
  id: 'g04-materia-arc',
  name: 'g04 materia-arc',
  hiRes: true,
  params: [
    { id: 'material', label: 'material bias (glass↔sand)', min: -0.5, max: 0.5, step: 0.02, default: 0 },
    { id: 'sculpt', label: 'spectrum sculpt', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'grain', label: 'sand grain', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'glass', label: 'glass caustics', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'range', label: 'dynamic range', min: 0, max: 2, step: 0.05, default: 1 },
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
    // Persistent 24-band spectrum buffer (EXACTLY length 24, reused).
    const spectrum = new Float32Array(SPECTRUM_BANDS);

    // ---- ARC: phrase-quantized growth stage machine.
    // committedStage: the stage LOCKED for this phrase (integer-valued).
    // easedRange: smoothly-followed committed stage in [0,1] (u_range).
    // demand: smoothed energy demand that sets the pending target.
    let committedStage = 0;
    let easedRange = 0;
    let demand = 0;
    let stageStep = 0; // decays after each commit surge
    let teaseDir = 0; // +1 upgrade pending, -1 shed pending, 0 none

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        const persistence = frame.params.persistence ?? 1;
        const rangeGain = frame.params.range ?? 1;
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

        // Excitement split by bass presence; smoothed.
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

        // Phrase growth + bar pulse + last-bar detection.
        let phrase = 0;
        let phraseIndex = lastPhraseIndex;
        let bar = 0;
        let lastBar = 0; // 0..1 how deep into the phrase's final bar we are
        if (frame.beat) {
          const barInPhrase = ((frame.beat.barIndex % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
          phrase = (barInPhrase + frame.beat.barPhase) / PHRASE_BARS;
          phraseIndex = Math.floor(frame.beat.barIndex / PHRASE_BARS);
          bar = Math.pow(1 - frame.beat.barPhase, 2.4);
          if (barInPhrase === PHRASE_BARS - 1) lastBar = frame.beat.barPhase;
        } else {
          // No grid: soft synthetic phrase, and a slow synthetic last-bar tease.
          const p = 0.5 - 0.5 * Math.cos(frame.time * 0.08);
          phrase = p;
          bar = 0.5 - 0.5 * Math.cos(frame.time * 1.4);
          phraseIndex = Math.floor(frame.time * 0.08 / Math.PI);
          lastBar = Math.max(0, (p - 0.85) / 0.15);
        }

        // ARC demand: how much energy the music is asking for right now.
        // Rides max(drop, swell) (a TRANSITION-safe sustained state) plus raw
        // loudness, then the range slider scales the whole envelope.
        const energyNow = Math.min(
          1,
          (frame.bands.low + frame.bands.mid + frame.bands.high) / 2.2
        );
        const demandTarget = Math.min(
          1,
          (Math.max(smoothDrop, smoothSwell) * 0.75 + energyNow * 0.45 + smoothBuildup * 0.2)
            * rangeGain
        );
        demand += (demandTarget - demand) * (1 - Math.exp(-dt / 0.7));

        // Pending stage: quantize demand to a discrete stage target.
        const pendingStage = Math.min(
          STAGES - 1,
          Math.max(0, Math.round(demand * (STAGES - 1)))
        );

        // Tease in the last bar: expose the pending change direction so the
        // boundary lands as payoff (seed cracks / drop-form flares).
        if (lastBar > 0 && pendingStage !== committedStage) {
          teaseDir = pendingStage > committedStage ? 1 : -1;
        } else if (lastBar === 0) {
          teaseDir = 0;
        }

        // COMMIT at phrase boundaries only. Step ONE stage toward the pending
        // target per boundary so growth reads as staged ascent, not a jump.
        if (phraseIndex !== lastPhraseIndex && lastPhraseIndex >= 0) {
          if (pendingStage > committedStage) {
            committedStage = Math.min(STAGES - 1, committedStage + 1);
            stageStep = 1;
          } else if (pendingStage < committedStage) {
            committedStage = Math.max(0, committedStage - 1);
            stageStep = 1;
          }
          teaseDir = 0;
          // Section metamorphosis still fires on the new phrase.
          section = 1;
          flip = -flip || 1;
        }
        lastPhraseIndex = phraseIndex;
        section = Math.max(0, section - dt / 1.1);
        stageStep = Math.max(0, stageStep - dt / 0.6);

        // Ease the committed stage into [0,1] for the shader's u_range.
        const committedNorm = committedStage / (STAGES - 1);
        easedRange += (committedNorm - easedRange) * (1 - Math.exp(-dt / 0.6));
        const uRange = ease(easedRange);
        const uTease = lastBar > 0 && teaseDir !== 0 ? ease(lastBar) : 0;

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

        // Energy-tied decay. Seed stage holds trails LONGER (still, restrained);
        // drop-form scatters faster (churning, alive). The arc widens decay too.
        const energy = Math.min(1, (frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
        const baseDecay =
          0.992 - 0.004 * energy - 0.004 * smoothBuildup - 0.003 * smoothMaterial
            - 0.006 * uRange;

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
          u_range: uRange,
          u_tease: uTease,
          u_teaseDir: teaseDir,
          u_stageStep: ease(stageStep),
          u_spectrum: spectrum,
        };
      },
    });
  },
};

export default g04MateriaArcPreset;
