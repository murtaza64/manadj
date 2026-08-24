/**
 * g08-odyssey-beat (gen-8 TWEAK of g01-odyssey / presets/odyssey.ts).
 *
 * Human ask: odyssey variants with more BEAT-based effects + alternative
 * mid/high responses. The odyssey engine is copied verbatim into this
 * self-contained file (dust disk, high nebula, snare powder, charged
 * event-horizon ring, black-hole lens, kick ripples, unsharp feedback,
 * genome-mutated phrase theatre + section transformations). Every genome
 * mutation on phrase/section boundaries is the PARENT's — kept intact.
 *
 * THE TWEAK — a BEAT GRAMMAR bolted on top of the continuous engine:
 *
 *   POSE STRIKES (beat-quantized). The scene holds a POSE — a small
 *   quantized camera orientation (a rotation micro-step) and a fold-phase
 *   offset. On every beat the pose RE-STRIKES: the orientation snaps to the
 *   next quantized increment (no continuous drift between beats — the step is
 *   held, then jumps on the next beat), and a beat-locked "breath" pulses the
 *   warp field (u_poseStrike, decays over the beat). Kick adds pose-strike
 *   emphasis on top of the parent's ripple.
 *
 *   ALTERNATIVE MID (topology, not dust). Mids drive the warp field's
 *   TOPOLOGY — churn scale + an extra fold count that folds the warp coords
 *   more the louder the mids get (u_midTopo / u_midFold). Dust density is
 *   held back to a floor so mid energy reads as CHURNING STRUCTURE, not more
 *   powder (dust fatigue, docs law).
 *
 *   ALTERNATIVE HIGH (sparkle + rim, not powder). Highs run a SPARKLE
 *   travelling along the charged horizon ring (bright glints chasing around
 *   the ring) plus a RIM LIGHT on the coal heart / structures. The parent's
 *   high-nebula powder is suppressed; snare powder stays (beloved, docs law).
 *
 *   DROP = POSE RELEASE. On a landing drop the poses RELEASE into continuous
 *   motion: u_poseLock crossfades 1→0, so quantized orientation steps melt
 *   into the parent's smooth differential rotation, riding max(drop, energy)
 *   (the same quantized→fluid contrast as the escapement clock). It re-locks
 *   as the drop's plateau fades.
 *
 * Hard cuts/steps land exactly on the grid via `ladderBarIndex ?? barIndex`
 * + beat phase; integer things never interpolate. Photosensitivity floor
 * respected: pose strikes and sparkle are LOCALIZED pulses (exempt), the
 * drop flash is the parent's rate-limited single event; chroma-preserving
 * soft knee (never per-channel clamp). Bright saturated colors.
 */

import { energyOf } from '../../style';
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
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;      // high-transient nebula puffs (suppressed here)
uniform float u_spawnSnare; // snare star powder (kept)
uniform float u_zoom;
uniform float u_rotStep;    // signed (genome spin) — continuous component
uniform float u_charge;     // bass-ring charge
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_palette;    // genome palette (continuous)
uniform float u_arms;       // genome arm count (eased)
uniform float u_fold;       // kaleidoscope segments (0 = unfolded)
uniform float u_horizonScale;
uniform float u_flash;      // mutation flash
uniform float u_phrase;     // phrase phase 0..1
uniform float u_section;    // section phase 0..1
uniform float u_barWave;    // bar-boundary wave age
uniform float u_beatPump;
uniform float u_dust;
// --- BEAT GRAMMAR additions.
uniform float u_poseRot;    // quantized pose orientation (radians, held between beats)
uniform float u_poseLock;   // 1 = poses locked (quantized), 0 = released (fluid) on a drop
uniform float u_poseStrike; // 0..1 beat-locked breath (decays over the beat)
uniform float u_midTopo;    // mid-driven churn topology scale
uniform float u_midFold;    // mid-driven extra warp fold (continuous fold count)
uniform float u_highSpark;  // high-driven ring sparkle gain
uniform float u_highRim;    // high-driven rim light gain

