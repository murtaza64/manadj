/**
 * "g05 voyage-cracks" (gen-5 tweak of g00-voyage): the parent Voyage
 * verbatim — unsharp feedback tap, traveling kick ripple, charged
 * event-horizon ring, localized lens swirl, palette travel, phrase swell —
 * with ONE element swapped: the kick SHOCKWAVE RINGS are replaced by
 * SCREEN-SPACE CRACKS.
 *
 * A kick snaps a crack web open from the ripple's travel point; its edges
 * REFRACT the starfield, and the web heals by the next downbeat (beat
 * phase). A DROP fractures the full field (refraction only — no luminance
 * flash, photosensitivity floor) healing over a phrase (ladderBarIndex ??
 * barIndex), riding max(trend.drop, energy). During vibrant buildups the
 * cracks glow WARMER as tension rises (never dim or still). All other
 * voyage elements stay parent.
 *
 * ASSIGNED SWAP: kick shockwave rings → screen-space cracks.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
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

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

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
uniform float u_centroid;
uniform float u_specHue;   // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_dust;
uniform float u_palette;
uniform float u_charge;
uniform float u_spawnSnare;
uniform float u_hueRot;   // DUST FIX v3: per-song hue anchor + slow travel, TURNS 0..1
uniform float u_rippleAge;
uniform float u_rippleAmp;

// ---- SCREEN-SPACE CRACKS (replaces the kick shockwave rings) ----
uniform vec2 u_crackPoint;   // ripple travel point the kick web snaps from
uniform float u_crackKick;   // kick web strength, heals by next downbeat
uniform float u_crackDrop;   // full-field fracture, heals over a phrase
uniform float u_crackWarm;   // buildup tension → warmer glow (never dim)

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

// DUST FIX v3: value-preserving hue ROTATION (YIQ chroma plane). rot in TURNS;
// luminance (Y) untouched so gains are unchanged. Negatives clamped.
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

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the traveling palette at each star own hash phase.
  vec3 tint = hueRotate(palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02), u_hueRot);
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

// Crack field: cellular ridges (distance between the two nearest jittered
// feature points). The ridge lines are the fracture edges; their gradient
// gives the refraction normal. A radial gate from the crack point makes the
// kick web SNAP OPEN from the ripple's travel point.
vec3 crackField(vec2 p, float scale, float seed) {
  vec2 q = p * scale + seed;
  vec2 g = floor(q);
  vec2 f = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 feat = o + vec2(hash(g + o), hash(g + o + 31.4)) - f;
      float d = dot(feat, feat);
      if (d < d1) { d2 = d1; d1 = d; }
      else if (d < d2) { d2 = d; }
    }
  }
  // Edge sharpness: bright right on the fracture line, dark off it.
  float edge = sqrt(d2) - sqrt(d1);
  return vec3(edge, sqrt(d1), sqrt(d2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + churn + traveling kick ripple + lens
  // (parent, unchanged).
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

  // ---- SCREEN-SPACE CRACKS: build the fracture web and its refraction
  // offset BEFORE sampling the feedback, so crack edges bend the starfield.
  vec2 crackC = (u_crackPoint - 0.5) * vec2(aspect, 1.0);
  float kickGate = exp(-length(c - crackC) * (5.0 - 3.0 * u_crackKick)) * u_crackKick;
  vec3 kickCrack = crackField(c, 6.0, fract(u_seed * 0.131) * 40.0);
  vec3 dropCrack = crackField(c, 4.5, 11.7);
  float kickEdge = (1.0 - smoothstep(0.0, 0.06, kickCrack.x)) * kickGate;
  float dropEdge = (1.0 - smoothstep(0.0, 0.05, dropCrack.x)) * u_crackDrop;
  // Refraction normal: gradient of the nearest-feature distance points away
  // from the crack; slabs on either side shift oppositely.
  vec2 kickN = normalize(vec2(
    crackField(c + vec2(px.x, 0.0) * 4.0, 6.0, fract(u_seed * 0.131) * 40.0).y - kickCrack.y,
    crackField(c + vec2(0.0, px.y) * 4.0, 6.0, fract(u_seed * 0.131) * 40.0).y - kickCrack.y
  ) + 1e-5);
  vec2 dropN = normalize(vec2(
    crackField(c + vec2(px.x, 0.0) * 4.0, 4.5, 11.7).y - dropCrack.y,
    crackField(c + vec2(0.0, px.y) * 4.0, 4.5, 11.7).y - dropCrack.y
  ) + 1e-5);
  vec2 refract = (kickN * kickEdge * 0.03 + dropN * dropEdge * 0.022) / vec2(aspect, 1.0);
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5 + refract;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
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

  // ---- Steady layers, injected at (1 - decay) — parent, unchanged.
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
  // Gravity ripple color: a spectral-hue-biased warm palette slice.
  vec3 gravityColor = hueRotate(palette(0.05 + t * 0.015 + u_specHue * 0.5), u_hueRot);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart: a deep, low-luma slice of the traveling palette (spectral-hue
  // biased) instead of a fixed dark red — still whitens under a kick.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += hueRotate(mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65), u_hueRot) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = hueRotate(palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  // DISTINCT DUST HUE: high nebula samples the palette at +0.35 phase from the
  // mid dust so the bands read as different dust kinds.
  vec3 electric = hueRotate(palette(0.35 + cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8), u_hueRot);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  // ---- SWAPPED STAMP: crack-edge GLOW instead of the kick shockwave ring.
  // The kick web edges glow (warmer as buildup tension rises); the drop
  // fracture is REFRACTION-DOMINANT — a restrained edge sheen, no
  // full-field luminance flash (photosensitivity floor).
  vec3 crackCool = mix(palette(0.15 + t * 0.02), vec3(0.7, 0.85, 1.0), 0.4);
  vec3 crackHot = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.85, 0.5), 0.4);
  vec3 kickGlow = mix(crackCool, crackHot, clamp(u_crackWarm, 0.0, 1.0));
  sky += kickGlow * kickEdge * (0.5 + 0.8 * u_crackWarm + 0.6 * u_kick);
  // Drop fracture edges: dim sheen only (refraction carries the drama).
  sky += mix(crackCool, crackHot, 0.35 * u_crackWarm) * dropEdge * 0.12;

  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const candidate: VisualizerPreset = {
  id: 'g05-voyage-cracks',
  name: 'g05 voyage-cracks',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'palette', label: 'palette blend (ember→nebula→aurora→solar)', min: 0, max: 3, step: 0.05, default: 1 },
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

    // Crack state.
    let crackKick = 0; // heals by the next downbeat (beat phase)
    let crackDrop = 0; // heals over a phrase (ladderBarIndex ?? barIndex)
    const crackPoint: [number, number] = [0.5, 0.5];
    let prevBeatPhase: number | null = null;
    let dropPhraseStart: number | null = null;
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase.
    let slowCentroid = 0.5;
    // DUST FIX v3: per-song hue anchor (splitmix of dominant deck trackId),
    // eased over ~2s so track changes sweep; centroid EMA supplies the travel.
    let hueAnchor = 0;
    let hueAnchorTarget = 0;
    let lastAnchorTrack: number | null = null;

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

        // Traveling ripple (parent) — its wavefront point is where the kick
        // crack web snaps open.
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        const beat = frame.beat;

        // ---- Kick crack web: snap open on a strong kick, from the ripple's
        // travel point (front along a fresh random heading). Heals toward
        // the next downbeat via beat phase (1 at the beat → 0 as it approaches
        // the next), so the web is gone by the downbeat.
        if (frame.impulse.low > 0.35) {
          crackKick = Math.min(1, Math.max(crackKick, frame.impulse.low * 1.2));
          const front = 0.16 + rippleAge * 0.9;
          const a = Math.random() * Math.PI * 2;
          crackPoint[0] = 0.5 + Math.cos(a) * front * 0.5;
          crackPoint[1] = 0.5 + Math.sin(a) * front * 0.5;
        }
        // Heal by the next downbeat: track beat phase (0 on-beat → rising to
        // the next). When a new beat arrives (phase wraps low), reset the
        // web; otherwise decay toward the downbeat.
        if (beat) {
          if (prevBeatPhase !== null && beat.phase < prevBeatPhase) {
            crackKick *= 0.15; // healed at the downbeat crossing
          }
          prevBeatPhase = beat.phase;
          crackKick *= Math.max(0, 1 - beat.phase) * 0.5 + 0.5;
        } else {
          prevBeatPhase = null;
        }
        crackKick = Math.max(0, crackKick - dt * 0.9);

        // ---- Drop fracture: full-field, riding max(trend.drop, energy);
        // heals over a phrase using the ladder-correct bar ordinal.
        // trend.drop is not in the contract; the parent's smoothDrop (the
        // bass-weighted excitement) IS the drop signal — ride max(drop, energy).
        const dropEnergy = Math.max(drop, energy);
        const barTier = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
        if (dropEnergy > 0.55 && (dropPhraseStart === null || (barTier !== null && barTier - dropPhraseStart >= 4))) {
          crackDrop = Math.max(crackDrop, Math.min(1, dropEnergy));
          dropPhraseStart = barTier;
        }
        // Phrase-length heal: a phrase is 4 bars; fade proportionally as the
        // phrase advances, plus a slow floor decay when gridless.
        if (barTier !== null && dropPhraseStart !== null) {
          const barsIn = barTier - dropPhraseStart;
          const phraseFrac = beat ? (barsIn + beat.barPhase) / 4 : barsIn / 4;
          crackDrop *= Math.max(0, 1 - phraseFrac * dt * 2.0);
        }
        crackDrop = Math.max(0, crackDrop - dt * 0.35);

        // Buildup tension → warmer crack glow (never dim/still): rises with
        // the smoothed buildup and the raw high-band busyness of a riser.
        const crackWarm = Math.min(1, buildup * 1.3 + frame.impulse.high * 0.4);

        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        // DUST FIX v3: dominant deck = argmax audible level; its trackId anchors
        // a stable per-song hue, eased over ~2s; centroid EMA supplies travel.
        let domTrack: number | null = null;
        let domLevel = -1;
        for (const d of frame.decks) {
          if (d.level > domLevel) {
            domLevel = d.level;
            domTrack = d.trackId;
          }
        }
        if (domTrack !== null && domTrack !== lastAnchorTrack) {
          lastAnchorTrack = domTrack;
          hueAnchorTarget = splitmix01(domTrack);
        }
        hueAnchor += (hueAnchorTarget - hueAnchor) * (1 - Math.exp(-dt / 2.0));
        const hueRot = (((hueAnchor + (slowCentroid - 0.5) * 0.8) % 1) + 1) % 1;
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_hueRot: hueRot,
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
          u_crackPoint: crackPoint,
          u_crackKick: crackKick,
          u_crackDrop: crackDrop,
          u_crackWarm: crackWarm,
        };
      },
    });
  },
};

export default candidate;
