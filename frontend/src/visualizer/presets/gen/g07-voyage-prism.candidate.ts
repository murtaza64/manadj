/**
 * "g07 voyage-prism" — a COLOR-SYSTEM FIX of the pool leader (Voyage, 1044).
 *
 * Human note (verbatim): "the palette params in voyage family dont seem to
 * affect the dust color (always red and blue). can we make some variants
 * that spice up the dust a bit?"
 *
 * Diagnosis: in the parent (presets/voyage.ts) only the disk clouds sample
 * palette(). The star-scatter tint, LOW additive gravity wave, charge ring,
 * coal heart, lens streak and kick shockwave were all HARDCODED — that's the
 * eternal red/blue the slider never touched.
 *
 * Fix: EVERY element now derives from the traveling palette:
 *   - stars      → palette() sampled at a per-star hash offset (brightness /
 *                  size behavior untouched).
 *   - gravity    → palette hot color (was mix(dark-red, LOW)).
 *   - charge ring→ palette-derived hot ramp pushed toward white by charge.
 *   - coal heart → palette-derived hot ramp pushed toward white by kick.
 *   - lens streak→ palette sampled at a wide phase offset.
 *   - shockwave  → palette sample with a COMPLEMENTARY-color leading edge
 *                  (contrast) — the kick lands as a two-tone ring.
 *   - snare arc  → palette (as parent).
 *   - powder     → palette-tinted (as parent), boosted.
 *
 * The pal0-3 bank is replaced with four genuinely distinct hue families
 * (ember-gold, green/teal, violet/pink, electric-cyan/solar), so the slider
 * recolors the WHOLE scene together, not just the dust.
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
uniform float u_centroid;  // harmonic content: palette phase
uniform float u_drop;      // excitement WITH bass
uniform float u_buildup;   // excitement WITHOUT bass
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
uniform float u_palette;    // palette blend 0..3
uniform float u_charge;     // bass-ring charge (accumulated kick energy)
uniform float u_spawnSnare; // snare-driven star burst gain

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

// FOUR genuinely distinct hue families (the old bank clustered on
// ember/blue; the slider read as red↔blue). Each keeps iq's cosine form
// but centers on a different part of the wheel:
//   pal0 EMBER-GOLD  (deep red → orange → gold)
//   pal1 GREEN-TEAL  (forest → emerald → aqua)   <- required distinct
//   pal2 VIOLET-PINK (indigo → magenta → hot pink) <- required distinct
//   pal3 ELECTRIC    (cyan → azure → white-gold solar)
vec3 pal0(float t) { return vec3(0.50, 0.18, 0.06) + vec3(0.50, 0.34, 0.16) * cos(6.28318 * (vec3(1.0, 0.85, 0.55) * t + vec3(0.00, 0.10, 0.20))); }
vec3 pal1(float t) { return vec3(0.10, 0.42, 0.34) + vec3(0.22, 0.48, 0.42) * cos(6.28318 * (vec3(0.85, 1.0, 0.9) * t + vec3(0.35, 0.55, 0.15))); }
vec3 pal2(float t) { return vec3(0.44, 0.16, 0.48) + vec3(0.48, 0.28, 0.46) * cos(6.28318 * (vec3(1.0, 0.75, 1.0) * t + vec3(0.55, 0.85, 0.30))); }
vec3 pal3(float t) { return vec3(0.16, 0.40, 0.52) + vec3(0.34, 0.44, 0.52) * cos(6.28318 * (vec3(0.9, 0.95, 1.1) * t + vec3(0.50, 0.35, 0.10))); }

// Branchless continuous palette: the slider MORPHS between the four
// (0 ember → 1 verdant → 2 violet → 3 electric) instead of switching.
// Drop saturates+warms, buildup cools — as parent.
vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
}

// Saturation lift: pull a color away from its own luma. Drops crank it so
// the whole unified palette blooms in saturation, not just brightness.
vec3 saturate3(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(l), c, amt), 0.0, 2.0);
}

// A palette color pushed toward white by "heat" — the shared HOT RAMP for
// the horizon ring and coal heart (was two hardcoded ember→white ramps).
vec3 hotPal(float t, float heat) {
  vec3 base = saturate3(palette(t), 1.25);
  // keep saturated color at low heat, blast to white-gold at high heat.
  vec3 whiteGold = vec3(1.0, 0.95, 0.86);
  return mix(base, whiteGold, clamp(heat, 0.0, 1.0));
}

// The complement of the palette at phase t — the palette sampled half a
// cosine cycle away reads as an opposing hue. Used for the shockwave's
// leading edge so each kick lands as a contrasting two-tone ring.
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
  // TINT NOW FROM PALETTE: each star samples the traveling palette at its
  // own hash offset (was a fixed blue-white↔warm mix). A blue-white glint
  // is retained on a fraction for temperature variation, but the slider
  // moves the majority of the field.
  float ph = hash(sc.yx + 29.3);
  vec3 tint = saturate3(palette(ph * 1.6 + u_time * 0.02 + u_centroid * 0.3), 1.15);
  tint = mix(tint, vec3(0.9, 0.95, 1.0), 0.18 * hash(sc + 5.1));
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
  // GRAVITY WAVE now palette-driven (was mix(dark-red, LOW)). A warm slice
  // of the palette so the core rings speak the slider's language.
  vec3 gravityColor = hotPal(0.05 + t * 0.015, 0.15 + 0.25 * u_kick);
  fresh += gravityColor * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;

  // THE EVENT HORIZON RING — palette-derived hot ramp pushed toward white
  // as the ring CHARGES (was fixed ember→orange→white). The slider now
  // owns the ring's hue; charge only controls how white-hot it runs.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = hotPal(0.0 + t * 0.01, 0.15 + 0.7 * clamp(u_charge, 0.0, 1.0));
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);

  // THE HEART — was a fixed dark-red "coal" the palette could never reach.
  // Now a palette-derived hot core that whitens under a kick. Still dark at
  // rest (contrast preserved) because heart/corona falloffs are steep.
  vec3 hotCore = hotPal(0.02 + t * 0.012, 0.5 * u_kick);
  fresh += hotCore * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += hotPal(0.08 + t * 0.01, 0.1) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);

  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);

  // ANAMORPHIC LENS STREAK — sampled at a WIDE phase offset of the palette
  // (was a fixed blue mixed with a palette tap). Reads as a bright accent
  // hue that still tracks the slider.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  vec3 streakColor = saturate3(palette(0.7 + t * 0.03 + u_centroid * 0.3), 1.2);
  fresh += streakColor * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);

  // The disk: spiral lanes + clouds in the TRAVELING palette (as parent).
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;

  // HIGH NEBULA — was tinted toward a fixed electric blue; now a saturated
  // palette sample at a wide phase so it moves with the slider but stays a
  // distinct, cooler accent against the mid dust.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = saturate3(palette(0.85 + t * 0.04 + u_centroid * 0.2), 1.25);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- Transient stamps.
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    // Two-tone shock: a hot palette body with a COMPLEMENTARY leading edge
    // (was mix(LOW, white)). The kick reads as a contrasting ring instead
    // of an eternal red pulse. Drop cranks saturation, not raw flash.
    float shockBody = exp(-pow((r - ringR) * 38.0, 2.0));
    float shockEdge = exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    vec3 bodyCol = hotPal(0.1 + t * 0.01, 0.35 + 0.35 * u_kick);
    vec3 edgeCol = palComplement(0.1 + t * 0.01);
    sky += bodyCol * shockBody * u_kick * (1.0 + 0.7 * u_drop);
    sky += edgeCol * shockEdge * 0.6 * u_kick * (0.9 + 0.7 * u_drop);
    // Whole-frame punch: a brief lift so the kick lands everywhere.
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += saturate3(palette(0.3 + t * 0.02), 1.2) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    // Snare powder — fully palette-tinted (was mix(white, palette)).
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), saturate3(palette(0.15), 1.15), 0.6);
  }

  // Film grain — fine, a touch louder through the drop.
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  // Palette grade: the whole frame leans toward the palette hue.
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  // DROP saturates + brightens the entire unified palette (rides
  // max(drop, energy) via u_sustain). Buildups cool and dim slightly.
  float lift = max(u_drop, u_sustain);
  sky = saturate3(sky, 1.0 + 0.35 * lift);
  sky *= 0.72 + 0.45 * lift - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

export const voyagePrismPreset: VisualizerPreset = {
  id: 'g07-voyage-prism',
  name: 'g07 Voyage Prism',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→verdant→violet→electric)', min: 0, max: 3, step: 0.05, default: 1 },
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
          u_palette: frame.params.palette ?? 1,
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

const candidate: VisualizerPreset = voyagePrismPreset;
export default candidate;