const float PI = 3.141592653589793;

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

vec3 pal0(float t) { return vec3(0.42, 0.14, 0.1) + vec3(0.42, 0.24, 0.14) * cos(6.28318 * (vec3(1.0, 0.9, 0.6) * t + vec3(0.0, 0.15, 0.25))); }
vec3 pal1(float t) { return vec3(0.45, 0.28, 0.42) + vec3(0.25, 0.35, 0.5) * cos(6.28318 * (vec3(1.0, 0.85, 0.7) * t + vec3(0.0, 0.2, 0.45))); }
vec3 pal2(float t) { return vec3(0.14, 0.36, 0.32) + vec3(0.3, 0.5, 0.45) * cos(6.28318 * (vec3(0.9, 1.0, 0.8) * t + vec3(0.1, 0.3, 0.5))); }
vec3 pal3(float t) { return vec3(0.5, 0.38, 0.24) + vec3(0.48, 0.42, 0.34) * cos(6.28318 * (vec3(1.0, 0.9, 0.8) * t + vec3(0.0, 0.12, 0.25))); }

vec3 palette(float t) {
  float x = clamp(u_palette, 0.0, 3.0);
  vec3 c = mix(pal0(t), pal1(t), clamp(x, 0.0, 1.0));
  c = mix(c, pal2(t), clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, pal3(t), clamp(x - 2.0, 0.0, 1.0));
  return c + vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup;
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
  float on = step(gate - 0.09 * gain, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.6), hash(sc.yx + 29.3));
  return tint * starShape(f, size) * on * bright * gain;
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
  float anticipation = smoothstep(0.7, 1.0, u_phrase);

  // ---- POSE: a quantized camera orientation held between beats. When locked
  // (u_poseLock ~ 1) the pose rotation is applied WHOLE (a discrete step held
  // across the beat). On a drop u_poseLock -> 0 and the pose contribution
  // melts away, leaving the parent's continuous differential rotation.
  float poseAngle = u_poseRot * u_poseLock;
  float pcs = cos(poseAngle);
  float psn = sin(poseAngle);
  c = mat2(pcs, -psn, psn, pcs) * c;
  ang = atan(c.y, c.x);

  // ---- Section fold on the warp coords + MID-driven extra fold (topology).
  vec2 wc = c;
  float totalFold = u_fold + u_midFold;
  if (totalFold > 0.5) {
    float fold = PI / totalFold;
    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);
    wc = vec2(cos(fa), sin(fa)) * r;
  }

  // ---- Warp: differential rotation + churn + kick ripple + lens + pose breath.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  // MID-driven churn TOPOLOGY: mids scale the churn frequency (fold count of
  // the noise field) instead of dust density. Louder mids = finer churn.
  float churnScale = 2.0 + 2.4 * u_midTopo;
  vec2 churn = (vec2(
    fbm(c * churnScale + t * 0.12),
    fbm(c * churnScale + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.02 * u_midTopo + 0.012 * u_buildup + 0.006 * u_phrase + 0.006 * anticipation);
  // Beat-locked breath: the warp field pulses radially on each pose strike.
  vec2 poseBreath = dirW * u_poseStrike * 0.02 * (0.5 + 0.7 * u_low);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float barFront = 0.15 + u_barWave * 1.1;
  float barWave = exp(-pow((r - barFront) * 10.0, 2.0)) * exp(-u_barWave * 3.0);
  float horizon = (0.14 + 0.1 * u_low) * u_horizonScale * (1.0 + 0.07 * u_charge)
    * (1.0 + 0.04 * u_phrase * sin(t * 2.3));
  float lens = (0.3 * u_low + 1.15 * u_kick) * (1.0 + 0.7 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 src = (w + churn + ripple + poseBreath + dirW * barWave * 0.02 + dirW * lens * 0.045)
    / vec2(aspect, 1.0) + 0.5;

  // Aberration + unsharp feedback sample.
  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_flash
    + 0.006 * u_poseStrike)
    / vec2(aspect, 1.0);
  ab *= u_dust; // fringe amount rides the dust param (human note)
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
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Fresh layers (odyssey's stack + genome/phrase evolution).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  vec3 coal = vec3(0.55, 0.07, 0.04);
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  vec3 heartColor = mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick);
  fresh += heartColor * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  // HIGH RIM LIGHT: a bright cool rim on the coal heart's edge, gated by highs.
  float rimBand = exp(-pow((rc - 0.09) * 40.0, 2.0));
  vec3 rimColor = mix(vec3(0.6, 0.9, 1.0), palette(0.62), 0.4);
  fresh += rimColor * rimBand * u_highRim * (0.4 + 0.8 * u_high) * (0.6 + 0.6 * u_poseStrike);
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  fresh += mix(coal, vec3(0.9, 0.25, 0.12), 0.5) * pow(gravity, 4.0) * exp(-r * 5.0)
    * u_low * (0.5 + 0.8 * u_kick);
  // Charged horizon ring (evolution: brightens through the phrase).
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  vec3 chargeColor = mix(vec3(0.9, 0.2, 0.1), vec3(1.0, 0.75, 0.4), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  float ringGain = 1.0 + 0.5 * anticipation;
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;
  // HIGH SPARKLE: bright glints running AROUND the charged horizon ring. The
  // sparkle chases angularly with time; highs drive its gain (no powder).
  float ringBand = exp(-pow((r - horizon - arcJitter) * 34.0, 2.0));
  float sparkPhase = ang * 9.0 - t * 6.0;
  float spark = pow(0.5 + 0.5 * sin(sparkPhase), 20.0)
    + 0.6 * pow(0.5 + 0.5 * sin(sparkPhase * 1.7 + 2.1), 26.0);
  vec3 sparkColor = mix(vec3(1.0, 0.95, 0.8), vec3(0.7, 0.95, 1.0), 0.5 + 0.5 * sin(t * 2.0));
  fresh += sparkColor * ringBand * spark * u_highSpark * (0.15 + 1.4 * u_high) * ringGain;
  // Lens streak.
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(vec3(0.6, 0.75, 1.0), palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // Dust disk: genome arms; twist TIGHTENS through the phrase. MID no longer
  // drives dust density (topology instead) — dust rides a low floor + phrase.
  float twist = 4.5 + 2.5 * u_phrase;
  float arm = sin(ang * u_arms + log(r + 0.06) * twist - t * (0.06 + 0.14 * u_phrase)
    + 0.5 * u_midTopo * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + u_centroid * 0.4 + u_phrase * 0.35);
  float reverb = 1.0 + 2.6 * rippleWave + 2.2 * barWave;
  // Dust held to a floor (dust fatigue): mid energy reads as churn, not powder.
  float dustFloor = u_dust * (0.35 + 0.4 * u_phrase);
  fresh += diskColor * lanes * (0.1 + 0.35 * u_mid) * (0.5 + cloud) * dustFloor * centerDim * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.15 * dustFloor * centerDim * reverb;
  // Electric high nebula powder — SUPPRESSED (highs now go to sparkle/rim).
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(vec3(0.4, 0.9, 1.0), palette(0.6 + t * 0.03), 0.65);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.02 + 0.25 * u_high) * u_dust * reverb;
  // Section omen: a ring closing in from the screen edge over the last bars.
  float omen = smoothstep(0.8, 1.0, u_section);
  if (omen > 0.001) {
    float omenR = 1.15 - 0.75 * omen;
    fresh += palette(0.5) * exp(-pow((r - omenR) * 26.0, 2.0)) * omen * 0.8;
  }
  // Anticipation shimmer: the last bar of a phrase flickers.
  fresh *= 1.0 + 0.12 * anticipation * sin(t * 25.0);
  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);

  // ---- Stamps.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.35;
  }
  if (u_spawnSnare > 0.003) {
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2)
      * smoothstep(0.05, 0.18, r) * mix(vec3(1.0), palette(0.15), 0.45);
  }
  if (u_kick > 0.02) {
    // Kick shock ring + POSE-STRIKE emphasis (a crisp inner flare on beats).
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(coal, vec3(1.0, 0.9, 0.8), 0.6) * shock * u_kick * (1.15 + 0.8 * u_drop)
      * (1.0 + 0.6 * u_poseStrike);
    sky *= 1.0 + 0.1 * u_kick;
  }

  // Mutation flash, grain, grade, dynamics, knee.
  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.05 * u_buildup) * (1.0 + 0.06 * u_beatPump);
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const ARM_CYCLE = [2, 3, 5];
const FOLD_CYCLE = [0, 6, 8];
/** Warp modes cycled at sections: flight -> collapse -> orbit. */
const MODE_COUNT = 3;

