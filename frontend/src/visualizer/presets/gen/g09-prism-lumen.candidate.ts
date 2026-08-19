/**
 * "g09 prism-lumen" — a BRIGHTNESS FIX + SPECTRAL PALETTE of g07-voyage-prism.
 *
 * PARENT: g07-voyage-prism (1015, unified-palette rewire — stars/ring/coal/
 * streak/shock all sample the ONE traveling palette; that unification worked
 * and is kept verbatim in structure).
 *
 * Human note (verbatim): "has potential but far too bright to see anything at
 * high energy".
 *
 * DIAGNOSIS: at high energy the parent drove LUMINANCE up in many places at
 * once, and — being a feedback preset — some of those compounded frame over
 * frame until the soft knee pegged the whole screen white (exactly the
 * contraction-rule failure mode). The offenders:
 *   - final grade  sky *= 0.72 + 0.45*lift  (reaches 1.17x -> a whole-field
 *     multiply > 1, sustained on drops: the feedback field blooms to white).
 *   - kick punch   sky *= 1.0 + 0.1*u_kick  (another whole-field multiply > 1).
 *   - saturate3(sky, 1 + 0.35*lift) then a permissive knee at 0.8.
 *   - fresh injection scaling (3.2 + 1.6*sustain) already bounded by (1-decay)
 *     so that part is fine; the WHOLE-FIELD grades were the leak.
 *
 * BRIGHTNESS FIX (this candidate) — energy drives COLOR, never luminance:
 *  (1) The whole-field grade is now CONTRACTIVE: capped at min(x, 0.99) and it
 *      never multiplies the field UP. Drop/sustain no longer brighten the
 *      grade; they push HUE TRAVEL and SATURATION instead.
 *  (2) The kick whole-field multiply is GONE. The kick still lands as a
 *      localized two-tone shock (fresh injection, bounded), never a field-wide
 *      brighten.
 *  (3) Every energy/drop-scaled LUMINANCE term is re-pointed: drop advances the
 *      palette phase (color travel) and lifts saturation; it does not add
 *      brightness. The high-energy state is VIVID and DARK-FLOORED.
 *  (4) A hard dark floor + tighter knee (0.72) keep the field readable; the
 *      feedback decay is unchanged so the medium persists.
 *
 * GEN-9 SPECTRAL PALETTE — the four fixed banks are REPLACED by ONE continuous
 * spectrally-informed palette:
 *   - hue CENTER = slow centroid (~1 s EMA).
 *   - hue SPAN   = spread (narrow sound = tight hue band, wide = full wheel).
 *   - SATURATION = (1 - flatness) (tonal = vivid, noisy = washed).
 *   - u_palette is now a HUE-OFFSET knob on top of the spectral center.
 * Every element still samples this ONE palette (the parent's unification):
 * stars, gravity, charge ring, coal heart, lens streak, disk, nebula,
 * shockwave (complement), snare arc, powder.
 *
 * Standing law honored: FEEDBACK CONTRACTION RULE (no sustained field multiply
 * > 1; whole-field grades capped at min(x, 0.99); drama in the fresh-injection
 * term bounded by (1-decay)), hard photosafety, wide-phase palette travel.
 *
 * Geometry / motion / dynamics are the parent's, verbatim.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

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
uniform float u_centroid;  // harmonic content: extra palette phase
uniform float u_drop;      // excitement WITH bass -> COLOR TRAVEL + saturation
uniform float u_buildup;   // excitement WITHOUT bass -> cool color travel
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
uniform float u_hueOffset;  // palette HUE-OFFSET knob (was 4-bank blend)
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven star burst gain
uniform float u_specHue;    // SPECTRAL hue center = slow centroid (~1 s EMA)
uniform float u_specSpan;   // SPECTRAL hue span = spread
uniform float u_specSat;    // SPECTRAL saturation = (1 - flatness)

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

// Saturation lift/cut: pull a color toward or away from its own luma.
vec3 saturate3(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(l), c, amt), 0.0, 2.0);
}

// GEN-9 SPECTRAL PALETTE (replaces the four fixed banks). ONE continuous
// palette informed by the spectrum:
//   hue CENTER = u_specHue (slow centroid), plus the u_hueOffset knob.
//   hue SPAN   = u_specSpan (spread): the local phase argument t modulates the
//                hue over a band whose WIDTH is the spread (narrow sound = one
//                concentrated hue, wide = the whole wheel travels).
//   SATURATION = u_specSat (1 - flatness): tonal vivid, noisy washed.
// iq cosine form (bright, saturated — this repo dislikes pastels). Drop/buildup
// move only the PHASE (color travel), never brightness.
vec3 palette(float t) {
  // Center hue: slow spectral centroid + the knob + gentle centroid dither.
  float center = u_specHue + u_hueOffset + u_centroid * 0.15;
  // Span: local t travels a band whose width is the spread (0.25 .. 1.0 turn).
  float span = 0.25 + 0.75 * clamp(u_specSpan, 0.0, 1.0);
  // COLOR TRAVEL from energy: drop pushes the phase forward (warm-ward),
  // buildup pushes it back (cool-ward). Luminance is untouched.
  float phase = center + span * (t - 0.5) + 0.18 * u_drop - 0.12 * u_buildup;
  vec3 base = vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * phase + vec3(0.0, 0.33, 0.67)));
  // Spectral saturation (1 - flatness), lifted a touch on drops (color, not
  // brightness). Clamped so it stays a chroma move.
  float sat = clamp(u_specSat + 0.35 * u_drop, 0.2, 1.0);
  return saturate3(base, 0.6 + 0.9 * sat);
}

// A palette color pushed toward a warm accent by "heat" — the shared HOT RAMP
// for the horizon ring and coal heart. NOTE: unlike the parent this no longer
// blasts to WHITE (that was the high-energy washout); it warms and saturates
// but keeps a dark ceiling so the core stays legible.
vec3 hotPal(float t, float heat) {
  vec3 base = saturate3(palette(t), 1.2);
  // Warm accent (amber-gold), NOT white — heat shifts hue + saturation, and
  // adds only a bounded, sub-unity lift.
  vec3 warm = saturate3(palette(t + 0.08), 1.3) * 0.9 + vec3(0.12, 0.07, 0.0);
  return mix(base, warm, clamp(heat, 0.0, 1.0));
}

// The complement of the palette at phase t (half a cosine cycle away) — the
// opposing hue for the shockwave's leading edge (two-tone kick ring).
vec3 palComplement(float t) {
  return saturate3(palette(t + 0.5), 1.3);
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
  // Each star samples the ONE spectral palette at its own hash offset.
  float ph = hash(sc.yx + 29.3);
  vec3 tint = saturate3(palette(ph * 1.6 + u_time * 0.02), 1.1);
  tint = mix(tint, vec3(0.9, 0.95, 1.0), 0.14 * hash(sc + 5.1));
  return tint * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

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
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
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
  // Feedback tap: contractive. sampled*1.35 - blur*0.35 is an unsharp tap; the
  // whole thing is multiplied by u_decay (< 1), so the persistent field can
  // only CONTRACT frame over frame (no sustained > 1 multiply anywhere).
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

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
  // Gravity wave: spectral palette, warm slice. Gain rides BASS (a solid
  // low-frequency response), not overall energy -> no energy luminance creep.
  vec3 gravityColor = hotPal(0.05 + t * 0.015, 0.15 + 0.25 * u_kick);
  fresh += gravityColor * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;

  // EVENT HORIZON RING — spectral-palette hot ramp. Charge shifts hue/warmth,
  // NOT toward white. Bass + kick drive it (solid responses), bounded.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = hotPal(0.0 + t * 0.01, 0.15 + 0.6 * clamp(u_charge, 0.0, 1.0));
  fresh += chargeColor * ringGlow * (0.12 + 0.55 * u_low + 0.9 * u_kick + 0.4 * u_charge);
  // Ring core: a warm palette accent (was mix toward white) — kept off the
  // white rail so the drop stays legible.
  fresh += saturate3(chargeColor, 1.3) * ringCore
    * (0.3 + 1.1 * bassOn + 1.8 * u_kick + 0.6 * u_charge);

  // THE HEART — spectral hot core. Whitens only slightly under a kick (a
  // bounded transient), dark at rest (steep falloffs preserve contrast).
  vec3 hotCore = hotPal(0.02 + t * 0.012, 0.35 * u_kick);
  fresh += hotCore * heart * (0.5 + 1.0 * u_low + 1.1 * u_kick);
  fresh += hotPal(0.08 + t * 0.01, 0.1) * corona * (0.1 + 0.5 * u_low + 0.3 * u_kick);

  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);

  // ANAMORPHIC LENS STREAK — a wide phase offset of the spectral palette. Its
  // gain rides bass/kick (solid responses), not overall energy.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  vec3 streakColor = saturate3(palette(0.7 + t * 0.03), 1.2);
  fresh += streakColor * streak * (0.25 + 1.0 * u_low + 0.7 * u_kick);

  // The disk: spiral lanes + clouds in the ONE spectral palette.
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;

  // HIGH NEBULA — a wide phase of the spectral palette, cooler accent.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = saturate3(palette(0.85 + t * 0.04), 1.25);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.5 * u_high) * u_dust * reverb;

  // FRESH INJECTION into the persistent field, bounded by (1 - u_decay). The
  // DRAMA lives HERE (the contraction rule's sanctioned home), NOT in a
  // whole-field multiply. sustain scales injection only within (1-decay).
  sky += fresh * (1.0 - u_decay) * (3.0 + 1.4 * u_sustain);

  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps (bounded envelopes; no whole-field multiply).
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    // Two-tone shock: a spectral-palette body with a COMPLEMENTARY leading
    // edge. Drop cranks SATURATION (color), not raw flash.
    float shockBody = exp(-pow((r - ringR) * 38.0, 2.0));
    float shockEdge = exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    vec3 bodyCol = hotPal(0.1 + t * 0.01, 0.3 + 0.3 * u_kick);
    vec3 edgeCol = palComplement(0.1 + t * 0.01);
    sky += bodyCol * shockBody * u_kick * (1.0 + 0.5 * u_drop);
    sky += edgeCol * shockEdge * 0.6 * u_kick * (0.9 + 0.5 * u_drop);
    // NOTE: the parent's  sky *= 1.0 + 0.1*u_kick  whole-field multiply is
    // REMOVED (contraction rule) — the kick reads via the localized rings.
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += saturate3(palette(0.3 + t * 0.02), 1.2) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    // Snare powder — fully palette-tinted.
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), saturate3(palette(0.15), 1.15), 0.6);
  }

  // Film grain — fine (a touch louder through the drop, still bounded).
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.018 * u_drop);

  // ---- WHOLE-FIELD GRADE (CONTRACTIVE — contraction rule).
  // The frame leans toward the spectral palette hue. Energy pushes HUE and
  // SATURATION here, NEVER a brightening multiply. The grade factor is capped
  // at min(x, 0.99) so it can only hold or DARKEN the field, never amplify it.
  vec3 grade = palette(0.35);
  vec3 tinted = sky * (0.35 + grade * 1.2);
  sky = mix(sky, tinted, 0.28);
  // DROP/sustain -> SATURATION lift (color pop), not luminance.
  float lift = max(u_drop, u_sustain);
  sky = saturate3(sky, 1.0 + 0.4 * lift);
  // Whole-field grade factor: at most 0.99 (never > 1). Drops DARKEN the floor
  // slightly (dark-floored high-energy state) so vivid color reads.
  float gradeFactor = min(0.99, 0.86 - 0.14 * lift - 0.05 * u_buildup);
  sky *= gradeFactor;
  // Tight chroma-preserving knee (0.72) — pulls the ceiling well below white so
  // the high-energy field stays legible instead of washing out.
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.72) {
    sky *= (0.72 + 0.12 * (1.0 - exp(-(m - 0.72) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

export const prismLumenPreset: VisualizerPreset = {
  id: 'g09-prism-lumen',
  name: 'g09 Prism Lumen',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'hue', label: 'palette hue offset', min: 0, max: 1, step: 0.02, default: 0 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    // Slow spectral trackers (~1 s EMA): hue center + span + saturation.
    let slowCentroid = 0.5;
    let slowSpread = 0.5;
    let slowFlatness = 0.5;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(drop, 0.7 * sustained);

        // --- Slow spectral trackers (~1 s EMA) for the gen-9 palette.
        const specAlpha = 1 - Math.exp(-dt / 1.0);
        slowCentroid += (frame.centroid - slowCentroid) * specAlpha;
        slowSpread += (frame.spread - slowSpread) * specAlpha;
        slowFlatness += (frame.flatness - slowFlatness) * specAlpha;

        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          u_rotStep: (0.05 + 0.5 * frame.bands.mid + 0.5 * buildup + 0.25 * sustained) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_hueOffset: frame.params.hue ?? 0,
          u_specHue: slowCentroid,
          u_specSpan: slowSpread,
          u_specSat: Math.min(1, Math.max(0.2, 1 - slowFlatness)),
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (frame.params.stars ?? 1) *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (frame.params.stars ?? 1) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
        };
      },
    });
  },
};

const candidate: VisualizerPreset = prismLumenPreset;
export default candidate;