/** Quantized pose orientation increment: each beat snaps the camera by this
 * (signed by the genome spin). A full rotation over ~24 beats reads as a slow
 * ratcheting stepped orbit — distinct from the continuous drift on drops. */
const POSE_STEP = (Math.PI * 2) / 24;

export const g08OdysseyBeatPreset: VisualizerPreset = {
  id: 'g08-odyssey-beat',
  name: 'g08 odyssey-beat',
  hiRes: true,
  params: [
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'chaos', label: 'mutation chaos', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'poseStep', label: 'pose stride', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    // fringe fix: per-song hue anchor state (dust-v3 idiom) for u_hueRot.
    let fringeCentroid = 0.5;
    let fringeAnchor = 0;
    let fringeAnchorTarget = 0;
    let fringeAnchorTrack: number | null = null;
    let paletteTarget = Math.floor(Math.random() * 4);
    let paletteCurrent = paletteTarget;
    let armIndex = 0;
    let armsCurrent = ARM_CYCLE[0];
    let foldIndex = 0;
    let modeTarget = 0;
    let modeCurrent = 0;
    let spinDirection = 1;
    let horizonTarget = 1;
    let horizonCurrent = 1;
    let flash = 0;
    let barWaveAge = 99;
    let prevBarIndex: number | null = null;
    let charge = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let prevDrop = 0;
    let lastDropAt = -99;
    let breakdownS = 0;
    let lastTime = 0;

    // --- BEAT GRAMMAR state.
    let poseRot = 0; // accumulated quantized pose orientation (held between beats)
    let poseStrike = 0; // beat-locked breath, decays over the beat
    let prevBeatCount: number | null = null; // whole beats seen (fire pose strikes)
    let poseLock = 1; // 1 = quantized poses locked, 0 = released (drop)
    let midTopo = 0; // smoothed mid topology drive
    let midFold = 0; // smoothed mid extra-fold count

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const beat = frame.beat;
        const chaos = frame.params.chaos ?? 1;
        const poseStepGain = frame.params.poseStep ?? 1;

        // Drop/buildup split first — the genome reads the musical state.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(smoothDrop, 0.7 * sustained);

        // DROP-AWARE genome (parent) + POSE RELEASE: a landing drop forces the
        // energetic scene AND releases the poses into fluid motion.
        if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastDropAt > 8) {
          lastDropAt = frame.time;
          modeTarget = 0;
          foldIndex = 0;
          paletteTarget = (paletteTarget + 2) % 4;
          horizonTarget = 1.2;
          flash = Math.min(1.4, 1.2 * chaos);
        }
        prevDrop = smoothDrop;
        if (energy < 0.15) breakdownS += dt;
        else breakdownS = 0;
        if (breakdownS > 2.5 && modeTarget !== 2) {
          modeTarget = 2; // orbit: barely any radial motion, gentle
          foldIndex = 0;
          flash = Math.max(flash, 0.25 * chaos);
        }

        // POSE LOCK target: locked (1) normally; released (0) while the drop
        // plateau rides. Rides max(drop, energy) so it stays fluid across the
        // whole drop, re-locking as it fades (quantized -> fluid contrast).
        const releaseDrive = Math.max(smoothDrop, 0.6 * sustained);
        const poseLockTarget = releaseDrive > 0.5 ? 0 : 1;
        // Smooth the lock crossfade (~0.35 s) so it melts, never snaps.
        poseLock += (poseLockTarget - poseLock) * (1 - Math.exp(-dt / 0.35));

        // Ladder-correct bar ordinal (respects Reset marks) for tiers.
        const tierBar = beat ? beat.ladderBarIndex ?? beat.barIndex : null;

        // Genome mutations at boundaries (parent, intact).
        if (beat && tierBar !== null) {
          if (prevBarIndex !== null && tierBar !== prevBarIndex) {
            barWaveAge = 0;
            const phraseBoundary = ((tierBar % 4) + 4) % 4 === 0;
            const sectionBoundary = ((tierBar % 16) + 16) % 16 === 0;
            if (phraseBoundary) {
              paletteTarget = (paletteTarget + 1) % 4;
              armIndex = (armIndex + 1) % ARM_CYCLE.length;
              flash = Math.max(flash, 0.6 * chaos);
            }
            if (sectionBoundary) {
              if (lift > 0.5) {
                modeTarget = 0;
                foldIndex = 1 + Math.floor(Math.random() * 2);
              } else {
                modeTarget = (modeTarget + 1) % MODE_COUNT;
                foldIndex = (foldIndex + 1) % FOLD_CYCLE.length;
              }
              spinDirection *= -1;
              horizonTarget = 1 + (Math.random() - 0.35) * 0.6 * chaos;
              flash = Math.min(1.4, 1 * chaos);
            }
          }
          prevBarIndex = tierBar;
        } else {
          prevBarIndex = null;
        }

        // POSE STRIKE: a strike fires on each whole beat crossing. Beat count
        // is derived from the ladder bar + barPhase so strikes land on the
        // grid (integer beats never interpolate). Each strike snaps the pose
        // orientation by a quantized step and pulses the breath.
        if (beat && tierBar !== null) {
          const beatsPerBar = beat.beatsPerBar > 0 ? beat.beatsPerBar : 4;
          const beatCount = Math.floor(tierBar * beatsPerBar + beat.barPhase * beatsPerBar);
          if (prevBeatCount !== null && beatCount !== prevBeatCount) {
            const steps = Math.max(1, beatCount - prevBeatCount);
            // Snap the pose orientation by whole quantized increments (held
            // until the next strike — no continuous drift between beats).
            poseRot += spinDirection * POSE_STEP * poseStepGain * steps;
            // Fire the breath (stronger with the kick landing on the beat).
            poseStrike = Math.min(1, 0.7 + 0.6 * frame.impulse.low);
          }
          prevBeatCount = beatCount;
        } else {
          prevBeatCount = null;
        }
        // Breath decays over roughly one beat (or ~0.4 s without a grid).
        const beatDecayS = beat && beat.bpm ? Math.max(0.15, 30 / beat.bpm) : 0.4;
        poseStrike = Math.max(0, poseStrike - dt / beatDecayS);

        // MID -> TOPOLOGY (churn scale + extra fold), NOT dust. Smoothed so
        // the topology churns rather than jitters; freezes dust to a floor.
        const midEase = 1 - Math.exp(-dt / 0.25);
        midTopo += (frame.bands.mid - midTopo) * midEase;
        // Extra continuous fold count (0..~3) driven by mid presence — folds
        // the warp coords more the louder the mids (fold TOPOLOGY change).
        const midFoldTarget = 3.0 * Math.min(1, Math.max(0, (frame.bands.mid - 0.15) / 0.6));
        midFold += (midFoldTarget - midFold) * midEase;

        // Ease the genome; run the bass systems (charge, ripple) (parent).
        const easeSlow = 1 - Math.exp(-dt / 0.9);
        const easeFast = 1 - Math.exp(-dt / 0.4);
        paletteCurrent += (paletteTarget - paletteCurrent) * easeSlow;
        armsCurrent += (ARM_CYCLE[armIndex] - armsCurrent) * easeFast;
        modeCurrent += (modeTarget - modeCurrent) * easeSlow;
        horizonCurrent += (horizonTarget - horizonCurrent) * easeFast;
        flash = Math.max(0, flash - dt * 1.4);
        barWaveAge += dt;
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // Warp-mode blend: flight zooms out, collapse falls in, orbit swirls.
        const speed = frame.params.speed ?? 1;
        const w0 = Math.max(0, 1 - Math.abs(modeCurrent));
        const w1 = Math.max(0, 1 - Math.abs(modeCurrent - 1));
        const w2 = Math.max(0, 1 - Math.abs(modeCurrent - 2));
        const phraseNow = beat && tierBar !== null
          ? ((((tierBar % 4) + 4) % 4) + beat.barPhase) / 4 : 0;
        const zoomFlight =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) *
            (0.85 + 0.3 * phraseNow) * speed * dt;
        const zoomCollapse = 1 - (0.04 + 0.25 * energy) * speed * dt + 2.2 * frame.impulse.low * speed * dt * 0.5;
        const zoomOrbit = 1 + 0.5 * frame.impulse.low * speed * dt;
        // Continuous rotation: only meaningful when poses are RELEASED
        // (poseLock ~ 0). While locked, the quantized poseRot carries the
        // orientation; this fluid component is scaled by (1 - poseLock).
        const rotBase = (0.05 + 0.5 * frame.bands.mid + 0.25 * sustained) * speed * dt;

        // Phrase/section phases.
        const phrase = phraseNow;
        const section = beat && tierBar !== null
          ? ((((tierBar % 16) + 16) % 16) + beat.barPhase) / 16 : 0;

        // HIGH responses: sparkle + rim (no powder). Both gate on high band +
        // impulse; ring sparkle rides the charge so it chases a live ring.
        const highSpark = Math.min(1.5, (0.6 * frame.bands.high + 0.9 * frame.impulse.high) * (0.5 + 0.5 * charge));
        const highRim = Math.min(1.5, 0.5 * frame.bands.high + 0.8 * frame.impulse.high);

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
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: sustained,
          u_centroid: frame.centroid,
          u_decay: Math.min(0.998, 0.992 - 0.008 * energy - 0.008 * smoothBuildup),
          u_seed: Math.floor(frame.time * 20),
          // High-transient nebula puffs suppressed (highs -> sparkle/rim).
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (0.4 + 0.6 * Math.max(smoothDrop, sustained))) /
              (1 + 1.8 * smoothBuildup)) /
            (1 + 2.2 * frame.impulse.low),
          // Snare powder kept (beloved).
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (0.5 + 0.5 * Math.max(smoothDrop, sustained))) /
              (1 + 0.8 * smoothBuildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_zoom: w0 * zoomFlight + w1 * zoomCollapse + w2 * zoomOrbit,
          // Continuous spin ONLY leaks in as poses release (1 - poseLock).
          u_rotStep: spinDirection * rotBase * (1 + 2.2 * w2) * (1 - poseLock),
          u_charge: charge,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_palette: paletteCurrent,
          u_arms: armsCurrent,
          u_fold: FOLD_CYCLE[foldIndex],
          u_horizonScale: horizonCurrent,
          u_flash: flash,
          u_phrase: phrase,
          u_section: section,
          u_barWave: barWaveAge,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_dust: frame.params.dust ?? 1,
          // --- BEAT GRAMMAR uniforms.
          u_poseRot: poseRot,
          u_poseLock: poseLock,
          u_poseStrike: poseStrike,
          u_midTopo: midTopo,
          u_midFold: midFold,
          u_highSpark: highSpark,
          u_highRim: highRim,
        };
      },
    });
  },
};

export default g08OdysseyBeatPreset;
